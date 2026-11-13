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
    const queued = Object.keys(state.deliveries ?? {}).length
    if (queued + planned.length > 1000) throw new Error('Очередь доставки достигла 1000 записей')
    return planned
}

type EnqueueInput = {
    orgId: string,
    eventId: string,
    type: WebhookDelivery['type'],
    data: Record<string, string | number>
}

function enqueue(state: MeteringState, input: EnqueueInput, at: number) {
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
            if (result.fresh) {
                const data = {
                    eventId: result.eventId,
                    metric: input.metric,
                    units: result.units,
                    period: result.period
                }
                const notice = {orgId: result.orgId, eventId: result.id, type: 'usage.committed' as const, data}
                enqueue(ctx.state, notice, ctx.state.events[result.id].updatedAt)
            }
            return result
        }},
        usageSettle: {...commands.usageSettle, apply(ctx: Ctx, input: Parameters<typeof commands.usageSettle.apply>[1]) {
            before(ctx, input.eventId)
            const result = commands.usageSettle.apply(ctx, input)
            if (result.fresh) {
                const data = {
                    eventId: result.eventId,
                    metric: ctx.state.events[result.id].metric,
                    units: result.units,
                    period: result.period
                }
                const notice = {orgId: result.orgId, eventId: result.id, type: 'usage.committed' as const, data}
                enqueue(ctx.state, notice, ctx.state.events[result.id].updatedAt)
            }
            return result
        }}
    }
}

export function billingWorkspace(state: MeteringState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const own = Object.values(state.organizations).filter(org => Object.hasOwn(org.members, account))
    const organizations = new Set(own.map(org => org.id))
    const mine = (value: {orgId: string}) => organizations.has(value.orgId)

    const subscriptions = Object.values(state.subscriptions ?? {}).filter(mine)
    const webhooks = Object.values(state.webhooks ?? {}).filter(mine)
    const deliveries = Object.values(state.deliveries ?? {}).filter(mine)

    return {
        subscriptions: subscriptions.map(value => ({...value})),
        // Секрет подписи и тело доставки в представление не попадают.
        webhooks: webhooks.map(({secret, ...value}) => ({...value})),
        deliveries: deliveries.map(function withoutPayload({payload, ...value}) {
            return {...value, attempts: value.attempts.map(attempt => ({...attempt}))}
        })
    }
}

// Источник обязан прислать монотонные версии: применяемая не раньше подтверждённой.
function confirmedVersion(input: {id: string, version: number, notifiedVersion: number}) {
    if (!/^[a-f0-9]{64}$/.test(input.id)) return false
    if (!Number.isSafeInteger(input.version) || input.version < 1) return false
    if (!Number.isSafeInteger(input.notifiedVersion) || input.notifiedVersion < 1) return false
    return input.version >= input.notifiedVersion
}

export function createBillingDomain(deps: {now?: () => number, retryMs?: number} = {}) {
    const now = deps.now ?? Date.now
    return {commands: {
        providerApply: schemaCommand({
            id: 'string', orgId: 'string', notifiedVersion: 'number', version: 'number',
            plan: {enum: ['starter', 'team']}, status: {enum: ['active', 'cancelled']}
        }, {
            allow: ['system'], apply(ctx: Ctx, input) {
                internal(ctx)
                const known = Object.hasOwn(ctx.state.organizations, input.orgId)
                const org = known ? ctx.state.organizations[input.orgId] : undefined
                if (!org || !confirmedVersion(input)) {
                    throw new Error('Источник ещё не подтвердил версию события')
                }
                const events = ctx.state.providerEvents ?? {}
                const old = events[input.id]
                if (old) {
                    const same = old.orgId == input.orgId && old.notifiedVersion == input.notifiedVersion
                    if (!same) throw new Error('Идентификатор provider event уже использован')
                    return {version: old.appliedVersion, duplicate: true}
                }
                if (Object.keys(events).length >= 1000) throw new Error('До 1000 событий тестового провайдера')
                const current = ctx.state.subscriptions?.[input.orgId]
                const sameVersion = current && input.version == current.version
                const changed = current && (current.plan != input.plan || current.status != input.status)
                if (sameVersion && changed) throw new Error('Источник изменил содержимое уже известной версии')
                const at = now()
                const version = Math.max(current?.version ?? 0, input.version)
                if (!current || input.version > current.version) {
                    const eventId = 'subscription:' + input.orgId + ':' + version
                    capacity(ctx.state, {orgId: input.orgId, eventId, type: 'subscription.updated'})
                    ctx.state.subscriptions ??= {}
                    ctx.state.subscriptions[input.orgId] = {
                        orgId: input.orgId,
                        version: input.version,
                        plan: input.plan,
                        status: input.status,
                        updatedAt: at
                    }
                    org.monthlyUnits = TEST_PLANS[input.plan].monthlyUnits
                    org.concurrent = TEST_PLANS[input.plan].concurrent
                    const data = {version, plan: input.plan, status: input.status}
                    enqueue(ctx.state, {orgId: input.orgId, eventId, type: 'subscription.updated', data}, at)
                }
                ctx.state.providerEvents ??= {}
                ctx.state.providerEvents[input.id] = {
                    id: input.id,
                    orgId: input.orgId,
                    notifiedVersion: input.notifiedVersion,
                    appliedVersion: version,
                    at
                }
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
                const enabled = delivery && ctx.state.webhooks?.[delivery.endpointId]?.enabled
                const ready = delivery && delivery.status == 'pending' && delivery.nextAt <= now()
                if (!ready || !enabled) throw new Error('Доставка ещё не готова')
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
