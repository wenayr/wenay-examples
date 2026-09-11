import path from 'node:path'
import {createHash} from 'node:crypto'
import {createLocalBlobStorage} from 'wenay-common2/server/blob'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {access, assetReferenced, hash, own, publicPage} from './domain'
import {ROLES, WRITERS, type ContentState} from './model'
import type {contentDefinition} from './service'

type Context = {orgId: string, account: string, public: boolean, signal?: AbortSignal}
export function imageMime(bytes: Uint8Array) {
    const buffer = Buffer.from(bytes)
    if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) == 'IHDR') return 'image/png' as const
    if (buffer.length >= 4 && buffer[0] == 255 && buffer[1] == 216 && buffer[2] == 255 && buffer.at(-2) == 255 && buffer.at(-1) == 217) return 'image/jpeg' as const
    if (buffer.length >= 16 && buffer.toString('ascii', 0, 4) == 'RIFF' && buffer.toString('ascii', 8, 12) == 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) return 'image/webp' as const
    throw new Error('Поддерживаются PNG, JPEG и WebP с соответствующей сигнатурой')
}
export function createContentFiles(deps: {directory?: string}) {
    let state: Store<ContentState> | null = null
    let system: ReturnType<typeof createServiceLeader<typeof contentDefinition>>['corridor']['system'] | null = null
    const busy = new Set<string>()
    const stores = new Map<string, ReturnType<typeof createLocalBlobStorage<Context>>>()
    function requireAsset(ctx: Context, id: string, removing = false) {
        ctx.signal?.throwIfAborted()
        if (!state) throw new Error('Файлы не подключены')
        const asset = own(state.state.assets, id)
        if (!asset || asset.orgId != ctx.orgId || asset.removedAt && !removing) throw new Error('Изображение недоступно')
        if (ctx.public) {
            if (!Object.values(state.state.pages).some(page => page.orgId == ctx.orgId && publicPage(state!.state, page)?.blocks.some(block => block.assetId == id))) throw new Error('Изображение не опубликовано')
        } else access(state.state, ctx.account, ctx.orgId, removing ? WRITERS : ROLES.filter(role => role != 'reader'))
        if (removing && assetReferenced(state.state, id)) throw new Error('Изображение используется')
        return asset
    }
    function storage(orgId: string) {
        if (!deps.directory || !state || !own(state.state.organizations, orgId)) throw new Error('Хранилище не подключено')
        let blobs = stores.get(orgId)
        if (!blobs) {
            blobs = createLocalBlobStorage<Context>({directory: path.join(deps.directory, hash(orgId)), maxBytes: 512 * 1024,
                validate(bytes) {imageMime(bytes)}, identify(bytes) {return hash(orgId, createHash('sha256').update(bytes).digest('hex'))},
                authorize({context, operation, id}) {
                    context.signal?.throwIfAborted()
                    if (!state) throw new Error('Файлы закрыты')
                    if (operation == 'upload') access(state.state, context.account, context.orgId, WRITERS)
                    else requireAsset(context, id!, operation == 'remove')
                }})
            stores.set(orgId, blobs)
        }
        return blobs
    }
    async function read(ctx: Context, id: string) {
        const before = requireAsset(ctx, id)
        const bytes = await storage(ctx.orgId).resource.read(ctx, id)
        const current = requireAsset(ctx, id)
        if (before.hash != current.hash || createHash('sha256').update(bytes).digest('hex') != current.hash) throw new Error('Контрольная сумма изображения не совпала')
        return {bytes: new Uint8Array(bytes), mime: current.mime, name: current.name}
    }
    const resource = {allow: ['owner', 'author', 'editor', 'publisher'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        async function upload(input: {orgId: string, name: string, bytes: Uint8Array}) {
            ctx.signal.throwIfAborted()
            if (!state || !system) throw new Error('Файлы закрыты')
            access(state.state, ctx.principal.account, input.orgId, WRITERS)
            if (typeof input.name != 'string' || !input.name.trim() || input.name.length > 160 || /[\x00-\x1f]/.test(input.name)) throw new Error('Укажите имя файла до 160 символов')
            if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > 512 * 1024) throw new Error('Максимум 512 КиБ')
            const mime = imageMime(input.bytes), checksum = createHash('sha256').update(input.bytes).digest('hex'), id = hash(input.orgId, checksum)
            if (busy.has(id)) throw new Error('Этот файл уже обрабатывается')
            if (Object.values(state.state.assets).filter(asset => !asset.removedAt).length + busy.size >= 200 && !own(state.state.assets, id)) throw new Error('Предел 200 изображений')
            busy.add(id)
            try {
                const old = own(state.state.assets, id)
                if (old && !old.removedAt) return {...old}
                await storage(input.orgId).control.upload({orgId: input.orgId, account: ctx.principal.account, public: false, signal: ctx.signal}, input.bytes)
                ctx.signal.throwIfAborted(); access(state.state, ctx.principal.account, input.orgId, WRITERS)
                return await system.assetRegister('asset-register-' + crypto.randomUUID(), {account: ctx.principal.account, orgId: input.orgId, id, hash: checksum, name: path.basename(input.name), mime, size: input.bytes.length})
            } finally {busy.delete(id)}
        }
        async function remove(input: {orgId: string, id: string}) {
            ctx.signal.throwIfAborted()
            if (!state || !system) throw new Error('Файлы закрыты')
            const context = {orgId: input.orgId, account: ctx.principal.account, public: false, signal: ctx.signal}
            requireAsset(context, input.id, true)
            if (busy.has(input.id)) throw new Error('Этот файл уже обрабатывается')
            busy.add(input.id)
            try {
                // Tombstone is committed before async IO; a new draft cannot reference bytes being removed.
                await system.assetForget('asset-forget-' + crypto.randomUUID(), {...input, account: ctx.principal.account})
                await storage(input.orgId).control.remove(context, input.id)
                return {id: input.id, removed: true}
            } finally {busy.delete(input.id)}
        }
        return {facade: {control: {upload, remove, download(input: {orgId: string, id: string}) {return read({orgId: input.orgId, account: ctx.principal.account, public: false, signal: ctx.signal}, input.id)}}}, close() {}}
    }}
    return {resource, publicRead(orgId: string, id: string, signal?: AbortSignal) {return read({orgId, account: '', public: true, signal}, id)},
        mount(deps: {store: Store<ContentState>, system: NonNullable<typeof system>}) {state = deps.store; system = deps.system; return function close() {state = null; system = null; stores.clear()}}}
}
