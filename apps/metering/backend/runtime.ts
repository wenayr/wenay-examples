import {createHash, randomBytes} from 'node:crypto'
import {Command, createAsyncQueue} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {createMeteringService, meteringDefinition} from './service'
import {organizationAccess, keyAccess} from './domain'
import type {MeteringState, tScope} from './model'
import type {UsageIdentity} from './client-contract'
import {createBillingResource, type ProviderPort} from './webhook-resource'

export function createMeteringRuntime(deps: {now?: () => number, retryMs?: number, allowedOrigins?: readonly string[], provider?: ProviderPort} = {}) {
    const service = createMeteringService(deps)
    let store: Store<MeteringState> | null = null
    let system: ReturnType<typeof createServiceLeader<typeof meteringDefinition>>['corridor']['system'] | null = null
    const queue = createAsyncQueue(1)
    const now = deps.now ?? Date.now
    const billing = createBillingResource(deps)
    const keys = {allow: ['owner'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        async function issue(input: {requestId: string, orgId: string, label: string, scopes: tScope[], days: number}) {
            if (queue.size >= 4) throw new Error('Очередь выпуска ключей заполнена')
            return queue.add(async function createKey() {
                ctx.signal.throwIfAborted()
                if (!store || !system) throw new Error('Сервис не подключён')
                organizationAccess(store.state, ctx.principal.account, input.orgId, 'owner')
                if (typeof input.requestId != 'string' || !input.requestId.length || input.requestId.length > 120 || typeof input.label != 'string' || !Array.isArray(input.scopes)) throw new Error('Некорректный запрос выпуска ключа')
                const id = createHash('sha256').update(Command.commandReceiptKey(ctx.principal.account, input.requestId)).digest('hex')
                const old = store.state.keys[id]
                if (old) {
                    if (old.orgId != input.orgId || old.label != input.label.trim() || old.expiresAt - old.createdAt != input.days * 86400_000 || JSON.stringify([...old.scopes].sort()) != JSON.stringify([...input.scopes].sort())) throw new Error('Запрос выпуска уже использован с другими параметрами')
                    return {id, account: 'key:' + id, secret: null as string | null, expiresAt: old.expiresAt}
                }
                const secret = randomBytes(32).toString('base64url')
                const hash = createHash('sha256').update(secret).digest('hex')
                const created = await system.keyRegister('issue-' + id, {id, orgId: input.orgId, actor: ctx.principal.account, label: input.label, scopes: input.scopes, days: input.days, hash})
                ctx.signal.throwIfAborted()
                organizationAccess(store.state, ctx.principal.account, input.orgId, 'owner')
                return {id: created.id, account: 'key:' + created.id, secret: secret as string | null, expiresAt: created.expiresAt}
            })
        }
        return {facade: {control: {issue}}, close() {}}
    }}
    const usage = {allow: ['usage:read', 'usage:write'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function access(scope?: tScope) {
            ctx.signal.throwIfAborted()
            if (!store) throw new Error('Сервис закрыт')
            return keyAccess(store.state, ctx.principal.account, now(), scope)
        }
        function identity() {
            const key = access()
            return {orgId: key.orgId, keyId: key.id, scopes: [...key.scopes], expiresAt: key.expiresAt} satisfies UsageIdentity
        }
        function read(input: {period: string, limit: number, beforeId?: string}) {
            const key = access('usage:read')
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('Укажите период YYYY-MM и лимит от 1 до 100')
            const all = Object.values(store!.state.events).filter(event => event.orgId == key.orgId && event.period == input.period).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
            const index = input.beforeId ? all.findIndex(event => event.id == input.beforeId) : -1
            if (input.beforeId && index < 0) throw new Error('Курсор недоступен в этом периоде')
            const slice = all.slice(index + 1, index + 1 + input.limit)
            const totals = store!.state.periods[key.orgId + ':' + input.period] ?? {orgId: key.orgId, period: input.period, used: 0, reserved: 0, active: 0}
            return {orgId: key.orgId, totals: {...totals}, events: slice.map(({signature, ...event}) => ({...event})), next: index + 1 + slice.length < all.length ? slice.at(-1)!.id : null}
        }
        return {facade: {control: {identity, read}}, close() {}}
    }}
    return {definition: {...service.definition, resources: {keys, usage, billing: billing.resource}},
        provider: {receive: billing.receive},
        mount(deps: {store: Store<MeteringState>, system: NonNullable<typeof system>}) {
            store = deps.store
            system = deps.system
            const closeBilling = billing.mount(deps)
            return async function close() {await closeBilling(); await queue.onIdle(); store = null; system = null}
        }}
}
export type MeteringDefinition = ReturnType<typeof createMeteringRuntime>['definition']
