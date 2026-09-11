import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {readdir} from 'node:fs/promises'
import {createAsyncQueue, createReconciler} from 'wenay-common2'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {createLocalBlobStorage} from 'wenay-common2/server/blob'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {formsDefinition} from './service'
import {formAccess} from './domain'
import {STAFF, type FormsState} from './model'
import {openAiCheckpoint} from './ai-checkpoint'

type ExportFile = {owner: string, orgId: string, formId: string, revision: number, blobId: string, name: string, mime: string, expiresAt: number}
type Access = {internal: true} | {account: string, orgId: string, formId: string, revision: number, signal: AbortSignal}
type System = ReturnType<typeof createServiceLeader<typeof formsDefinition>>['corridor']['system']
type ExportInput = {
    orgId: string,
    formId: string,
    revision: number,
    version: number,
    format: 'csv' | 'json'
}

type ExportRequest = {
    orgId?: unknown,
    formId?: unknown,
    revision?: unknown,
    version?: unknown,
    format?: unknown
} | null

function wellFormedExport(input: ExportRequest): input is ExportInput {
    if (!input || typeof input.orgId != 'string' || typeof input.formId != 'string') return false
    if (!Number.isSafeInteger(input.revision)) return false
    if (!Number.isInteger(input.version) || Number(input.version) < 0) return false
    return ['csv', 'json'].includes(String(input.format))
}

function nextExpiry(values: {expiresAt: number}[]) {
    return values.reduce((at, value) => Math.min(at, value.expiresAt), Number.MAX_SAFE_INTEGER)
}

export function createFormsExports(deps: {directory: string, now?: () => number}) {
    const now = deps.now ?? Date.now
    let store: Store<FormsState> | null = null, execute: System | null = null
    const journal = openFiles(deps.directory), files = journal.initial
    const io = createAsyncQueue(1)
    mkdirSync(path.join(deps.directory, 'files'), {recursive: true})
    const pending = new Map<string, {account: string, orgId: string, formId: string, revision: number, controller: AbortController}>()
    let ready: Promise<void> = Promise.resolve(), requestCleanup = () => {}
    function current(account: string, orgId: string, formId: string, revision: number) {
        if (!store) throw new Error('Экспорт закрыт')
        const {form} = formAccess(store.state, account, orgId, formId)
        if (form.answersRevision != revision) throw new Error('Ответы изменились. Подготовьте новую выгрузку')
        return form
    }
    const blobs = createLocalBlobStorage<Access>({directory: path.join(deps.directory, 'files'), maxBytes: 2 * 1024 * 1024,
        authorize({context}) {
            if ('internal' in context) return
            context.signal.throwIfAborted()
            current(context.account, context.orgId, context.formId, context.revision)
        }})
    const runner: AiRunRunner = {async run(ctx) {
        await ready
        const input = ctx.input as ExportInput
        const form = current(ctx.run.owner, input.orgId, input.formId, input.revision)
        const controller = new AbortController()
        const scope = {
            account: ctx.run.owner,
            orgId: input.orgId,
            formId: input.formId,
            revision: input.revision
        }
        pending.set(ctx.run.id, {...scope, controller})
        const access: Access = {...scope, signal: controller.signal}
        try {
            const live = Object.values(store!.state.submissions).filter(function exported(value) {
                if (value.formId != form.id || value.expiresAt <= now()) return false
                return !input.version || value.version == input.version
            })
            const ids = live.map(value => value.id).sort()
            const fields = form.versions.flatMap(version => version.fields.map(field => field.id))
            const headers = ['id', 'version', 'createdAt', ...new Set(fields)]
            function cell(value: unknown) {
                const text = String(value ?? '')
                return '"' + (/^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"'
            }
            const chunks = [input.format == 'json' ? '[' : headers.map(cell).join(',') + '\r\n']
            let size = Buffer.byteLength(chunks[0])
            let expiresAt = now() + 365 * 86400000
            for (let offset = 0; offset < ids.length; offset += 100) {
                controller.signal.throwIfAborted()
                current(ctx.run.owner, input.orgId, input.formId, input.revision)
                for (const [index, id] of ids.slice(offset, offset + 100).entries()) {
                    const row = store!.state.submissions[id]
                    if (!row || row.expiresAt <= now()) throw new Error('Срок хранения ответа завершился')
                    expiresAt = Math.min(expiresAt, row.expiresAt)
                    const answers = headers.slice(3).map(field => row.answers[field] ?? '')
                    const line = [row.id, row.version, new Date(row.createdAt).toISOString(), ...answers]
                    const separator = offset + index ? ',' : ''
                    const text = input.format == 'json'
                        ? separator + JSON.stringify({...row, answers: {...row.answers}})
                        : line.map(cell).join(',') + '\r\n'
                    size += Buffer.byteLength(text)
                    if (size > 2 * 1024 * 1024 - 1) throw new Error('Выгрузка больше 2 MiB: выберите одну версию')
                    chunks.push(text)
                }
                const done = ids.length ? Math.min(0.9, (offset + 100) / ids.length * 0.9) : 0.9
                ctx.report({progress: done, message: 'Выгрузка разрешённых строк'})
                await new Promise<void>(resolve => setImmediate(resolve))
            }
            if (input.format == 'json') chunks.push(']')
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            await io.add(async function saveExport() {
                const uploaded = await blobs.control.upload(access, Buffer.from(chunks.join('')))
                current(ctx.run.owner, input.orgId, input.formId, input.revision)
                files[ctx.run.id] = {
                    owner: ctx.run.owner,
                    orgId: input.orgId,
                    formId: input.formId,
                    revision: input.revision,
                    blobId: uploaded.id,
                    name: 'responses.' + input.format,
                    mime: input.format == 'json' ? 'application/json' : 'text/csv',
                    expiresAt
                }
                journal.save(files)
            })
            requestCleanup()
            return {result: {available: true}}
        } catch {
            throw new Error('Выгрузка не завершена: проверьте доступ, актуальность ответов и предел 2 MiB')
        } finally {
            pending.delete(ctx.run.id)
        }
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({
        ...openAiCheckpoint({directory: path.join(deps.directory, 'runs')}),
        runner,
        history: 5,
        capabilities: [{kind: 'export', label: 'Выгрузить ответы CSV/JSON'}],
        policy: {
            canRead: (account, run) => run.owner == account,
            canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as ExportRequest
                    if (request.kind != 'export' || !wellFormedExport(input)) return false
                    const form = current(account, input.orgId, input.formId, Number(input.revision))
                    const known = !input.version || form.versions.some(function present(version) {
                        return version.version == input.version
                    })
                    if (!known || request.resourceIds?.length != 1) return false
                    if (request.resourceIds[0] != form.id) return false
                    const runs = Object.values(host.store.state.runs)
                    // Повтор того же requestId возвращает прежнюю выгрузку и лимитами не ограничен.
                    const repeat = runs.some(function same(run) {
                        return run.owner == account && run.requestId == request.requestId
                    })
                    if (repeat) return true
                    if (runs.length >= 20) return false
                    const busyStates = ['queued', 'running', 'waiting_input', 'waiting_approval']
                    return !runs.some(run => busyStates.includes(run.state))
                } catch {return false}
            }
        }
    })
    const restartError = 'Выгрузка прервана рестартом. Запустите новую после проверки'
    for (const entry of host.recovery.pending()) {
        host.recovery.settle(entry.run.id, {state: 'failed', error: restartError})
    }
    const resource = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        async function result(runId: string) {
            await ready
            ctx.signal.throwIfAborted()
            const output = Object.hasOwn(files, runId) ? files[runId] : undefined
            const mine = output && output.owner == ctx.principal.account
            const fresh = output && output.expiresAt > now()
            const finished = host.store.state.runs[runId]?.state == 'completed'
            if (!mine || !fresh || !finished) throw new Error('Выгрузка недоступна')
            const bytes = await blobs.resource.read({
                account: ctx.principal.account,
                orgId: output!.orgId,
                formId: output!.formId,
                revision: output!.revision,
                signal: ctx.signal
            }, output!.blobId)
            return {name: output!.name, mime: output!.mime, bytes: new Uint8Array(bytes)}
        }
        return {facade: {ai: connection.fragment, control: {result}}, close: connection.close}
    }}
    function mount(input: {store: Store<FormsState>, execute: System}) {
        store = input.store
        execute = input.execute
        const worker = createReconciler({
            read: () => ({due: nextExpiry(Object.values(store!.state.submissions))}),
            subscribe: store.listen().on,
            async run(snapshot, ctx) {
                if (snapshot.due <= now()) await execute!.retentionSweep(randomUUID(), {})
                await io.add(async function removeStaleExports() {
                    for (const [id, output] of Object.entries(files)) {
                        let valid = output.expiresAt > now()
                        try {current(output.owner, output.orgId, output.formId, output.revision)} catch {valid = false}
                        if (!valid) {
                            delete files[id]
                            journal.save(files)
                            const shared = Object.values(files).some(function same(value) {
                                return value.blobId == output.blobId
                            })
                            if (!shared) await blobs.control.remove({internal: true}, output.blobId)
                        }
                    }
                })
                const earliest = Math.min(
                    ...Object.values(store!.state.submissions).map(value => value.expiresAt),
                    ...Object.values(files).map(value => value.expiresAt)
                )
                if (Number.isFinite(earliest)) {
                    ctx.retry('retention', Math.max(1, Math.min(2147483647, earliest - now())))
                }
                // Потерянный доступ к форме прерывает уже идущую выгрузку.
                for (const job of pending.values()) {
                    try {
                        current(job.account, job.orgId, job.formId, job.revision)
                    } catch {
                        job.controller.abort()
                    }
                }
            }
        })
        requestCleanup = worker.control.request
        ready = (async function recoverFiles() {
            const names = await readdir(path.join(deps.directory, 'files'))
            const retained = new Set(Object.values(files).map(value => value.blobId))
            for (const name of names) if (/^[a-f0-9]{64}$/.test(name) && !retained.has(name)) await blobs.control.remove({internal: true}, name)
            worker.control.request()
        })()
        return async function close() {
            for (const job of pending.values()) job.controller.abort()
            host.close()
            await ready
            await worker.close()
            await io.onIdle()
            store = null
            execute = null
        }
    }
    return {resource, mount}
}
function openFiles(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'files.replay'), storage = openFsReplayStorage<[Record<string, ExportFile>]>(file)
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, ExportFile>) {
        storage.putKeyframe({seq: Date.now(), ts: Date.now(), event: [value]})
        const descriptor = openSync(file, 'r+')
        try {fsyncSync(descriptor)} finally {closeSync(descriptor)}
    }}
}
