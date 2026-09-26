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
import {buildInputValidate, type ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {documentAccess, processingDocumentAccess, processingOrganizationAccess, validateTable} from './domain'
import {requireProductKey} from './product-credentials'
import {documentsDefinition} from './service'
import type {DocumentState, ParsedTable, Provenance} from './model'
import {createTestExtractionProvider, validateExtraction, type ExtractionProvider} from './model-extraction'
import {openAiCheckpoint} from './ai-checkpoint'
import {UsageError, type createMeteredExecution} from './metered-execution'
import type {UsageReceipt} from './metering-contract'

export type DocumentUsage = Pick<ReturnType<typeof createMeteredExecution>, 'settled'>

export type DocumentExecutor = ReturnType<typeof createServiceLeader<typeof documentsDefinition>>['corridor']['system']
export type ExtractInput = {
    name: string,
    bytes: Uint8Array,
    processor: string,
    signal: AbortSignal,
    sourceVersion?: number
}

export type DocumentProcessor = {
    extract(input: ExtractInput): Promise<ParsedTable & {provenance?: Provenance}>
}
class DocumentProcessingError extends Error {}

type ProcessorDeps = {
    directory: string,
    python?: string,
    extractor?: ExtractionProvider,
    processFactory?: typeof createProcessResource
}

// Сообщения обработчика PDF: ключ ошибки от дочернего процесса — понятный текст человеку.
const PDF_ERRORS: Record<string, string> = {
    pdf_empty: 'В PDF нет текстового слоя. Для скана нужен отдельный OCR-обработчик',
    pdf_password: 'Защищённый паролем PDF не поддерживается',
    pdf_limit: 'PDF превышает лимит: 10 страниц, 200 строк или 200000 символов',
    pdf_invalid: 'PDF повреждён или не поддерживается'
}

export function createDocumentProcessor(deps: ProcessorDeps): DocumentProcessor {
    return {async extract(input) {
        input.signal.throwIfAborted()
        if (input.processor == 'model') {
            const provider = deps.extractor ?? createTestExtractionProvider()
            const sourceVersion = input.sourceVersion ?? 1
            const result = validateExtraction(await provider.extract({...input, sourceVersion}))
            input.signal.throwIfAborted()
            const provenance = {
                sourceVersion,
                provider: result.provider,
                demo: result.demo,
                fields: result.fields
            }
            return {...result.table, provenance}
        }
        const pdf = input.processor == 'node' && /\.pdf$/i.test(input.name)
        if (input.processor == 'node' && !pdf) return parseText(input.name, input.bytes)
        const csv = input.processor == 'python' && /\.csv$/i.test(input.name)
        if (!pdf && !csv) throw new DocumentProcessingError('Python-обработчик принимает CSV')
        const directory = path.join(deps.directory, 'temporary')
        await mkdir(directory, {recursive: true})
        const file = path.join(directory, randomUUID() + (pdf ? '.pdf' : '.csv'))
        await writeFile(file, input.bytes, {flag: 'wx', mode: 0o600})
        let output = ''
        let child: ReturnType<typeof createProcessResource<ParsedTable>> | undefined
        try {
            input.signal.throwIfAborted()
            const python = deps.python ?? process.env.DOCUMENT_PYTHON ?? 'python'
            const nodeArgs = ['--max-old-space-size=256', path.resolve(__dirname, 'pdf-processor.mjs'), file]
            const pythonArgs = ['-u', path.resolve(__dirname, 'processor.py'), file]
            child = (deps.processFactory ?? createProcessResource)({
                command: pdf ? process.execPath : python,
                args: pdf ? nodeArgs : pythonArgs,
                signal: input.signal,
                startTimeoutMs: 10000,
                stopTimeoutMs: 1000,
                tailChars: 1000,
                ready(fact) {
                    if (fact.type != 'stdout') return
                    output += fact.value
                    if (output.length > 3200000) throw new Error('Ответ обработчика превышает лимит')
                    if (!output.endsWith('\n')) return
                    if (pdf && !output.includes('DOCUMENT_RESULT ')) return
                    const payload = pdf
                        ? output.slice(output.lastIndexOf('DOCUMENT_RESULT ') + 16)
                        : output
                    const result = JSON.parse(payload) as {headers?: unknown, rows?: unknown, error?: unknown}
                    if (result.error) {
                        const message = PDF_ERRORS[String(result.error)] ?? 'Python не смог прочитать CSV'
                        throw new DocumentProcessingError(message)
                    }
                    return validateTable(result as ParsedTable)
                }
            })
            return await child.ready
        } finally {
            await child?.close()
            await unlink(file).catch(function missing(error: NodeJS.ErrnoException) {
                if (error.code != 'ENOENT') throw error
            })
        }
    }}
}

type ProcessingDeps = {
    now?: () => number,
    directory?: string,
    processor?: DocumentProcessor,
    python?: string,
    usage?: DocumentUsage,
    extractor?: ExtractionProvider
}

type Transfer = {
    orgId: string,
    controller: AbortController,
    createdAt: number,
    phase: 'pending' | 'committing' | 'completed' | 'cancelled',
    documentId: string
}

type ProcessingRequest = {orgId: string, documentId: string, revision: number, processor: string}

function validRequest(input: ProcessingRequest | null): input is ProcessingRequest {
    if (!input || typeof input.orgId != 'string' || typeof input.documentId != 'string') return false
    if (!Number.isSafeInteger(input.revision)) return false
    return ['node', 'python', 'model'].includes(input.processor)
}

// Имя файла приходит от клиента: без управляющих символов и только известных расширений.
function acceptedName(name: string) {
    if (typeof name != 'string' || !name.trim() || name.length > 160) return false
    if (/[\x00-\x1f]/.test(name)) return false
    return /\.(csv|txt|pdf)$/i.test(name)
}

// PDF показываем как файл, текстовый исходник — расшифрованной строкой.
function pdfNotice(name: string, bytes: Uint8Array) {
    if (/\.pdf$/i.test(name)) {
        return 'Исходный PDF доступен для просмотра и скачивания.'
            + ' Страницы извлечённого текста указаны в таблице.'
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
}

function failureMessage(error: unknown, aborted: boolean, cancelled: boolean) {
    if (aborted && !cancelled) return 'Обработка прервана: время ожидания или доступ изменились'
    if (error instanceof DocumentProcessingError || error instanceof UsageError) return error.message
    return 'Не удалось обработать документ. Проверьте формат и повторите попытку'
}

export function createDocumentProcessing(deps: ProcessingDeps = {}) {
    const now = deps.now ?? Date.now
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
    function state() {
        if (!store || closing) throw new Error('Обработчик не подключён')
        return store.state
    }
    function item(account: string, orgId: string, id: string) {return processingDocumentAccess(state(), account, orgId, id, now())}
    function organization(account: string, orgId: string) {return processingOrganizationAccess(state(), account, orgId, now())}
    // Machine connections are private. Job authority can reconcile its own persisted run after its credential expires.
    function authorityItem(account: string, orgId: string, id: string) {
        if (!account.startsWith('product:')) return documentAccess(state(), account, orgId, id)
        const key = state().productKeys?.[account.slice(8)]
        const document = state().documents[id]
        const scoped = key && key.orgId == orgId && Object.hasOwn(state().organizations, orgId)
        const mine = document && document.orgId == orgId && document.owner == account
        if (!scoped || !mine) throw new Error('Работа ключа недоступна')
        return document
    }
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
            organization(context.account, context.orgId)
            if (operation != 'upload') {
                const document = item(context.account, context.orgId, context.id ?? '')
                if (document.blobId != id) throw new Error('Файл не принадлежит документу')
            }
        }
    }) : null
    async function cleanup() {
        if (!directory || !blobs || !store) return
        if (uploads.size) return
        const live = Object.values(store.state.documents).filter(item => item.status != 'deleted')
        const referenced = new Set(live.map(document => document.blobId))
        const filenames = await readdir(path.join(directory, 'blobs')).catch(function absent(error: NodeJS.ErrnoException) {
            if (error.code == 'ENOENT') return []
            throw error
        })
        for (const id of filenames) if (/^[a-f0-9]{64}$/.test(id) && !referenced.has(id) && !uploads.size) {
            await blobs.control.remove({account: 'system', orgId: '', cleanup: true}, id)
        }
    }
    function inputOf(value: unknown) {
        const input = value as {orgId: string, documentId: string, revision: number, processor: string} | null
        if (!validRequest(input)) throw new Error('Некорректный запрос обработки')
        return input
    }
    async function failed(run: AiRun, status: 'failed' | 'cancelled' | 'uncertain', error: string) {
        if (!execute || !store) return
        const document = store.state.documents[run.resourceIds[0]]
        if (!document) return
        await execute.processingFailure(run.id + '-' + status, {
            actor: run.owner,
            orgId: document.orgId,
            id: document.id,
            runId: run.id,
            status,
            error
        })
    }
    const runner: AiRunRunner = {async run(ctx) {
        await ready
        const input = inputOf(ctx.input)
        const controller = new AbortController()
        pending.set(ctx.run.id, controller)
        const timeout = setTimeout(function expired() {
            controller.abort(new Error('Обработка заняла больше 10 секунд'))
        }, 10000)
        let expiry: ReturnType<typeof setTimeout> | undefined
        function current() {
            controller.signal.throwIfAborted()
            return item(ctx.run.owner, input.orgId, input.documentId)
        }
        try {
            if (!processing || !blobs || !execute) throw new Error('Обработчик не подключён')
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            const original = matches(ctx.run.owner, {orgId: input.orgId, id: input.documentId, revision: input.revision})
            if (ctx.run.owner.startsWith('product:')) {
                const key = requireProductKey(state(), ctx.run.owner, input.orgId, now())
                const remaining = key.expiresAt - now()
                if (remaining <= 10000) {
                    expiry = setTimeout(function keyExpired() {controller.abort(new Error('Срок ключа истёк'))}, Math.max(1, remaining))
                }
            }
            const name = original.name
            const blobId = original.blobId
            const sourceVersion = original.sourceVersion
            const began = await execute.processingBegin(ctx.run.id + '-begin', {
                orgId: input.orgId,
                id: input.documentId,
                actor: ctx.run.owner,
                runId: ctx.run.id,
                revision: input.revision,
                processor: input.processor
            })
            current()
            ctx.report({progress: 0.2, message: 'Чтение исходного файла'})
            const bytes = await blobs.resource.read({account: ctx.run.owner, orgId: input.orgId, id: input.documentId, signal: controller.signal}, blobId)
            current()
            const stage = input.processor == 'python' ? 'CSV обрабатывается Python' : 'Извлечение строк в Node'
            ctx.report({progress: 0.5, message: stage})
            let offAbort = () => {}
            let parsed: ParsedTable & {provenance?: Provenance}
            let usageReceipt: UsageReceipt | undefined
            async function extract() {
                current()
                const cancelled = new Promise<never>(function onAbort(_resolve, reject) {
                    function abort() {reject(controller.signal.reason ?? new Error('Обработка отменена'))}
                    controller.signal.addEventListener('abort', abort, {once: true})
                    offAbort = () => controller.signal.removeEventListener('abort', abort)
                })
                const running = processing!.extract({
                    name,
                    bytes,
                    processor: input.processor,
                    signal: controller.signal,
                    sourceVersion
                })
                return Promise.race([running, cancelled])
            }
            const usageEvent = {
                orgId: input.orgId,
                eventId: 'documents-' + ctx.run.id,
                metric: 'document' as const,
                units: 1,
                reference: input.documentId,
                signal: controller.signal
            }
            try {
                if (deps.usage) {
                    const outcome = await deps.usage.settled(usageEvent, extract)
                    parsed = outcome.value
                    usageReceipt = outcome.receipt
                } else parsed = await extract()
            } finally {
                offAbort()
            }
            current()
            if (ctx.cancelled()) return
            const table = validateTable(parsed)
            const provenance = parsed.provenance ? {provenance: parsed.provenance} : {}
            const receipt = usageReceipt ? {usageReceipt} : {}
            const saved = await execute.processingResult(ctx.run.id + '-result', {
                orgId: input.orgId,
                id: input.documentId,
                actor: ctx.run.owner,
                runId: ctx.run.id,
                attempt: began.attempt,
                sourceVersion,
                ...table,
                ...provenance,
                ...receipt
            })
            current()
            const completed = item(ctx.run.owner, input.orgId, saved.id)
            const mine = completed.activeRun == ctx.run.id && completed.attempt == began.attempt && completed.sourceVersion == sourceVersion
            if (!mine || saved.id != input.documentId) throw new Error('Подтверждение результата относится к другой попытке')
            ctx.report({progress: 1, message: 'Данные готовы к проверке человеком'})
            return {result: {available: true}}
        } catch (error) {
            const status = ctx.cancelled() ? 'cancelled' : 'failed'
            if (!closing) await failed(ctx.run, status, failureMessage(error, controller.signal.aborted, ctx.cancelled()))
            throw new Error(failureMessage(error, controller.signal.aborted, ctx.cancelled()), {cause: error})
        } finally {
            clearTimeout(timeout)
            clearTimeout(expiry)
            pending.delete(ctx.run.id)
        }
    }, async cancel({run}) {
        pending.get(run.id)?.abort()
        if (!closing) await failed(run, 'cancelled', 'Обработка отменена')
    }}
    const checkpoint = openAiCheckpoint({
        directory: directory ? path.join(directory, 'runs') : undefined
    })
    const host = createAiRunHost({
        ...checkpoint,
        runner,
        history: 3,
        capabilities: [{
            kind: 'extract',
            label: 'Извлечь строки CSV / TXT / текстового PDF',
            acceptsResources: true
        }],
        policy: {
            canRead: (account, run) => run.owner == account,
            canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = inputOf(request.input)
                    const document = authorityItem(account, input.orgId, input.documentId)
                    if (request.kind != 'extract' || request.resourceIds?.length != 1) return false
                    if (request.resourceIds[0] != document.id) return false
                    const runs = Object.values(host.store.state.runs)
                    // Повтор того же requestId возвращает прежний запуск и лимитами не ограничен.
                    const repeat = runs.some(function same(run) {
                        return run.owner == account && run.requestId == request.requestId
                    })
                    if (repeat) return true
                    const startable = ['uploaded', 'failed', 'cancelled', 'uncertain']
                    if (document.revision != input.revision) return false
                    if (!startable.includes(document.status) || runs.length >= 50) return false
                    const active = runs.filter(run => ['queued', 'running'].includes(run.state))
                    if (active.length >= 2) return false
                    return !active.some(run => run.resourceIds.includes(document.id))
                } catch {return false}
            }
        }
    })
    function openProcessing(ctx: ServiceResourceContext) {
        ctx.signal.throwIfAborted()
        const account = ctx.principal.account
        const connection = host.connection(account)
        const controller = new AbortController()
        const signal = AbortSignal.any([ctx.signal, controller.signal])
        let closed = false
        let expiry: ReturnType<typeof setTimeout> | undefined
        let off = () => {}
        const transfers = new Map<string, Transfer>()
        function active() {
            signal.throwIfAborted()
            if (closed) throw new Error('Подключение обработчика закрыто')
            state()
            if (account.startsWith('product:')) requireProductKey(state(), account, undefined, now())
            else if (!Object.hasOwn(state().accounts, account)) throw new Error('Аккаунт недоступен')
            if (!blobs || !execute) throw new Error('Хранилище не подключено')
        }
        function beginUpload(orgId: string) {
            active()
            organization(account, orgId)
            for (const [id, transfer] of transfers) {
                const done = ['completed', 'cancelled'].includes(transfer.phase)
                const stale = transfer.phase != 'committing' && Date.now() - transfer.createdAt >= 60000
                if (!done && !stale) continue
                transfer.controller.abort()
                transfers.delete(id)
            }
            if (transfers.size >= 8) throw new Error('Завершите текущие загрузки или подождите минуту')
            const uploadId = randomUUID()
            transfers.set(uploadId, {
                orgId,
                controller: new AbortController(),
                createdAt: Date.now(),
                phase: 'pending',
                documentId: ''
            })
            return {uploadId}
        }
        function cancelUpload(uploadId: string) {
            active()
            const transfer = transfers.get(uploadId)
            if (!transfer) throw new Error('Загрузка недоступна в этом подключении')
            organization(account, transfer.orgId)
            if (transfer.phase == 'committing' || transfer.phase == 'completed') return {status: transfer.phase, documentId: transfer.documentId}
            transfer.controller.abort(new Error('Загрузка отменена'))
            transfer.phase = 'cancelled'
            return {status: 'cancelled' as const, documentId: ''}
        }
        async function upload(input: {orgId: string, name: string, bytes: Uint8Array, uploadId?: string}, operationSignal = signal) {
            const transfer = input.uploadId ? transfers.get(input.uploadId) : null
            const usable = transfer && transfer.orgId == input.orgId && transfer.phase == 'pending'
            if (input.uploadId && !usable) throw new Error('Загрузка отменена или завершена')
            const left = transfer ? Math.max(1, 60000 - (Date.now() - transfer.createdAt)) : 0
            const limits = transfer ? [transfer.controller.signal, AbortSignal.timeout(left)] : []
            const uploadSignal = AbortSignal.any([signal, operationSignal, ...limits])
            uploadSignal.throwIfAborted()
            await ready
            if (filesQueue.size >= 4) throw new Error('Очередь загрузки заполнена. Повторите позже')
            const uploaded = await filesQueue.add(async function commitUpload() {
            uploadSignal.throwIfAborted()
            active()
            organization(account, input.orgId)
            if (!acceptedName(input.name)) {
                throw new Error('Загрузите CSV, TXT или PDF с именем до 160 символов')
            }
            if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > 512 * 1024) throw new Error('Файл от 1 байта до 512 КиБ')
            if (!/\.pdf$/i.test(input.name)) new TextDecoder('utf-8', {fatal: true}).decode(input.bytes)
            const name = path.basename(input.name)
            const id = createHash('sha256').update(JSON.stringify([input.orgId, account, name])).update(input.bytes).digest('hex')
            const old = state().documents[id]
            if (old && old.status != 'deleted') {
                item(account, input.orgId, id)
                if (transfer) {
                    transfer.phase = 'completed'
                    transfer.documentId = id
                }
                return {id, revision: old.revision}
            }
            if (!old && Object.keys(state().documents).length + uploads.size >= 50) throw new Error('На стенде допускается 50 документов')
            if (uploads.has(id)) throw new Error('Этот файл уже загружается')
            uploads.add(id)
            try {
                const stored = await blobs!.control.upload({account, orgId: input.orgId, signal: uploadSignal}, input.bytes)
                uploadSignal.throwIfAborted()
                active()
                organization(account, input.orgId)
                // Cancellation can stop byte IO/queue work. Once metadata is committing, report that boundary honestly.
                if (transfer) {
                    transfer.phase = 'committing'
                    transfer.documentId = id
                }
                const request = 'upload-' + id + '-source-' + ((old?.sourceVersion ?? 0) + 1)
                const imported = await execute!.documentImport(request, {
                    id,
                    orgId: input.orgId,
                    actor: account,
                    name,
                    blobId: stored.id,
                    size: stored.size
                })
                uploadSignal.throwIfAborted()
                active()
                const created = item(account, input.orgId, imported.id)
                if (created.owner != account || created.blobId != stored.id) throw new Error('Ответ импорта не принадлежит этой загрузке')
                deleted.delete(id)
                if (transfer) transfer.phase = 'completed'
                return imported
            } catch (error) {
                if (transfer && transfer.phase != 'completed') transfer.phase = 'cancelled'
                throw error
            }
            finally {
                uploads.delete(id)
                await cleanup()
            }
            })
            uploadSignal.throwIfAborted()
            active()
            item(account, input.orgId, uploaded.id)
            return uploaded
        }
        async function download(input: {orgId: string, id: string}) {
            await ready
            active()
            const document = item(account, input.orgId, input.id)
            const name = document.name
            const bytes = await blobs!.resource.read({account, orgId: input.orgId, id: input.id, signal}, document.blobId)
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
                originalText: pdfNotice(document.name, original.bytes)
            }
        }
        async function status(input: {orgId: string, id: string}) {
            await ready
            active()
            const document = item(account, input.orgId, input.id)
            return {
                id: document.id,
                orgId: document.orgId,
                name: document.name,
                revision: document.revision,
                sourceVersion: document.sourceVersion,
                status: document.status,
                attempt: document.attempt,
                processor: document.processor,
                rowCount: document.table.rows.length,
                error: document.error,
                approvedRevision: document.approvals.at(-1)?.revision ?? 0
            }
        }
        async function compare(input: {orgId: string, id: string, revision: number, approvedRevision: number}) {
            await ready
            active()
            const document = matches(account, input)
            const approved = document.approvals.find(value => value.revision == input.approvedRevision)
            if (!approved) throw new Error('Утверждённая версия недоступна')
            const current = {
                revision: document.revision,
                sourceVersion: document.sourceVersion,
                table: validateTable(document.table)
            }
            return {current, previous: {...approved, table: validateTable(approved.table)}}
        }
        async function exportDocument(input: {orgId: string, id: string, revision: number, format: 'csv' | 'json'}) {
            await ready
            active()
            const document = matches(account, input)
            const approved = document.approvals.at(-1)
            const current = approved && approved.revision == document.revision
            if (document.status != 'approved' || !current) {
                throw new Error('Экспорт доступен после утверждения текущей версии')
            }
            if (!['csv', 'json'].includes(input.format)) throw new Error('Выберите CSV или JSON')
            function cell(value: string) {
                const safe = /^[=+\-@\t\r]/.test(value) ? "'" + value : value
                return '"' + safe.replaceAll('"', '""') + '"'
            }
            const provenance = approved.provenance ? {provenance: approved.provenance} : {}
            const document_json = {
                sourceVersion: approved.sourceVersion,
                approvedRevision: approved.revision,
                ...approved.table,
                ...provenance
            }
            const lines = [approved.table.headers, ...approved.table.rows]
            const text = input.format == 'json'
                ? JSON.stringify(document_json, null, 2)
                : lines.map(row => row.map(cell).join(',')).join('\r\n')
            const name = document.name.replace(/\.[^.]+$/, '') + '-approved.' + input.format
            return {name, bytes: new Uint8Array(Buffer.from(text))}
        }
        const control = {
            beginUpload,
            cancelUpload,
            upload,
            download,
            detail,
            status,
            compare,
            export: exportDocument
        }
        const reference = {orgId: 'string', id: 'string'} as const
        const validateUpload = buildInputValidate({orgId: 'string', name: 'string', bytes: {array: 'number'}})
        const validateStart = buildInputValidate({...reference, revision: 'number', processor: {enum: ['node', 'python', 'model']}, requestId: 'string'})
        const validateStatus = buildInputValidate(reference)
        const validateResult = buildInputValidate({...reference, revision: 'number'})
        async function productUpload(input: {orgId: string, name: string, bytes: Uint8Array}) {
            const deadline = AbortSignal.timeout(12000)
            if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 512 * 1024) throw new Error('Нужны bytes файла до 512 КиБ')
            validateUpload({...input, bytes: [...input.bytes]})
            input = Object.freeze({...input, bytes: new Uint8Array(input.bytes)})
            const result = await upload(input, deadline)
            deadline.throwIfAborted()
            active()
            item(account, input.orgId, result.id)
            return result
        }
        async function start(input: {orgId: string, id: string, revision: number, processor: string, requestId: string}) {
            const deadline = AbortSignal.timeout(12000)
            validateStart(input)
            input = Object.freeze({...input})
            if (!/^[\w.-]{1,100}$/.test(input.requestId)) throw new Error('Укажите устойчивый requestId')
            await ready
            deadline.throwIfAborted()
            active()
            item(account, input.orgId, input.id)
            const run = connection.fragment.createRun({requestId: input.requestId, kind: 'extract', resourceIds: [input.id],
                input: {orgId: input.orgId, documentId: input.id, revision: input.revision, processor: input.processor}})
            active()
            const target = item(account, input.orgId, run.resourceIds[0])
            if (run.owner != account || target.id != input.id) throw new Error('Ответ запуска не принадлежит этому документу')
            return {runId: run.id, documentId: target.id, state: run.state}
        }
        async function productStatus(input: {orgId: string, id: string}) {
            const deadline = AbortSignal.timeout(12000)
            validateStatus(input)
            input = Object.freeze({...input})
            await ready
            deadline.throwIfAborted()
            active()
            const document = item(account, input.orgId, input.id)
            const run = host.store.state.runs[document.activeRun]
            return {id: document.id, revision: document.revision, sourceVersion: document.sourceVersion, status: document.status,
                attempt: document.attempt, processor: document.processor, rowCount: document.table.rows.length, error: document.error,
                runId: run?.id ?? '', runState: run?.state ?? null, usageReceipt: document.usageReceipt ? {...document.usageReceipt} : null}
        }
        async function result(input: {orgId: string, id: string, revision: number}) {
            const deadline = AbortSignal.timeout(12000)
            validateResult(input)
            input = Object.freeze({...input})
            await ready
            deadline.throwIfAborted()
            active()
            const document = matches(account, input)
            return {id: document.id, revision: document.revision, sourceVersion: document.sourceVersion, status: document.status,
                usageReceipt: document.usageReceipt ? {...document.usageReceipt} : null,
                table: {headers: [...document.table.headers], rows: document.table.rows.map(row => [...row])},
                provenance: document.provenance ? {...document.provenance, fields: document.provenance.fields.map(field => ({...field}))} : null}
        }
        function close() {
            if (closed) return
            closed = true
            controller.abort(new Error('Подключение обработчика закрыто'))
            clearTimeout(expiry)
            off()
            ctx.signal.removeEventListener('abort', close)
            for (const transfer of transfers.values()) transfer.controller.abort()
            transfers.clear()
            connection.close()
        }
        ctx.signal.addEventListener('abort', close, {once: true})
        if (account.startsWith('product:')) {
            try {
                function scheduleExpiry() {
                    const key = requireProductKey(state(), account, undefined, now())
                    // Node timers cannot represent the full allowed 90-day credential lifetime.
                    const remaining = Math.min(2147483647, Math.max(1, key.expiresAt - now()))
                    expiry = setTimeout(function checkExpiry() {
                        try {scheduleExpiry()} catch {close()}
                    }, remaining)
                }
                scheduleExpiry()
                off = store!.on(function keyChanged() {
                    try {active()} catch {close()}
                })
            } catch (error) {
                close()
                throw error
            }
        }
        function createRun(input: Parameters<typeof connection.fragment.createRun>[0]) {
            active()
            const run = connection.fragment.createRun(input)
            active()
            return run
        }
        return {facade: {ai: {...connection.fragment, createRun}, control}, product: {upload: productUpload, start, status: productStatus, result}, close}
    }
    const resource = {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        if (ctx.principal.account.startsWith('product:')) throw new Error('Машинный ключ не является участником')
        return openProcessing(ctx)
    }}
    const productResource = {allow: ['documents:extract'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = openProcessing(ctx)
        return {facade: {control: connection.product}, close: connection.close}
    }}
    function mount(deps: {store: Store<DocumentState>, execute: DocumentExecutor}) {
        store = deps.store
        execute = deps.execute
        ready = filesQueue.add(async function recover() {
            for (const document of Object.values(store!.state.documents)) if (document.status == 'processing') {
                const run = host.store.state.runs[document.activeRun]
                await execute!.processingFailure(document.activeRun + '-recovery', {
                    orgId: document.orgId,
                    id: document.id,
                    actor: run?.owner ?? document.owner,
                    runId: document.activeRun,
                    status: 'uncertain',
                    error: 'Сервис перезапущен. Начните новую попытку после проверки исходного файла'
                })
            }
            for (const run of Object.values(host.store.state.runs)) if (run.recovery) {
                const document = store!.state.documents[run.resourceIds[0]]
                const mine = document && document.activeRun == run.id
                if (mine && ['review', 'approved'].includes(document.status)) {
                    host.recovery.settle(run.id, {state: 'completed', output: {result: {available: true}}})
                    continue
                }
                const error = 'Работа прервана перезапуском.'
                    + ' Разрешена новая попытка после проверки документа'
                host.recovery.settle(run.id, {state: 'failed', error})
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
        return function close() {
            closing = true
            off()
            for (const controller of pending.values()) controller.abort()
            host.close()
        }
    }
    return {resource, productResource, mount, view: {ready: () => ready}}
}

