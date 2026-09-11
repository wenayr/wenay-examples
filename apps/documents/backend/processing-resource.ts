import {parseText} from './csv-table'
export {parseCsv, parseText} from './csv-table'
import path from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {createAsyncQueue} from 'wenay-common2'
import {mkdir, writeFile, unlink, readdir} from 'node:fs/promises'
import {createLocalBlobStorage} from 'wenay-common2/server/blob'
import {createProcessResource} from 'wenay-common2/server/process'
import {createAiRunHost, type AiRunRunner, type AiRun} from 'wenay-common2/ai'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {documentAccess, organizationAccess, validateTable} from './domain'
import {documentsDefinition} from './service'
import type {DocumentState, ParsedTable, Provenance} from './model'
import {createTestExtractionProvider, validateExtraction, type ExtractionProvider} from './model-extraction'
import {openAiCheckpoint} from './ai-checkpoint'
import {UsageError, type UsageGate} from './metered-execution'

export type DocumentExecutor = ReturnType<typeof createServiceLeader<typeof documentsDefinition>>['corridor']['system']
export type DocumentProcessor = {extract(input: {name: string, bytes: Uint8Array, processor: string, signal: AbortSignal, sourceVersion?: number}): Promise<ParsedTable & {provenance?: Provenance}>}
class DocumentProcessingError extends Error {}

export function createDocumentProcessor(deps: {directory: string, python?: string, extractor?: ExtractionProvider, processFactory?: typeof createProcessResource}): DocumentProcessor {
    return {async extract(input) {
        input.signal.throwIfAborted()
        if (input.processor == 'model') {
            const result = validateExtraction(await (deps.extractor ?? createTestExtractionProvider()).extract({...input, sourceVersion: input.sourceVersion ?? 1}))
            input.signal.throwIfAborted()
            return {...result.table, provenance: {sourceVersion: input.sourceVersion ?? 1, provider: result.provider, demo: result.demo, fields: result.fields}}
        }
        const pdf = input.processor == 'node' && /\.pdf$/i.test(input.name)
        if (input.processor == 'node' && !pdf) return parseText(input.name, input.bytes)
        if (!pdf && (input.processor != 'python' || !/\.csv$/i.test(input.name))) throw new DocumentProcessingError('Python-обработчик принимает CSV')
        const directory = path.join(deps.directory, 'temporary')
        await mkdir(directory, {recursive: true})
        const file = path.join(directory, randomUUID() + (pdf ? '.pdf' : '.csv'))
        await writeFile(file, input.bytes, {flag: 'wx', mode: 0o600})
        let output = ''
        let child: ReturnType<typeof createProcessResource<ParsedTable>> | undefined
        try {
            input.signal.throwIfAborted()
            child = (deps.processFactory ?? createProcessResource)({command: pdf ? process.execPath : deps.python ?? process.env.DOCUMENT_PYTHON ?? 'python',
                args: pdf ? ['--max-old-space-size=256', path.resolve(__dirname, 'pdf-processor.mjs'), file] : ['-u', path.resolve(__dirname, 'processor.py'), file], signal: input.signal,
                startTimeoutMs: 10000, stopTimeoutMs: 1000, tailChars: 1000,
                ready(fact) {
                    if (fact.type != 'stdout') return
                    output += fact.value
                    if (output.length > 3200000) throw new Error('Ответ обработчика превышает лимит')
                    if (!output.endsWith('\n')) return
                    if (pdf && !output.includes('DOCUMENT_RESULT ')) return
                    const result = JSON.parse(pdf ? output.slice(output.lastIndexOf('DOCUMENT_RESULT ') + 16) : output) as {headers?: unknown, rows?: unknown, error?: unknown}
                    if (result.error) {
                        const messages: Record<string, string> = {pdf_empty: 'В PDF нет текстового слоя. Для скана нужен отдельный OCR-обработчик', pdf_password: 'Защищённый паролем PDF не поддерживается', pdf_limit: 'PDF превышает лимит: 10 страниц, 200 строк или 200000 символов', pdf_invalid: 'PDF повреждён или не поддерживается'}
                        throw new DocumentProcessingError(messages[String(result.error)] ?? 'Python не смог прочитать CSV')
                    }
                    return validateTable(result as ParsedTable)
                }
            })
            return await child.ready
        } finally {
            await child?.close()
            await unlink(file).catch(function missing(error: NodeJS.ErrnoException) {if (error.code != 'ENOENT') throw error})
        }
    }}
}

export function createDocumentProcessing(deps: {directory?: string, processor?: DocumentProcessor, python?: string, usage?: UsageGate, extractor?: ExtractionProvider} = {}) {
    let store: Store<DocumentState> | null = null
    let execute: DocumentExecutor | null = null
    let ready = Promise.resolve()
    const directory = deps.directory ? path.resolve(deps.directory) : undefined
    const processing = deps.processor ?? (directory ? createDocumentProcessor({directory, python: deps.python, extractor: deps.extractor}) : null)
    const pending = new Map<string, AbortController>()
    const uploads = new Set<string>()
    const deleted = new Set<string>()
    const filesQueue = createAsyncQueue(1)
    let closing = false
    function state() {if (!store || closing) throw new Error('Обработчик не подключён'); return store.state}
    function item(account: string, orgId: string, id: string) {return documentAccess(state(), account, orgId, id)}
    function matches(account: string, input: {orgId: string, id: string, revision: number}) {
        const document = item(account, input.orgId, input.id)
        if (document.revision != input.revision) throw new Error('Документ уже изменён. Обновите карточку')
        return document
    }
    const blobs = directory ? createLocalBlobStorage<{account: string, orgId: string, id?: string, cleanup?: boolean, signal?: AbortSignal}>({
        directory: path.join(directory, 'blobs'), maxBytes: 512 * 1024,
        authorize({context, operation, id}) {
            if (context.cleanup && operation == 'remove') return
            context.signal?.throwIfAborted()
            organizationAccess(state(), context.account, context.orgId)
            if (operation != 'upload') {
                const document = item(context.account, context.orgId, context.id ?? '')
                if (document.blobId != id) throw new Error('Файл не принадлежит документу')
            }
        }
    }) : null
    async function cleanup() {
        if (!directory || !blobs || !store || uploads.size) return
        const referenced = new Set(Object.values(store.state.documents).filter(document => document.status != 'deleted').map(document => document.blobId))
        const filenames = await readdir(path.join(directory, 'blobs')).catch(function absent(error: NodeJS.ErrnoException) {if (error.code == 'ENOENT') return []; throw error})
        for (const id of filenames) if (/^[a-f0-9]{64}$/.test(id) && !referenced.has(id) && !uploads.size) {
            await blobs.control.remove({account: 'system', orgId: '', cleanup: true}, id)
        }
    }
    function inputOf(value: unknown) {
        const input = value as {orgId: string, documentId: string, revision: number, processor: string} | null
        if (!input || typeof input.orgId != 'string' || typeof input.documentId != 'string' || !Number.isSafeInteger(input.revision) || !['node', 'python', 'model'].includes(input.processor)) throw new Error('Некорректный запрос обработки')
        return input
    }
    async function failed(run: AiRun, status: 'failed' | 'cancelled' | 'uncertain', error: string) {
        if (!execute || !store) return
        const document = store.state.documents[run.resourceIds[0]]
        if (!document) return
        await execute.processingFailure(run.id + '-' + status, {actor: run.owner, orgId: document.orgId, id: document.id, runId: run.id, status, error})
    }
    const runner: AiRunRunner = {async run(ctx) {
        await ready
        const input = inputOf(ctx.input)
        const controller = new AbortController()
        pending.set(ctx.run.id, controller)
        const timeout = setTimeout(function expired() {controller.abort(new Error('Обработка заняла больше 10 секунд'))}, 10000)
        try {
            if (!processing || !blobs || !execute) throw new Error('Обработчик не подключён')
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            const original = matches(ctx.run.owner, {orgId: input.orgId, id: input.documentId, revision: input.revision})
            const name = original.name, blobId = original.blobId, sourceVersion = original.sourceVersion
            const began = await execute.processingBegin(ctx.run.id + '-begin', {orgId: input.orgId, id: input.documentId, actor: ctx.run.owner, runId: ctx.run.id, revision: input.revision, processor: input.processor})
            ctx.report({progress: 0.2, message: 'Чтение исходного файла'})
            const bytes = await blobs.resource.read({account: ctx.run.owner, orgId: input.orgId, id: input.documentId, signal: controller.signal}, blobId)
            controller.signal.throwIfAborted()
            ctx.report({progress: 0.5, message: input.processor == 'python' ? 'CSV обрабатывается Python' : 'Извлечение строк в Node'})
            let offAbort = () => {}
            let parsed: ParsedTable & {provenance?: Provenance}
            async function extract() {
                controller.signal.throwIfAborted()
                const cancelled = new Promise<never>(function onAbort(_resolve, reject) {
                    function abort() {reject(controller.signal.reason ?? new Error('Обработка отменена'))}
                    controller.signal.addEventListener('abort', abort, {once: true})
                    offAbort = () => controller.signal.removeEventListener('abort', abort)
                })
                return Promise.race([processing!.extract({name, bytes, processor: input.processor, signal: controller.signal, sourceVersion}), cancelled])
            }
            try {parsed = deps.usage ? await deps.usage.run({orgId: input.orgId, eventId: 'documents-' + ctx.run.id,
                metric: 'document', units: 1, reference: input.documentId, signal: controller.signal}, extract) : await extract()}
            finally {offAbort()}
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            const table = validateTable(parsed)
            await execute.processingResult(ctx.run.id + '-result', {orgId: input.orgId, id: input.documentId, actor: ctx.run.owner, runId: ctx.run.id, attempt: began.attempt, ...table,
                ...(parsed.provenance ? {provenance: parsed.provenance} : {})})
            ctx.report({progress: 1, message: 'Данные готовы к проверке человеком'})
            return {result: {available: true}}
        } catch (error) {
            const status = ctx.cancelled() ? 'cancelled' : 'failed'
            const message = controller.signal.aborted && !ctx.cancelled() ? 'Обработка прервана: время ожидания или доступ изменились' : error instanceof DocumentProcessingError || error instanceof UsageError ? error.message : 'Не удалось обработать документ. Проверьте формат и повторите попытку'
            await failed(ctx.run, status, message)
            throw new Error(message, {cause: error})
        } finally {clearTimeout(timeout); pending.delete(ctx.run.id)}
    }, async cancel({run}) {
        pending.get(run.id)?.abort()
        await failed(run, 'cancelled', 'Обработка отменена')
    }}
    const host = createAiRunHost({...openAiCheckpoint({directory: directory ? path.join(directory, 'runs') : undefined}), runner, history: 3,
        capabilities: [{kind: 'extract', label: 'Извлечь строки CSV / TXT / текстового PDF', acceptsResources: true}],
        policy: {
            canRead: (account, run) => run.owner == account,
            canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = inputOf(request.input)
                    const document = item(account, input.orgId, input.documentId)
                    if (request.kind != 'extract' || request.resourceIds?.length != 1 || request.resourceIds[0] != document.id) return false
                    const runs = Object.values(host.store.state.runs)
                    if (runs.some(run => run.owner == account && run.requestId == request.requestId)) return true
                    return document.revision == input.revision && ['uploaded', 'failed', 'cancelled', 'uncertain'].includes(document.status) && runs.length < 50 &&
                        runs.filter(run => ['queued', 'running'].includes(run.state)).length < 2 &&
                        !runs.some(run => ['queued', 'running'].includes(run.state) && run.resourceIds.includes(document.id))
                } catch {return false}
            }
        }
    })
    const resource = {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const account = ctx.principal.account
        const connection = host.connection(account)
        const transfers = new Map<string, {orgId: string, controller: AbortController, createdAt: number, phase: 'pending' | 'committing' | 'completed' | 'cancelled', documentId: string}>()
        function active() {ctx.signal.throwIfAborted(); state(); if (!blobs || !execute) throw new Error('Хранилище не подключено')}
        function beginUpload(orgId: string) {
            active(); organizationAccess(state(), account, orgId)
            for (const [id, transfer] of transfers) if (['completed', 'cancelled'].includes(transfer.phase) || transfer.phase != 'committing' && Date.now() - transfer.createdAt >= 60000) {transfer.controller.abort(); transfers.delete(id)}
            if (transfers.size >= 8) throw new Error('Завершите текущие загрузки или подождите минуту')
            const uploadId = randomUUID()
            transfers.set(uploadId, {orgId, controller: new AbortController(), createdAt: Date.now(), phase: 'pending', documentId: ''})
            return {uploadId}
        }
        function cancelUpload(uploadId: string) {
            active()
            const transfer = transfers.get(uploadId)
            if (!transfer) throw new Error('Загрузка недоступна в этом подключении')
            organizationAccess(state(), account, transfer.orgId)
            if (transfer.phase == 'committing' || transfer.phase == 'completed') return {status: transfer.phase, documentId: transfer.documentId}
            transfer.controller.abort(new Error('Загрузка отменена')); transfer.phase = 'cancelled'
            return {status: 'cancelled' as const, documentId: ''}
        }
        async function upload(input: {orgId: string, name: string, bytes: Uint8Array, uploadId?: string}) {
            const transfer = input.uploadId ? transfers.get(input.uploadId) : null
            if (input.uploadId && (!transfer || transfer.orgId != input.orgId || transfer.phase != 'pending')) throw new Error('Загрузка отменена или завершена')
            const signal = AbortSignal.any([ctx.signal, ...(transfer ? [transfer.controller.signal, AbortSignal.timeout(Math.max(1, 60000 - (Date.now() - transfer.createdAt)))] : [])])
            signal.throwIfAborted()
            await ready
            if (filesQueue.size >= 4) throw new Error('Очередь загрузки заполнена. Повторите позже')
            return filesQueue.add(async function commitUpload() {
            signal.throwIfAborted()
            active()
            organizationAccess(state(), account, input.orgId)
            if (typeof input.name != 'string' || !input.name.trim() || input.name.length > 160 || /[\x00-\x1f]/.test(input.name) || !/\.(csv|txt|pdf)$/i.test(input.name)) throw new Error('Загрузите CSV, TXT или PDF с именем до 160 символов')
            if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > 512 * 1024) throw new Error('Файл от 1 байта до 512 КиБ')
            if (!/\.pdf$/i.test(input.name)) new TextDecoder('utf-8', {fatal: true}).decode(input.bytes)
            const name = path.basename(input.name)
            const id = createHash('sha256').update(JSON.stringify([input.orgId, account, name])).update(input.bytes).digest('hex')
            const old = state().documents[id]
            if (old && old.status != 'deleted') {item(account, input.orgId, id); if (transfer) {transfer.phase = 'completed'; transfer.documentId = id}; return {id, revision: old.revision}}
            if (!old && Object.keys(state().documents).length + uploads.size >= 50) throw new Error('На стенде допускается 50 документов')
            if (uploads.has(id)) throw new Error('Этот файл уже загружается')
            uploads.add(id)
            try {
                const stored = await blobs!.control.upload({account, orgId: input.orgId, signal}, input.bytes)
                signal.throwIfAborted()
                active()
                organizationAccess(state(), account, input.orgId)
                // Cancellation can stop byte IO/queue work. Once metadata is committing, report that boundary honestly.
                if (transfer) {transfer.phase = 'committing'; transfer.documentId = id}
                const imported = await execute!.documentImport('upload-' + id + '-source-' + ((old?.sourceVersion ?? 0) + 1), {id, orgId: input.orgId, actor: account, name, blobId: stored.id, size: stored.size})
                deleted.delete(id)
                if (transfer) transfer.phase = 'completed'
                return imported
            } catch (error) {if (transfer && transfer.phase != 'completed') transfer.phase = 'cancelled'; throw error}
            finally {uploads.delete(id); await cleanup()}
            })
        }
        async function download(input: {orgId: string, id: string}) {
            await ready
            active()
            const document = item(account, input.orgId, input.id)
            const name = document.name
            const bytes = await blobs!.resource.read({account, orgId: input.orgId, id: input.id, signal: ctx.signal}, document.blobId)
            active()
            item(account, input.orgId, input.id)
            return {name, bytes: new Uint8Array(bytes)}
        }
        async function detail(input: {orgId: string, id: string, revision: number}) {
            await ready
            active()
            matches(account, input)
            const original = await download(input)
            const document = matches(account, input)
            return {id: document.id, name: document.name, revision: document.revision, status: document.status, sourceVersion: document.sourceVersion,
                table: {headers: [...document.table.headers], rows: document.table.rows.map(row => [...row])},
                comments: document.comments.map(comment => ({...comment})),
                approvals: document.approvals.map(({table, ...approval}) => ({...approval})),
                provenance: document.provenance ? {...document.provenance, fields: document.provenance.fields.map(field => ({...field}))} : null,
                sourceType: /\.pdf$/i.test(document.name) ? 'pdf' as const : 'text' as const,
                originalText: /\.pdf$/i.test(document.name) ? 'Исходный PDF доступен для просмотра и скачивания. Страницы извлечённого текста указаны в таблице.' : new TextDecoder('utf-8', {fatal: true}).decode(original.bytes)}
        }
        async function status(input: {orgId: string, id: string}) {
            await ready; active()
            const document = item(account, input.orgId, input.id)
            return {id: document.id, orgId: document.orgId, name: document.name, revision: document.revision, sourceVersion: document.sourceVersion, status: document.status, attempt: document.attempt, processor: document.processor, rowCount: document.table.rows.length, error: document.error, approvedRevision: document.approvals.at(-1)?.revision ?? 0}
        }
        async function compare(input: {orgId: string, id: string, revision: number, approvedRevision: number}) {
            await ready; active()
            const document = matches(account, input), approved = document.approvals.find(value => value.revision == input.approvedRevision)
            if (!approved) throw new Error('Утверждённая версия недоступна')
            return {current: {revision: document.revision, sourceVersion: document.sourceVersion, table: validateTable(document.table)}, previous: {...approved, table: validateTable(approved.table)}}
        }
        async function exportDocument(input: {orgId: string, id: string, revision: number, format: 'csv' | 'json'}) {
            await ready
            active()
            const document = matches(account, input)
            const approved = document.approvals.at(-1)
            if (document.status != 'approved' || !approved || approved.revision != document.revision) throw new Error('Экспорт доступен после утверждения текущей версии')
            if (!['csv', 'json'].includes(input.format)) throw new Error('Выберите CSV или JSON')
            function cell(value: string) {
                const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value
                return '"' + safe.replaceAll('"', '""') + '"'
            }
            const text = input.format == 'json' ? JSON.stringify({sourceVersion: approved.sourceVersion, approvedRevision: approved.revision, ...approved.table, ...(approved.provenance ? {provenance: approved.provenance} : {})}, null, 2) :
                [approved.table.headers, ...approved.table.rows].map(row => row.map(cell).join(',')).join('\r\n')
            return {name: document.name.replace(/\.[^.]+$/, '') + '-approved.' + input.format, bytes: new Uint8Array(Buffer.from(text))}
        }
        return {facade: {ai: connection.fragment, control: {beginUpload, cancelUpload, upload, download, detail, status, compare, export: exportDocument}}, close() {for (const transfer of transfers.values()) transfer.controller.abort(); transfers.clear(); connection.close()}}
    }}
    function mount(deps: {store: Store<DocumentState>, execute: DocumentExecutor}) {
        store = deps.store
        execute = deps.execute
        ready = filesQueue.add(async function recover() {
            for (const document of Object.values(store!.state.documents)) if (document.status == 'processing') {
                const run = host.store.state.runs[document.activeRun]
                await execute!.processingFailure(document.activeRun + '-recovery', {orgId: document.orgId, id: document.id, actor: run?.owner ?? document.owner, runId: document.activeRun, status: 'uncertain', error: 'Сервис перезапущен. Начните новую попытку после проверки исходного файла'})
            }
            for (const run of Object.values(host.store.state.runs)) if (run.recovery) {
                const document = store!.state.documents[run.resourceIds[0]]
                if (document && document.activeRun == run.id && ['review', 'approved'].includes(document.status)) host.recovery.settle(run.id, {state: 'completed', output: {result: {available: true}}})
                else host.recovery.settle(run.id, {state: 'failed', error: 'Работа прервана перезапуском. Разрешена новая попытка после проверки документа'})
            }
            await cleanup()
        })
        void ready.catch(function recoveryFailed() {})
        const off = store.on(function changed() {
            for (const [id, controller] of pending) {
                const run = host.store.state.runs[id]
                const document = store!.state.documents[run.resourceIds[0]]
                try {item(run.owner, document?.orgId ?? '', document?.id ?? '')} catch {controller.abort()}
            }
            for (const document of Object.values(store!.state.documents)) if (document.status == 'deleted' && !deleted.has(document.id)) {
                deleted.add(document.id)
                void filesQueue.add(cleanup).catch(function retryLater() {deleted.delete(document.id)})
            }
        })
        return function close() {closing = true; off(); for (const controller of pending.values()) controller.abort(); host.close()}
    }
    return {resource, mount, view: {ready: () => ready}}
}

