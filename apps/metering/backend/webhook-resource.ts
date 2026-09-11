import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto'
import {Command, createAsyncQueue, createReconciler} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import type {meteringDefinition} from './service'
import type {MeteringState} from './model'
import type {ProviderSnapshot} from './billing-model'
import {organizationAccess} from './domain'

export type ProviderPort = {secret: string, snapshot(orgId: string, signal: AbortSignal): Promise<ProviderSnapshot>}
type ProviderHint = {id: string, orgId: string, version: number, timestamp: number}

// Получатель и источник задаются только обычным http(s): без логина, пароля и якоря.
function plainHttpUrl(url: URL) {
    if (!['http:', 'https:'].includes(url.protocol)) return false
    return !url.username && !url.password && !url.hash
}

// Подсказка источника действительна пять минут: дальше сверяться уже поздно.
function freshHint(hint: ProviderHint, at: number) {
    if (!hint || typeof hint.id != 'string' || !/^[\w:.-]{1,120}$/.test(hint.id)) return false
    if (typeof hint.orgId != 'string') return false
    if (!Number.isSafeInteger(hint.version) || hint.version < 1) return false
    if (!Number.isSafeInteger(hint.timestamp)) return false
    return Math.abs(at - hint.timestamp) <= 300000
}

function validRegister(input: {requestId: string, url: string}) {
    if (typeof input.requestId != 'string') return false
    if (!input.requestId.length || input.requestId.length > 120) return false
    return typeof input.url == 'string'
}

function expectedSnapshot(snapshot: ProviderSnapshot, orgId: string) {
    if (!snapshot || snapshot.orgId != orgId) return false
    if (!['starter', 'team'].includes(snapshot.plan)) return false
    if (!['active', 'cancelled'].includes(snapshot.status)) return false
    return Number.isSafeInteger(snapshot.version)
}

export class ProviderUnavailable extends Error {}
type System = ReturnType<typeof createServiceLeader<typeof meteringDefinition>>['corridor']['system']

export function createBillingResource(deps: {now?: () => number, allowedOrigins?: readonly string[], provider?: ProviderPort} = {}) {
    const now = deps.now ?? Date.now
    let store: Store<MeteringState> | null = null
    let system: System | null = null
    const queue = createAsyncQueue(1)
    const incoming = createAsyncQueue(1)
    const origins = new Set((deps.allowedOrigins ?? []).map(value => new URL(value).origin))
    function endpointUrl(value: string) {
        const url = new URL(value)
        if (!plainHttpUrl(url) || !origins.has(url.origin)) {
            throw new Error('Адрес не входит в список разрешённых оператором получателей')
        }
        return url.href
    }
    const resource = {allow: ['owner'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        async function createEndpoint(input: {requestId: string, orgId: string, url: string}) {
            if (queue.size >= 4) throw new Error('Очередь регистрации заполнена')
            return queue.add(async function register() {
                ctx.signal.throwIfAborted()
                if (!store || !system) throw new Error('Сервис закрыт')
                organizationAccess(store.state, ctx.principal.account, input.orgId, 'owner')
                if (!validRegister(input)) throw new Error('Некорректный запрос регистрации')
                const url = endpointUrl(input.url)
                const receipt = Command.commandReceiptKey(ctx.principal.account, input.requestId)
                const id = createHash('sha256').update(receipt).digest('hex')
                const old = store.state.webhooks?.[id]
                if (old) {
                    if (old.orgId != input.orgId || old.url != url) {
                        throw new Error('Запрос регистрации уже использован с другими параметрами')
                    }
                    return {id, secret: null as string | null}
                }
                const secret = randomBytes(32).toString('base64url')
                await system.webhookRegister('endpoint-' + id, {
                    id,
                    orgId: input.orgId,
                    actor: ctx.principal.account,
                    url,
                    secret
                })
                ctx.signal.throwIfAborted()
                organizationAccess(store.state, ctx.principal.account, input.orgId, 'owner')
                return {id, secret: secret as string | null}
            })
        }
        function allowedOrigins() {
            ctx.signal.throwIfAborted()
            if (!store) throw new Error('Сервис закрыт')
            return [...origins]
        }
        return {facade: {control: {createEndpoint, allowedOrigins}}, close() {}}
    }}
    async function receive(body: Uint8Array, signature: string) {
        if (!store || !system || !deps.provider) throw new Error('Тестовый provider adapter не настроен')
        const signed = body instanceof Uint8Array && body.length <= 8192
        if (!signed || !/^sha256=[a-f0-9]{64}$/.test(signature)) throw new Error('Неверная подпись события')
        const expected = createHmac('sha256', deps.provider.secret).update(body).digest()
        if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new Error('Неверная подпись события')
        const text = Buffer.from(body).toString('utf8')
        const hint = JSON.parse(text) as ProviderHint
        if (!freshHint(hint, now())) throw new Error('Некорректное или просроченное событие')
        if (!Object.hasOwn(store.state.organizations, hint.orgId)) throw new Error('Организация события недоступна')
        const id = createHash('sha256').update(JSON.stringify([hint.orgId, hint.id])).digest('hex')
        if (incoming.size >= 8) throw new ProviderUnavailable('Очередь сверки заполнена')
        return incoming.add(async function reconcileHint() {
            if (!store || !system) throw new ProviderUnavailable('Сервис закрыт')
            const previous = store.state.providerEvents?.[id]
            if (previous) {
                const same = previous.orgId == hint.orgId && previous.notifiedVersion == hint.version
                if (!same) throw new Error('Идентификатор события уже использован с другими параметрами')
                return {version: previous.appliedVersion, duplicate: true}
            }
            let snapshot: ProviderSnapshot
            try {snapshot = await deps.provider!.snapshot(hint.orgId, AbortSignal.timeout(5000))}
            catch {throw new ProviderUnavailable('Источник подписки недоступен')}
            if (!expectedSnapshot(snapshot, hint.orgId)) {
                throw new ProviderUnavailable('Неожиданный ответ источника подписки')
            }
            if (snapshot.version < hint.version) {
                throw new ProviderUnavailable('Источник ещё не подтвердил версию события')
            }
            return system.providerApply('provider-' + id, {
                id,
                orgId: hint.orgId,
                notifiedVersion: hint.version,
                version: snapshot.version,
                plan: snapshot.plan,
                status: snapshot.status
            })
        })
    }
    function mount(deps: {store: Store<MeteringState>, system: System}) {
        store = deps.store
        system = deps.system
        const recovery = (async function recover() {
            for (const delivery of Object.values(store!.state.deliveries ?? {})) {
                if (delivery.status != 'sending') continue
                const request = 'recover-' + delivery.id + '-' + delivery.attempts.length
                await system!.deliveryRecover(request, {id: delivery.id})
            }
        })()
        const worker = createReconciler({
            read: () => Object.values(store!.state.deliveries ?? {}).map(function entry(delivery) {
                return {
                    id: delivery.id,
                    status: delivery.status,
                    nextAt: delivery.nextAt,
                    endpointId: delivery.endpointId
                }
            }),
            subscribe: store.listen().on,
            async run(snapshot, ctx) {
                await recovery
                for (const entry of snapshot) {
                    if (entry.status != 'pending' || !store!.state.webhooks?.[entry.endpointId]?.enabled) continue
                    if (entry.nextAt > now()) {
                        ctx.retry(entry.id, Math.max(1, entry.nextAt - now()))
                        continue
                    }
                    const before = store!.state.deliveries?.[entry.id]
                    if (!before || before.status != 'pending') continue
                    const began = await system!.deliveryBegin('begin-' + entry.id + '-' + (before.attempts.length + 1), {id: entry.id})
                    const delivery = store!.state.deliveries![entry.id]
                    const endpoint = store!.state.webhooks![delivery.endpointId]
                    let httpStatus = 0, error = '', retryable = true
                    try {
                        const url = endpointUrl(endpoint.url)
                        const payload = JSON.stringify(delivery.payload)
                        if (Buffer.byteLength(payload) > 8192) throw new Error('Webhook payload limit')
                        const signature = 'sha256=' + createHmac('sha256', endpoint.secret).update(payload).digest('hex')
                        const response = await fetch(url, {method: 'POST', redirect: 'error', signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)]),
                            headers: {'content-type': 'application/json', 'x-metering-signature': signature, 'x-metering-event': delivery.id}, body: payload})
                        httpStatus = response.status
                        retryable = httpStatus == 408 || httpStatus == 429 || httpStatus >= 500
                        if (!response.ok) error = 'Получатель ответил HTTP ' + response.status
                        await response.body?.cancel()
                    } catch {
                        error = 'Доставка не подтверждена: сеть, время ожидания или запрещённый адрес'
                    }
                    if (ctx.signal.aborted) return
                    const request = 'finish-' + entry.id + '-' + began.attempt
                    const outcome = {id: entry.id, attempt: began.attempt, httpStatus, error, retryable}
                    await system!.deliveryFinish(request, outcome)
                }
            }
        })
        worker.control.request()
        return async function close() {
            await worker.close()
            await queue.onIdle()
            await incoming.onIdle()
            store = null
            system = null
        }
    }
    return {resource, mount, receive}
}

export function createHttpTestProvider(deps: {url: string, secret: string}): ProviderPort {
    const base = new URL(deps.url)
    if (!plainHttpUrl(base)) throw new Error('Некорректный URL тестового источника')
    return {secret: deps.secret, async snapshot(orgId, signal) {
        const url = new URL(base.href)
        url.pathname = url.pathname.replace(/\/$/, '') + '/subscriptions/' + encodeURIComponent(orgId)
        const response = await fetch(url, {redirect: 'error', signal})
        if (!response.ok) {
            await response.body?.cancel()
            throw new Error('Источник подписки недоступен')
        }
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Источник не вернул данные')
        let bytes = Buffer.alloc(0)
        try {
            while (true) {
                const next = await reader.read()
                if (next.done) break
                if (bytes.length + next.value.length > 8192) throw new Error('Ответ источника превышает лимит')
                bytes = Buffer.concat([bytes, next.value])
            }
        } finally {await reader.cancel()}
        return JSON.parse(bytes.toString('utf8')) as ProviderSnapshot
    }}
}
