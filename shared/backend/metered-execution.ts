// Канон: shared/backend/metered-execution.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {randomUUID} from 'node:crypto'
import {createServiceClient, type ServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {MeteringUsageDefinition} from './metering-contract'

type Target = {url: string, account: string, secret: string}
export type UsageInput = {orgId: string, eventId: string, metric: 'search' | 'document', reference: string, units: number, signal: AbortSignal}
export type UsageGate = {run<T>(input: UsageInput, operation: () => Promise<T>): Promise<T>}
export class UsageError extends Error {}

// Server configuration only. A browser cannot select a billing tenant or supply these credentials.
export function meteringTargets(value: string | undefined) {
    if (!value) return null
    if (value.length > 16000) throw new Error('Слишком большая конфигурация учёта')
    const raw: unknown = JSON.parse(value)
    if (!raw || typeof raw != 'object' || Array.isArray(raw) || Object.keys(raw).length > 8) throw new Error('Ожидается карта организаций учёта')
    const targets: Record<string, Target> = Object.create(null)
    for (const [orgId, entry] of Object.entries(raw)) {
        if (!/^[\w-]{1,100}$/.test(orgId) || !entry || typeof entry != 'object') throw new Error('Некорректная организация учёта')
        const item = entry as Target
        if (typeof item.url != 'string' || typeof item.account != 'string' || !item.account.startsWith('key:') || typeof item.secret != 'string' || item.secret.length != 43) throw new Error('Некорректное подключение учёта')
        const url = new URL(item.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname != '/' || url.search || url.hash) throw new Error('Укажите origin сервиса учёта')
        targets[orgId] = {url: url.origin, account: item.account, secret: item.secret}
    }
    return targets
}

export function createMeteredExecution(deps: {targets: Record<string, Target>, timeoutMs?: number}) {
    const sessions = new Map<string, Promise<ServiceClient<MeteringUsageDefinition>>>()
    const live = new Set<ServiceClient<MeteringUsageDefinition>>()
    let closed = false
    async function bounded<T>(work: Promise<T>) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {return await Promise.race([work, new Promise<never>(function deadline(_resolve, reject) {
            timer = setTimeout(() => reject(new Error('Сервис учёта не подтвердил операцию вовремя; проверьте резерв')), deps.timeoutMs ?? 8000)
        })])} catch (error) {
            const message = error instanceof Error ? error.message : ''
            throw new UsageError(/квот|параллельных|зарегистрирована|не подтвердил/i.test(message) ? message : 'Сервис учёта недоступен или ключ не разрешает операцию', {cause: error})
        } finally {clearTimeout(timer)}
    }
    async function connect(orgId: string) {
        if (closed) throw new UsageError('Учёт отключён')
        if (!Object.hasOwn(deps.targets, orgId)) throw new UsageError('Учёт для этой организации не настроен')
        if (!sessions.has(orgId)) {
            const target = deps.targets[orgId]
            const pending = (async function open() {
                const response = await fetch(target.url + '/api/client', {signal: AbortSignal.timeout(deps.timeoutMs ?? 8000), redirect: 'error'})
                if (!response.ok) throw new Error('Описание сервиса учёта недоступно')
                const descriptor = await response.json() as ServiceClientDefinition<MeteringUsageDefinition>
                if (descriptor.name != 'metering') throw new Error('Адрес не относится к сервису учёта')
                if (closed) throw new Error('Учёт отключён')
                const session = createServiceClient<MeteringUsageDefinition>({definition: {...descriptor, views: {}, resources: {usage: descriptor.resources!.usage}},
                    url: target.url, auth: {credentials: {account: target.account, password: target.secret}}, log() {}})
                live.add(session)
                try {
                    await bounded(session.ready())
                    if (closed) throw new Error('Учёт отключён')
                    return session
                } catch (error) {session.close(); live.delete(session); throw error}
            })()
            sessions.set(orgId, pending)
            void pending.catch(() => sessions.delete(orgId))
        }
        return sessions.get(orgId)!
    }
    async function run<T>(input: UsageInput, operation: () => Promise<T>) {
        input.signal.throwIfAborted()
        const session = await connect(input.orgId).catch(function unavailable(error) {if (error instanceof UsageError) throw error; throw new UsageError('Сервис учёта недоступен', {cause: error})})
        const resource = session.resources.open('usage')
        let opening = true
        try {
            await bounded((async function ready() {
                while (!resource.current()) {
                    if (!opening) throw new Error('Подключение учёта завершено')
                    if (['denied', 'failed', 'closed'].includes(resource.status.state.phase)) throw new UsageError('API-ключ не разрешает учёт')
                    input.signal.throwIfAborted()
                    if (closed) throw new Error('Учёт отключён')
                    await new Promise(resolve => setTimeout(resolve, 20))
                }
            })())
            const identity = await bounded(resource.current()!.remote.control.identity())
            if (identity.orgId != input.orgId || !identity.scopes.includes('usage:write')) throw new UsageError('API-ключ не соответствует организации или не разрешает учёт')
        } finally {opening = false; await resource.close()}
        input.signal.throwIfAborted()
        // A new command receipt lets the semantic event ledger distinguish a second execution attempt.
        const reserved = await bounded(session.commands.usageReserve('reserve-' + randomUUID(), {eventId: input.eventId,
            metric: input.metric, reference: input.reference, units: input.units}))
        if (!reserved.fresh || reserved.status != 'reserved' || reserved.orgId != input.orgId) throw new UsageError('Операция уже зарегистрирована; повторное выполнение требует проверки её результата')
        if (input.signal.aborted) {
            await bounded(session.commands.usageRelease('release-' + input.eventId, {eventId: input.eventId, reason: 'Отменено до начала обработки'}))
            input.signal.throwIfAborted()
        }
        try {
            const result = await operation()
            input.signal.throwIfAborted()
            await bounded(session.commands.usageSettle('settle-' + input.eventId, {eventId: input.eventId, units: input.units}))
            return result
        } catch (error) {
            // A failed IO response is not proof that external work cost nothing.
            await bounded(session.commands.usageUncertain('unknown-' + input.eventId, {eventId: input.eventId, reason: 'Исполнение или подтверждение прервано; требуется сверка'})).catch(() => {})
            throw error
        }
    }
    return {run, close() {closed = true; for (const session of live) session.close(); live.clear(); sessions.clear()}}
}
