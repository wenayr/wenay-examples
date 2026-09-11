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
        authorize({context}) {if ('internal' in context) return; context.signal.throwIfAborted(); current(context.account, context.orgId, context.formId, context.revision)}})
    const runner: AiRunRunner = {async run(ctx) {
        await ready
        const input = ctx.input as {orgId: string, formId: string, revision: number, version: number, format: 'csv' | 'json'}
        const form = current(ctx.run.owner, input.orgId, input.formId, input.revision)
        const controller = new AbortController()
        pending.set(ctx.run.id, {account: ctx.run.owner, orgId: input.orgId, formId: input.formId, revision: input.revision, controller})
        const access: Access = {account: ctx.run.owner, orgId: input.orgId, formId: input.formId, revision: input.revision, signal: controller.signal}
        try {
            const ids = Object.values(store!.state.submissions).filter(value => value.formId == form.id && value.expiresAt > now() && (!input.version || value.version == input.version)).map(value => value.id).sort()
            const headers = ['id', 'version', 'createdAt', ...new Set(form.versions.flatMap(version => version.fields.map(field => field.id)))]
            function cell(value: unknown) {const text = String(value ?? ''); return '"' + (/^[=+\-@\t\r\n]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"'}
            const chunks = [input.format == 'json' ? '[' : headers.map(cell).join(',') + '\r\n']
            let size = Buffer.byteLength(chunks[0]), expiresAt = now() + 365 * 86400000
            for (let offset = 0; offset < ids.length; offset += 100) {
                controller.signal.throwIfAborted()
                current(ctx.run.owner, input.orgId, input.formId, input.revision)
                for (const [index, id] of ids.slice(offset, offset + 100).entries()) {
                    const row = store!.state.submissions[id]
                    if (!row || row.expiresAt <= now()) throw new Error('Срок хранения ответа завершился')
                    expiresAt = Math.min(expiresAt, row.expiresAt)
                    const text = input.format == 'json' ? (offset + index ? ',' : '') + JSON.stringify({...row, answers: {...row.answers}}) :
                        [row.id, row.version, new Date(row.createdAt).toISOString(), ...headers.slice(3).map(id => row.answers[id] ?? '')].map(cell).join(',') + '\r\n'
                    size += Buffer.byteLength(text)
                    if (size > 2 * 1024 * 1024 - 1) throw new Error('Выгрузка больше 2 MiB: выберите одну версию')
                    chunks.push(text)
                }
                ctx.report({progress: ids.length ? Math.min(0.9, (offset + 100) / ids.length * 0.9) : 0.9, message: 'Выгрузка разрешённых строк'})
                await new Promise<void>(resolve => setImmediate(resolve))
            }
            if (input.format == 'json') chunks.push(']')
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            await io.add(async function saveExport() {
                const uploaded = await blobs.control.upload(access, Buffer.from(chunks.join('')))
                current(ctx.run.owner, input.orgId, input.formId, input.revision)
                files[ctx.run.id] = {owner: ctx.run.owner, orgId: input.orgId, formId: input.formId, revision: input.revision, blobId: uploaded.id,
                    name: 'responses.' + input.format, mime: input.format == 'json' ? 'application/json' : 'text/csv', expiresAt}
                journal.save(files)
            })
            requestCleanup()
            return {result: {available: true}}
        } catch {throw new Error('Выгрузка не завершена: проверьте доступ, актуальность ответов и предел 2 MiB')}
        finally {pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: path.join(deps.directory, 'runs')}), runner, history: 5,
        capabilities: [{kind: 'export', label: 'Выгрузить ответы CSV/JSON'}],
        policy: {canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId?: unknown, formId?: unknown, revision?: unknown, version?: unknown, format?: unknown} | null
                    if (request.kind != 'export' || !input || typeof input.orgId != 'string' || typeof input.formId != 'string' || !Number.isSafeInteger(input.revision) || !Number.isInteger(input.version) || Number(input.version) < 0 || !['csv', 'json'].includes(String(input.format))) return false
                    const form = current(account, input.orgId, input.formId, Number(input.revision))
                    if (input.version && !form.versions.some(version => version.version == input.version) || request.resourceIds?.length != 1 || request.resourceIds[0] != form.id) return false
                    const runs = Object.values(host.store.state.runs)
                    return runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 20 && !runs.some(run => ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state))
                } catch {return false}
            }}})
    for (const entry of host.recovery.pending()) host.recovery.settle(entry.run.id, {state: 'failed', error: 'Выгрузка прервана рестартом. Запустите новую после проверки'})
    const resource = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {async result(runId: string) {
            await ready
            ctx.signal.throwIfAborted()
            const output = Object.hasOwn(files, runId) ? files[runId] : undefined
            if (!output || output.owner != ctx.principal.account || output.expiresAt <= now() || host.store.state.runs[runId]?.state != 'completed') throw new Error('Выгрузка недоступна')
            const bytes = await blobs.resource.read({account: ctx.principal.account, orgId: output.orgId, formId: output.formId, revision: output.revision, signal: ctx.signal}, output.blobId)
            return {name: output.name, mime: output.mime, bytes: new Uint8Array(bytes)}
        }}}, close: connection.close}
    }}
    function mount(input: {store: Store<FormsState>, execute: System}) {
        store = input.store; execute = input.execute
        const worker = createReconciler({read: () => ({due: Object.values(store!.state.submissions).reduce((at, value) => Math.min(at, value.expiresAt), Number.MAX_SAFE_INTEGER)}),
            subscribe: store.listen().on,
            async run(snapshot, ctx) {
                if (snapshot.due <= now()) await execute!.retentionSweep(randomUUID(), {})
                await io.add(async function removeStaleExports() {
                    for (const [id, output] of Object.entries(files)) {
                        let valid = output.expiresAt > now()
                        try {current(output.owner, output.orgId, output.formId, output.revision)} catch {valid = false}
                        if (!valid) {delete files[id]; journal.save(files); if (!Object.values(files).some(value => value.blobId == output.blobId)) await blobs.control.remove({internal: true}, output.blobId)}
                    }
                })
                const earliest = Math.min(...Object.values(store!.state.submissions).map(value => value.expiresAt), ...Object.values(files).map(value => value.expiresAt))
                if (Number.isFinite(earliest)) ctx.retry('retention', Math.max(1, Math.min(2147483647, earliest - now())))
                for (const job of pending.values()) {try {current(job.account, job.orgId, job.formId, job.revision)} catch {job.controller.abort()}}
            }})
        requestCleanup = worker.control.request
        ready = (async function recoverFiles() {
            const names = await readdir(path.join(deps.directory, 'files'))
            const retained = new Set(Object.values(files).map(value => value.blobId))
            for (const name of names) if (/^[a-f0-9]{64}$/.test(name) && !retained.has(name)) await blobs.control.remove({internal: true}, name)
            worker.control.request()
        })()
        return async function close() {for (const job of pending.values()) job.controller.abort(); host.close(); await ready; await worker.close(); await io.onIdle(); store = null; execute = null}
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
