import path from 'node:path'
import {createHash} from 'node:crypto'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createLocalBlobStorage} from 'wenay-common2/server/blob'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import {createStore, exposeStoreReplay, type Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {SupportState} from './model'

export type Attachment = {id: string, ticketId: string, orgId: string, name: string, size: number, author: string, at: number, blobId: string}
function acceptedName(name: string) {
    if (typeof name != 'string' || !name.trim() || name.length > 160) return false
    return !/[\x00-\x1f]/.test(name)
}

export function createSupportFiles(deps: {directory?: string}) {
    let state: Store<SupportState> | null = null
    if (deps.directory) mkdirSync(deps.directory, {recursive: true})
    const file = deps.directory ? path.join(deps.directory, 'attachments.replay') : ''
    const journal = file ? openFsReplayStorage<[Record<string, Attachment>]>(file) : null
    const attachments = journal?.getKeyframe()?.event[0] ?? {}
    const connections = new Set<{account: string, store: Store<{files: Attachment[]}>}>()
    function allowed(account: string, orgId: string, ticketId: string) {
        const role = state?.state.organizations[orgId]?.members[account]
        const ticket = state?.state.tickets[ticketId]
        if (!role || !ticket || ticket.orgId != orgId) return false
        return role != 'customer' || ticket.customer == account
    }
    function requireTicket(account: string, orgId: string, ticketId: string) {
        if (!allowed(account, orgId, ticketId)) throw new Error('Нет доступа к вложениям обращения')
    }
    const blobs = deps.directory ? createLocalBlobStorage<{account: string, orgId: string, ticketId: string, signal?: AbortSignal}>({
        directory: path.join(deps.directory, 'blobs'), maxBytes: 512 * 1024,
        authorize({context, operation, id}) {
            context.signal?.throwIfAborted()
            requireTicket(context.account, context.orgId, context.ticketId)
            const linked = Object.values(attachments).some(function belongs(item) {
                if (item.blobId != id || item.orgId != context.orgId) return false
                return item.ticketId == context.ticketId
            })
            if (operation != 'upload' && !linked) throw new Error('Файл не принадлежит обращению')
        }
    }) : null
    function refresh() {
        for (const connection of connections) connection.store.state.files = Object.values(attachments)
            .filter(item => allowed(connection.account, item.orgId, item.ticketId)).map(item => ({...item})).sort((a, b) => b.at - a.at)
    }
    function save() {
        journal!.putKeyframe({seq: Date.now(), ts: Date.now(), event: [attachments]})
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
        refresh()
    }
    const resource = {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = {account: ctx.principal.account, store: createStore<{files: Attachment[]}>({files: []})}
        connections.add(connection)
        refresh()
        const replay = exposeStoreReplay(connection.store, {history: 2})
        function active() {
            ctx.signal.throwIfAborted()
            if (!state || !blobs) throw new Error('Хранилище не подключено')
        }
        async function upload(input: {orgId: string, ticketId: string, name: string, bytes: Uint8Array}) {
            active()
            requireTicket(connection.account, input.orgId, input.ticketId)
            if (!acceptedName(input.name)) throw new Error('Укажите имя файла до 160 символов')
            const sized = input.bytes instanceof Uint8Array && input.bytes.length
            if (!sized || input.bytes.length > 512 * 1024) {
                throw new Error('Файл должен быть от 1 байта до 512 КиБ')
            }
            const hash = createHash('sha256').update(input.bytes).digest('hex')
            const id = createHash('sha256').update(JSON.stringify([input.orgId, input.ticketId, hash])).digest('hex')
            if (Object.hasOwn(attachments, id)) return {...attachments[id]}
            // Reserve metadata capacity before IO; concurrent uploads cannot oversubscribe this bounded profile.
            const total = Object.keys(attachments).length + uploading.size
            const stored = Object.values(attachments).filter(item => item.ticketId == input.ticketId)
            const started = [...uploading.values()].filter(ticketId => ticketId == input.ticketId)
            if (total >= 100 || stored.length + started.length >= 10) {
                throw new Error('Достигнут предел: 10 файлов на обращение, 100 на экземпляр')
            }
            if (uploading.has(id)) throw new Error('Этот файл уже загружается. Дождитесь результата')
            uploading.set(id, input.ticketId)
            try {
                const context = {
                    account: connection.account,
                    orgId: input.orgId,
                    ticketId: input.ticketId,
                    signal: ctx.signal
                }
                const saved = await blobs!.control.upload(context, input.bytes)
                active()
                requireTicket(connection.account, input.orgId, input.ticketId)
                const attachment: Attachment = {
                    id,
                    orgId: input.orgId,
                    ticketId: input.ticketId,
                    name: path.basename(input.name),
                    size: saved.size,
                    author: connection.account,
                    at: Date.now(),
                    blobId: saved.id
                }
                attachments[id] = attachment
                try {save()} catch (error) {
                    delete attachments[id]
                    throw error
                }
                return {...attachment}
            } finally {uploading.delete(id)}
        }
        async function download(id: string) {
            active()
            const item = Object.hasOwn(attachments, id) ? attachments[id] : undefined
            if (!item) throw new Error('Файл недоступен')
            requireTicket(connection.account, item.orgId, item.ticketId)
            const bytes = await blobs!.resource.read({account: connection.account, orgId: item.orgId, ticketId: item.ticketId, signal: ctx.signal}, item.blobId)
            active()
            requireTicket(connection.account, item.orgId, item.ticketId)
            return {name: item.name, bytes: new Uint8Array(bytes)}
        }
        function close() {
            connections.delete(connection)
            replay.close()
        }
        return {facade: {view: replay.api.replay, control: {upload, download}}, close}
    }}
    const uploading = new Map<string, string>()
    function mount(store: Store<SupportState>) {
        state = store
        const off = store.on(refresh)
        return function close() {
            off()
            connections.clear()
            state = null
        }
    }
    return {resource, mount}
}
export type FilesFacade = ReturnType<ReturnType<typeof createSupportFiles>['resource']['open']>['facade']
