import {createServiceClient, type ServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import type {PublishedArticle, PublishedDefinition, PublishedIndex} from './published-contract'
import type {SupportState} from './model'
import {authorizeOrganization} from './domain'

type Target = {url: string, orgId: string, account: string, password: string}
function openPublished(client: ServiceClient<PublishedDefinition>) {return client.resources.open('published')}
type PublishedRemote = NonNullable<ReturnType<ReturnType<typeof openPublished>['current']>>['remote']
type ContentTarget = {url: string, orgId: string, account: string, password: string}

// Подключение задаёт оператор: проверяем каждое поле отдельно.
function describedTarget(item: ContentTarget) {
    if (typeof item.url != 'string' || typeof item.orgId != 'string') return false
    if (!/^[\w-]{1,100}$/.test(item.orgId)) return false
    if (typeof item.account != 'string' || !item.account || item.account.length > 100) return false
    return typeof item.password == 'string' && !!item.password && item.password.length <= 200
}

// Нужен именно origin: без учётных данных, пути, запроса и якоря.
function plainOrigin(url: URL) {
    if (!['http:', 'https:'].includes(url.protocol)) return false
    if (url.username || url.password) return false
    return url.pathname == '/' && !url.search && !url.hash
}

export function contentTargets(value: string | undefined) {
    if (!value) return null
    if (value.length > 16000) throw new Error('Слишком большая конфигурация контент-студии')
    const raw: unknown = JSON.parse(value)
    const mapped = raw && typeof raw == 'object' && !Array.isArray(raw)
    if (!mapped || Object.keys(raw).length > 8) {
        throw new Error('Ожидается карта организаций контент-студии')
    }
    const targets: Record<string, Target> = Object.create(null)
    for (const [orgId, entry] of Object.entries(raw)) {
        if (!/^[\w-]{1,100}$/.test(orgId) || !entry || typeof entry != 'object') throw new Error('Некорректная организация контент-студии')
        const item = entry as Target
        if (!describedTarget(item)) throw new Error('Некорректное подключение контент-студии')
        const url = new URL(item.url)
        if (!plainOrigin(url)) throw new Error('Укажите origin контент-студии')
        targets[orgId] = {url: url.origin, orgId: item.orgId, account: item.account, password: item.password}
    }
    return targets
}

export function createContentKnowledge(deps: {targets?: Record<string, Target> | null, timeoutMs?: number} = {}) {
    let store: Store<SupportState> | null = null, closed = false
    const sessions = new Map<string, Promise<ServiceClient<PublishedDefinition>>>(), live = new Set<ServiceClient<PublishedDefinition>>()
    function guard(ctx: ServiceResourceContext, orgId: string) {
        ctx.signal.throwIfAborted()
        if (!store || closed) throw new Error('База знаний закрыта')
        authorizeOrganization(store.state, ctx.principal.account, orgId)
    }
    function configured(orgId: string) {return !!deps.targets && Object.hasOwn(deps.targets, orgId)}
    async function bounded<T>(work: Promise<T>, signal?: AbortSignal) {
        let timer: ReturnType<typeof setTimeout> | undefined, off = () => {}
        try {return await Promise.race([work, new Promise<never>(function deadline(_resolve, reject) {
            function interrupted() {reject(new Error('Подключение закрыто'))}
            signal?.addEventListener('abort', interrupted, {once: true})
            off = () => signal?.removeEventListener('abort', interrupted)
            timer = setTimeout(() => reject(new Error('Контент-студия не ответила вовремя')), deps.timeoutMs ?? 6000)
        })])} finally {
            clearTimeout(timer)
            off()
        }
    }
    async function connect(orgId: string) {
        if (closed || !configured(orgId)) throw new Error('Контент-студия не подключена')
        if (!sessions.has(orgId)) {
            const target = deps.targets![orgId]
            const pending = (async function open() {
                const response = await fetch(target.url + '/api/client', {signal: AbortSignal.timeout(deps.timeoutMs ?? 6000), redirect: 'error'})
                if (!response.ok) throw new Error('Описание контент-студии недоступно')
                const descriptor = await response.json() as ServiceClientDefinition<PublishedDefinition>
                if (descriptor.name != 'content' || !descriptor.resources?.published) throw new Error('Нужен сервис content с публичным ресурсом')
                if (closed) throw new Error('Подключение закрыто')
                const client = createServiceClient<PublishedDefinition>({
                    definition: {
                        ...descriptor,
                        commands: {},
                        views: {},
                        resources: {published: descriptor.resources.published}
                    },
                    url: target.url,
                    auth: {credentials: {account: target.account, password: target.password}},
                    log() {}
                })
                live.add(client)
                try {
                    await bounded(client.ready())
                    if (closed) throw new Error('Подключение закрыто')
                    return client
                }
                catch (error) {
                    client.close()
                    live.delete(client)
                    throw error
                }
            })()
            sessions.set(orgId, pending)
            void pending.catch(() => sessions.delete(orgId))
        }
        return sessions.get(orgId)!
    }
    async function read<T>(ctx: ServiceResourceContext, orgId: string, operation: (remote: PublishedRemote, contentOrg: string) => Promise<T>) {
        guard(ctx, orgId)
        let opening = true
        const client = await bounded(connect(orgId), ctx.signal)
        guard(ctx, orgId)
        const resource = client.resources.open('published')
        try {
            async function ready() {
                while (!resource.current()) {
                    const finished = ['denied', 'failed', 'closed'].includes(resource.status.state.phase)
                    if (!opening || finished) throw new Error('Публичное подключение недоступно')
                    // Доступ мог измениться, пока подключение поднимается.
                    guard(ctx, orgId)
                    await new Promise(resolve => setTimeout(resolve, 20))
                }
            }
            await bounded(ready(), ctx.signal)
            const identity = await bounded(client.identity.me(), ctx.signal)
            const extra = identity.roles.some(role => !['account', 'reader'].includes(role))
            if (!identity.roles.includes('reader') || extra) {
                throw new Error('Для базы знаний нужен отдельный reader без редакторских прав')
            }
            guard(ctx, orgId)
            const result = await bounded(operation(resource.current()!.remote, deps.targets![orgId].orgId), ctx.signal)
            guard(ctx, orgId)
            return result
        } catch {throw new Error('Опубликованный материал недоступен. Проверьте подключение и обновите список')}
        finally {
            opening = false
            await resource.close()
        }
    }
    const resource = {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        return {facade: {control: {
            async list(orgId: string) {
                guard(ctx, orgId)
                if (!configured(orgId)) return {configured: false, articles: [] as PublishedIndex[]}
                return {configured: true, articles: await read(ctx, orgId, (remote, contentOrg) => remote.control.list(contentOrg))}
            },
            async read(input: {orgId: string, slug: string}) {
                const named = typeof input.slug == 'string' && input.slug.length <= 80
                if (!named || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
                    throw new Error('Некорректный адрес материала')
                }
                return read(ctx, input.orgId, (remote, contentOrg) => remote.control.read({orgId: contentOrg, slug: input.slug}))
            }
        }}, close() {}}
    }}
    return {
        resource,
        mount(state: Store<SupportState>) {
            store = state
            closed = false
            return function close() {
                closed = true
                store = null
                for (const client of live) client.close()
                live.clear()
                sessions.clear()
            }
        }
    }
}
