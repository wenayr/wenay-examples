// Канон: shared/backend/metered-execution.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {randomUUID} from 'node:crypto'
import {createServiceClient, type ServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {MeteringUsageDefinition, UsageReceipt} from './metering-contract'

type Target = {url: string, account: string, secret: string}
export type UsageInput = {orgId: string, eventId: string, metric: 'search' | 'document', reference: string, units: number, signal: AbortSignal}
export type UsageGate = {run<T>(input: UsageInput, operation: () => Promise<T>): Promise<T>}
export class UsageError extends Error {}

// Только серверная настройка: браузер не выбирает организацию учёта и не передаёт эти доступы.
export function meteringTargets(value: string | undefined) {
    if (!value) return null
    if (value.length > 16000) throw new Error('Слишком большая конфигурация учёта')
    const raw: unknown = JSON.parse(value)
    const isMap = !!raw && typeof raw == 'object' && !Array.isArray(raw)
    if (!isMap || Object.keys(raw).length > 8) throw new Error('Ожидается карта организаций учёта')
    const targets: Record<string, Target> = Object.create(null)
    for (const [orgId, entry] of Object.entries(raw)) {
        if (!/^[\w-]{1,100}$/.test(orgId) || !entry || typeof entry != 'object') throw new Error('Некорректная организация учёта')
        const item = entry as Target
        const named = typeof item.account == 'string' && item.account.startsWith('key:')
        const sealed = typeof item.secret == 'string' && item.secret.length == 43
        if (typeof item.url != 'string' || !named || !sealed) throw new Error('Некорректное подключение учёта')
        const url = new URL(item.url)
        const plain = !url.username && !url.password && !url.search && !url.hash
        const bare = url.pathname == '/' && ['http:', 'https:'].includes(url.protocol)
        if (!plain || !bare) throw new Error('Укажите origin сервиса учёта')
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
        function deadline(_resolve: unknown, reject: (reason: Error) => void) {
            const late = new Error('Сервис учёта не подтвердил операцию вовремя; проверьте резерв')
            timer = setTimeout(() => reject(late), deps.timeoutMs ?? 8000)
        }
        try {
            return await Promise.race([work, new Promise<never>(deadline)])
        } catch (error) {
            const message = error instanceof Error ? error.message : ''
            // Предметный отказ учёта показываем как есть; остальное — общая недоступность.
            const explained = /квот|параллельных|зарегистрирована|не подтвердил/i.test(message)
            const reason = explained ? message : 'Сервис учёта недоступен или ключ не разрешает операцию'
            throw new UsageError(reason, {cause: error})
        } finally {
            clearTimeout(timer)
        }
    }
    async function connect(orgId: string) {
        if (closed) throw new UsageError('Учёт отключён')
        if (!Object.hasOwn(deps.targets, orgId)) throw new UsageError('Учёт для этой организации не настроен')
        if (!sessions.has(orgId)) {
            const target = deps.targets[orgId]
            const pending = (async function open() {
                const signal = AbortSignal.timeout(deps.timeoutMs ?? 8000)
                const response = await fetch(target.url + '/api/client', {signal, redirect: 'error'})
                if (!response.ok) throw new Error('Описание сервиса учёта недоступно')
                const descriptor = await response.json() as ServiceClientDefinition<MeteringUsageDefinition>
                if (descriptor.name != 'metering') throw new Error('Адрес не относится к сервису учёта')
                if (closed) throw new Error('Учёт отключён')
                const definition = {...descriptor, views: {}, resources: {usage: descriptor.resources!.usage}}
                const auth = {credentials: {account: target.account, password: target.secret}}
                const session = createServiceClient<MeteringUsageDefinition>({definition, url: target.url, auth, log() {}})
                live.add(session)
                try {
                    await bounded(session.ready())
                    if (closed) throw new Error('Учёт отключён')
                    return session
                } catch (error) {
                    session.close()
                    live.delete(session)
                    throw error
                }
            })()
            sessions.set(orgId, pending)
            void pending.catch(() => sessions.delete(orgId))
        }
        return sessions.get(orgId)!
    }
    async function settled<T>(input: UsageInput, operation: () => Promise<T>) {
        input = Object.freeze({...input})
        input.signal.throwIfAborted()
        function unavailable(error: unknown): never {
            if (error instanceof UsageError) throw error
            throw new UsageError('Сервис учёта недоступен', {cause: error})
        }
        const session = await connect(input.orgId).catch(unavailable)
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
            const allowed = identity.orgId == input.orgId && identity.scopes.includes('usage:write')
            if (!allowed) throw new UsageError('API-ключ не соответствует организации или не разрешает учёт')
        } finally {
            opening = false
            await resource.close()
        }
        input.signal.throwIfAborted()
        // Новый receipt команды позволяет журналу событий отличить вторую попытку исполнения.
        const request = Object.freeze({eventId: input.eventId, metric: input.metric, reference: input.reference, units: input.units})
        const reserved = await bounded(session.commands.usageReserve('reserve-' + randomUUID(), request))
        const target = reserved.orgId == input.orgId && reserved.eventId == input.eventId && !!reserved.id
        if (!target) throw new UsageError('Ответ резерва не принадлежит запрошенной операции')
        const accepted = reserved.fresh && reserved.status == 'reserved' && reserved.orgId == input.orgId
        if (!accepted) throw new UsageError('Операция уже зарегистрирована; повторное выполнение требует проверки её результата')
        if (input.signal.aborted) {
            const cancelled = {eventId: input.eventId, reason: 'Отменено до начала обработки'}
            await bounded(session.commands.usageRelease('release-' + input.eventId, cancelled))
            input.signal.throwIfAborted()
        }
        let value: T
        let receipt: UsageReceipt
        try {
            value = await operation()
            input.signal.throwIfAborted()
            receipt = await bounded(session.commands.usageSettle('settle-' + input.eventId, {eventId: input.eventId, units: input.units}))
        } catch (error) {
            // Неудачный ответ IO не доказывает, что внешняя работа ничего не стоила.
            const unclear = {eventId: input.eventId, reason: 'Исполнение или подтверждение прервано; требуется сверка'}
            await bounded(session.commands.usageUncertain('unknown-' + input.eventId, unclear)).catch(() => {})
            throw error
        }
        // A confirmed reply is no longer uncertain IO; later checks must never mark its commit unknown.
        const matched = receipt.id == reserved.id && receipt.orgId == input.orgId && receipt.eventId == input.eventId
        const committed = receipt.status == 'committed' && receipt.units == input.units && receipt.period == reserved.period
        if (!matched || !committed) throw new UsageError('Ответ завершения не подтверждает запрошенный расход')
        input.signal.throwIfAborted()
        return {value, receipt}
    }
    async function run<T>(input: UsageInput, operation: () => Promise<T>) {
        return (await settled(input, operation)).value
    }
    function close() {
        closed = true
        for (const session of live) session.close()
        live.clear()
        sessions.clear()
    }
    return {run, settled, close}
}
