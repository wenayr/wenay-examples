import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {organizationAccess, keyAccess, eventKey, type createMeteringDomain} from './domain'
import {TEST_PLANS, type WebhookDelivery} from './billing-model'
import type {MeteringState} from './model'

type Ctx = ServiceCommandCtx<MeteringState>
function internal(ctx: Ctx) {if (ctx.account != 'system') throw new Error('Внутренняя операция')}

function capacity(state: MeteringState, input: {orgId: string, eventId: string, type: WebhookDelivery['type']}) {
    const planned = Object.values(state.webhooks ?? {}).filter(endpoint => endpoint.enabled && endpoint.orgId == input.orgId).flatMap(endpoint => {
        const id = createHash('sha256').update(JSON.stringify([endpoint.id, input.eventId, input.type])).digest('hex')
        return state.deliveries?.[id] ? [] : [{endpoint, id}]
    })
    if (Object.keys(state.deliveries ?? {}).length + planned.length > 1000) throw new Error('Очередь доставки достигла 1000 записей')
    return planned
}

function enqueue(state: MeteringState, input: {orgId: string, eventId: string, type: WebhookDelivery['type'], data: Record<string, string | number>}, at: number) {
    const planned = capacity(state, input)
    state.deliveries ??= {}
    for (const {endpoint, id} of planned) {
        state.deliveries[id] = {id, orgId: input.orgId, endpointId: endpoint.id, type: input.type,
            payload: {id, type: input.type, orgId: input.orgId, data: {...input.data}}, status: 'pending', nextAt: at, createdAt: at,
            batchAttempt: 0, manualRetries: 0, attempts: []}
    }
}

export function withUsageDeliveries(commands: ReturnType<typeof createMeteringDomain>['commands'], deps: {now?: () => number} = {}) {
    function before(ctx: Ctx, eventId: string) {
        const key = keyAccess(ctx.state, ctx.account, (deps.now ?? Date.now)(), 'usage:write')
        const id = eventKey(key.orgId, eventId)
        if (ctx.state.events[id]?.status != 'committed') capacity(ctx.state, {orgId: key.orgId, eventId: id, type: 'usage.committed'})
    }
    return {...commands,
        usageRecord: {...commands.usageRecord, apply(ctx: Ctx, input: Parameters<typeof commands.usageRecord.apply>[1]) {
            before(ctx, input.eventId)
            const result = commands.usageRecord.apply(ctx, input)
            if (result.fresh) enqueue(ctx.state, {orgId: result.orgId, eventId: result.id, type: 'usage.committed', data: {eventId: result.eventId, metric: input.metric, units: result.units, period: result.period}}, ctx.state.events[result.id].updatedAt)
            return result
        }},
        usageSettle: {...commands.usageSettle, apply(ctx: Ctx, input: Parameters<typeof commands.usageSettle.apply>[1]) {
            before(ctx, input.eventId)
            const result = commands.usageSettle.apply(ctx, input)
            if (result.fresh) enqueue(ctx.state, {orgId: result.orgId, eventId: result.id, type: 'usage.committed', data: {eventId: result.eventId, metric: ctx.state.events[result.id].metric, units: result.units, period: result.period}}, ctx.state.events[result.id].updatedAt)
            return result
        }}
    }
}

export function billingWorkspace(state: MeteringState, principal: tServicePrincipal | null) {
    const organizations = new Set(Object.values(state.organizations).filter(org => Object.hasOwn(org.members, principal?.account ?? '')).map(org => org.id))
    return {
        subscriptions: Object.values(state.subscriptions ?? {}).filter(value => organizations.has(value.orgId)).map(value => ({...value})),
        webhooks: Object.values(state.webhooks ?? {}).filter(value => organizations.has(value.orgId)).map(({secret, ...value}) => ({...value})),
        deliveries: Object.values(state.deliveries ?? {}).filter(value => organizations.has(value.orgId)).map(({payload, ...value}) => ({...value, attempts: value.attempts.map(attempt => ({...attempt}))}))
    }
}

export function createBillingDomain(deps: {now?: () => number, retryMs?: number} = {}) {
    const now = deps.now ?? Date.now
    return {commands: {
        providerApply: schemaCommand({id: 'string', orgId: 'string', notifiedVersion: 'number', version: 'number', plan: {enum: ['starter', 'team']}, status: {enum: ['active', 'cancelled']}}, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                const org = Object.hasOwn(ctx.state.organizations, input.orgId) ? ctx.state.organizations[input.orgId] : undefined
                if (!org || !/^[a-f0-9]{64}$/.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1 || !Number.isSafeInteger(input.notifiedVersion) || input.notifiedVersion < 1 || input.version < input.notifiedVersion) throw new Error('Источник ещё не подтвердил версию события')
                const events = ctx.state.providerEvents ?? {}
                const old = events[input.id]
                if (old) {
                    if (old.orgId != input.orgId || old.notifiedVersion != input.notifiedVersion) throw new Error('Идентификатор provider event уже использован')
                    return {version: old.appliedVersion, duplicate: true}
                }
                if (Object.keys(events).length >= 1000) throw new Error('До 1000 событий тестового провайдера')
                const current = ctx.state.subscriptions?.[input.orgId]
                if (current && input.version == current.version && (current.plan != input.plan || current.status != input.status)) throw new Error('Источник изменил содержимое уже известной версии')
                const at = now()
                const version = Math.max(current?.version ?? 0, input.version)
                if (!current || input.version > current.version) {
                    capacity(ctx.state, {orgId: input.orgId, eventId: 'subscription:' + input.orgId + ':' + version, type: 'subscription.updated'})
                    ctx.state.subscriptions ??= {}
                    ctx.state.subscriptions[input.orgId] = {orgId: input.orgId, version: input.version, plan: input.plan, status: input.status, updatedAt: at}
                    org.monthlyUnits = TEST_PLANS[input.plan].monthlyUnits
                    org.concurrent = TEST_PLANS[input.plan].concurrent
                    enqueue(ctx.state, {orgId: input.orgId, eventId: 'subscription:' + input.orgId + ':' + version, type: 'subscription.updated', data: {version, plan: input.plan, status: input.status}}, at)
                }
                ctx.state.providerEvents ??= {}
                ctx.state.providerEvents[input.id] = {id: input.id, orgId: input.orgId, notifiedVersion: input.notifiedVersion, appliedVersion: version, at}
                return {version, duplicate: false}
            }
        }),
        webhookRegister: schemaCommand({id: 'string', orgId: 'string', actor: 'string', url: 'string', secret: 'string'}, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                organizationAccess(ctx.state, input.actor, input.orgId, 'owner')
                if (!/^[a-f0-9]{64}$/.test(input.id) || !/^[\w-]{43}$/.test(input.secret) || input.url.length > 300) throw new Error('Некорректный получатель')
                ctx.state.webhooks ??= {}
                if (ctx.state.webhooks[input.id]) throw new Error('Запрос создания уже использован')
                if (Object.keys(ctx.state.webhooks).length >= 20) throw new Error('До 20 получателей на стенде')
                ctx.state.webhooks[input.id] = {id: input.id, orgId: input.orgId, url: input.url, secret: input.secret, enabled: true, createdAt: now()}
                return {id: input.id}
            }
        }),
        webhookEnable: schemaCommand({orgId: 'string', id: 'string', enabled: 'boolean'}, {
            allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
                organizationAccess(ctx.state, ctx.account, input.orgId, 'owner')
                const endpoint = ctx.state.webhooks?.[input.id]
                if (!endpoint || endpoint.orgId != input.orgId) throw new Error('Получатель недоступен')
                endpoint.enabled = input.enabled
                return {id: endpoint.id}
            }
        }),
        webhookRetry: schemaCommand({orgId: 'string', id: 'string'}, {
            allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
                organizationAccess(ctx.state, ctx.account, input.orgId, 'owner')
                const delivery = ctx.state.deliveries?.[input.id]
                if (!delivery || delivery.orgId != input.orgId || delivery.status != 'failed') throw new Error('Повтор доступен для неудачной доставки')
                if (delivery.manualRetries >= 3 || delivery.attempts.length >= 20) throw new Error('Исчерпаны 3 ручных повтора или 20 попыток')
                delivery.manualRetries++
                delivery.batchAttempt = 0
                delivery.status = 'pending'
                delivery.nextAt = now()
                return {id: delivery.id}
            }
        }),
        deliveryBegin: schemaCommand({id: 'string'}, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                const delivery = ctx.state.deliveries?.[input.id]
                if (!delivery || delivery.status != 'pending' || delivery.nextAt > now() || !ctx.state.webhooks?.[delivery.endpointId]?.enabled) throw new Error('Доставка ещё не готова')
                if (delivery.batchAttempt >= 5 || delivery.attempts.length >= 20) throw new Error('Исчерпаны попытки доставки')
                delivery.status = 'sending'
                delivery.batchAttempt++
                const attempt = delivery.attempts.length + 1
                delivery.attempts.push({number: attempt, at: now(), httpStatus: 0, error: ''})
                return {id: delivery.id, attempt}
            }
        }),
        deliveryFinish: schemaCommand({id: 'string', attempt: 'number', httpStatus: 'number', error: 'string', retryable: 'boolean'}, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                const delivery = ctx.state.deliveries?.[input.id]
                if (!delivery || delivery.status != 'sending' || delivery.attempts.length != input.attempt) throw new Error('Устаревший результат доставки')
                const attempt = delivery.attempts.at(-1)!
                attempt.httpStatus = input.httpStatus
                attempt.error = input.error.slice(0, 200)
                if (input.httpStatus >= 200 && input.httpStatus < 300) delivery.status = 'delivered'
                else if (input.retryable && delivery.batchAttempt < 5 && delivery.attempts.length < 20) {
                    delivery.status = 'pending'
                    delivery.nextAt = now() + Math.min(30000, (deps.retryMs ?? 1000) * 2 ** (delivery.batchAttempt - 1))
                } else delivery.status = 'failed'
                return {id: delivery.id, status: delivery.status}
            }
        }),
        deliveryRecover: schemaCommand({id: 'string'}, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                const delivery = ctx.state.deliveries?.[input.id]
                if (!delivery || delivery.status != 'sending') return {changed: false}
                delivery.attempts.at(-1)!.error = 'Исход неизвестен после рестарта; получатель должен распознавать event id'
                delivery.status = delivery.batchAttempt < 5 && delivery.attempts.length < 20 ? 'pending' : 'failed'
                delivery.nextAt = now()
                return {changed: true}
            }
        })
    }}
}
