import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {Temporal} from '@js-temporal/polyfill'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {openAiCheckpoint} from './ai-checkpoint'
import {organizationAccess} from './domain'
import {availability, civilDate} from './schedule'
import {ROLES, type BookingState} from './model'

export type PreferenceFact = {
    id: string, name: string, description: string, zone: string, serviceRevision: number,
    resourceId: string, resourceRevision: number, capacity: number, today: string
}
export type Preference = {serviceId: string, date: string, partySize: number, time: string}
export type PreferenceProvider = {parse(input: {prompt: string, facts: PreferenceFact[], signal: AbortSignal}): Promise<Preference>}
type SavedSuggestion = Preference & {owner: string, orgId: string, catalogKey: string, demo: boolean}
export type SuggestionSource = {kind: 'service' | 'resource', id: string, revision: number, label: string}

export type SuggestionResult = Preference & {
    orgId: string,
    serviceName: string,
    zone: string,
    sources: SuggestionSource[],
    slots: ReturnType<typeof availability>['slots'],
    generatedAt: number,
    demo: boolean,
    requiresConfirmation: true
}

// Совпадение считаем по идентификатору и значимым словам названия услуги.
function matchScore(fact: PreferenceFact, prompt: string) {
    const words = fact.name.toLowerCase().split(/\s+/).filter(word => word.length > 3)
    return [fact.id, ...words].filter(word => prompt.includes(word)).length
}

function relativeDay(prompt: string) {
    if (prompt.includes('послезавтра')) return 2
    if (prompt.includes('завтра')) return 1
    return prompt.includes('сегодня') ? 0 : null
}

function parseTest(input: {prompt: string, facts: PreferenceFact[]}): Preference {
    const prompt = input.prompt.toLowerCase().replace(/ё/g, 'е')
    const scored = input.facts.map(fact => ({fact, score: matchScore(fact, prompt)}))
    const ranked = scored.sort((a, b) => b.score - a.score)
    // Услуга определена, только когда лучший вариант один и он действительно совпал.
    const ambiguous = ranked.length > 1 && (!ranked[0].score || ranked[0].score == ranked[1].score)
    if (!ranked.length || ambiguous) throw new Error('Уточните услугу')

    const fact = ranked[0].fact
    const dateMatch = prompt.match(/\b\d{4}-\d{2}-\d{2}\b/)
    const relative = relativeDay(prompt)
    if (!dateMatch && relative == null) throw new Error('Укажите дату или завтра')
    const date = dateMatch?.[0] ?? civilDate(fact.today).add({days: relative!}).toString()

    const party = prompt.match(/\b(\d+)\s*(?:человек|участ|мест)/)
    const time = prompt.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    return {
        serviceId: fact.id,
        date,
        partySize: party ? Number(party[1]) : 1,
        time: time ? time[1].padStart(2, '0') + ':' + time[2] : ''
    }
}

type PreferenceRequest = {orgId?: unknown, prompt?: unknown, catalogKey?: unknown} | null

type NamedRequest = {orgId: string, prompt: string, catalogKey: string}

function wellFormed(answer: Preference | null): answer is Preference {
    if (!answer || typeof answer.serviceId != 'string') return false
    return typeof answer.date == 'string' && Number.isInteger(answer.partySize)
}

// Пожелание приходит из браузера: проверяем организацию, текст и ключ каталога.
function wellFormedRequest(input: PreferenceRequest): input is NamedRequest {
    if (!input || typeof input.orgId != 'string') return false
    if (typeof input.prompt != 'string' || !input.prompt.trim()) return false
    if (input.prompt.length > 1000) return false
    return typeof input.catalogKey == 'string'
}

export function createBookingAssistant(deps: {directory?: string, provider?: PreferenceProvider, timeoutMs?: number, now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    let store: Store<BookingState> | null = null
    const pending = new Map<string, {controller: AbortController, owner: string, orgId: string, catalogKey: string}>()
    const journal = deps.directory ? openResults(deps.directory) : null
    const results: Record<string, SavedSuggestion> = journal?.initial ?? {}
    function facts(account: string, orgId: string) {
        if (!store) throw new Error('Сервис закрыт')
        organizationAccess(store.state, account, orgId)
        const offered = Object.values(store.state.services).filter(function open(service) {
            return service.orgId == orgId && service.active
        })
        return offered.sort((a, b) => a.id.localeCompare(b.id)).flatMap(function described(service) {
            const resource = store!.state.resources[service.resourceId]
            if (!resource) return []
            const moment = Temporal.Instant.fromEpochMilliseconds(now())
            const today = moment.toZonedDateTimeISO(resource.zone).toPlainDate().toString()
            return [{
                id: service.id,
                name: service.name,
                description: service.description,
                zone: resource.zone,
                serviceRevision: service.revision,
                resourceId: resource.id,
                resourceRevision: resource.revision,
                capacity: service.capacity,
                today
            }]
        })
    }
    function context(account: string, orgId: string) {
        const services = facts(account, orgId)
        const catalogKey = createHash('sha256').update(JSON.stringify(services)).digest('hex')
        return {catalogKey, services}
    }
    function validate(account: string, output: SavedSuggestion): SuggestionResult {
        const current = context(account, output.orgId)
        if (current.catalogKey != output.catalogKey) {
            throw new Error('Каталог или местная дата изменились. Разберите пожелание заново')
        }
        const fact = current.services.find(value => value.id == output.serviceId)
        if (!fact) throw new Error('Предложенная услуга недоступна')
        civilDate(output.date)
        const wrongTime = output.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(output.time)
        if (typeof output.time != 'string' || wrongTime) {
            throw new Error('Некорректное время предложения')
        }
        const service = store!.state.services[output.serviceId]
        const fresh = availability(store!.state, service, {from: output.date, days: 1, partySize: output.partySize}, now())
        const sources: SuggestionSource[] = [
            {kind: 'service', id: service.id, revision: service.revision, label: service.name},
            {
                kind: 'resource',
                id: fact.resourceId,
                revision: fact.resourceRevision,
                label: store!.state.resources[fact.resourceId].name
            }
        ]
        const matching = fresh.slots.filter(function atTime(slot) {
            return !output.time || slot.local.endsWith('T' + output.time)
        })
        return {
            orgId: output.orgId,
            serviceId: service.id,
            serviceName: service.name,
            date: output.date,
            partySize: output.partySize,
            time: output.time,
            zone: fact.zone,
            sources,
            slots: matching.slice(0, 8),
            generatedAt: fresh.generatedAt,
            demo: output.demo,
            requiresConfirmation: true
        }
    }
    function result(account: string, runId: string) {
        const output = Object.hasOwn(results, runId) ? results[runId] : undefined
        const finished = host.store.state.runs[runId]?.state == 'completed'
        if (!output || output.owner != account || !finished) {
            throw new Error('Предложение недоступно')
        }
        return validate(account, output)
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {orgId: string, prompt: string, catalogKey: string}
        const selected = context(ctx.run.owner, input.orgId)
        if (selected.catalogKey != input.catalogKey) throw new Error('Каталог изменился')
        const controller = new AbortController()
        pending.set(ctx.run.id, {
            controller,
            owner: ctx.run.owner,
            orgId: input.orgId,
            catalogKey: input.catalogKey
        })
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 10000)])
        let offAbort = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Проверяем услуги и часовые пояса'})
            const interrupted = new Promise<never>(function interrupt(_resolve, reject) {
                function abort() {reject(new Error('Разбор прерван'))}
                signal.addEventListener('abort', abort, {once: true})
                offAbort = () => signal.removeEventListener('abort', abort)
            })
            signal.throwIfAborted()
            const parsed = deps.provider
                ? deps.provider.parse({
                    prompt: input.prompt,
                    facts: selected.services.map(value => ({...value})),
                    signal
                })
                : Promise.resolve(parseTest({prompt: input.prompt, facts: selected.services}))
            const answer = await Promise.race([parsed, interrupted])
            signal.throwIfAborted()
            if (ctx.cancelled()) return
            if (!wellFormed(answer)) throw new Error('Неверный формат предложения')
            const output: SavedSuggestion = {
                ...answer,
                owner: ctx.run.owner,
                orgId: input.orgId,
                catalogKey: input.catalogKey,
                demo: !deps.provider
            }
            validate(ctx.run.owner, output)
            results[ctx.run.id] = output
            journal?.save(results)
            ctx.report({progress: 1, message: 'Предложение готово. Выберите время и подтвердите самостоятельно'})
            return {result: {available: true, demo: !deps.provider, requiresConfirmation: true}}
        } catch {
            const interruptedMessage = 'Разбор прерван: отмена, изменение доступа/каталога'
                + ' или время ожидания'
            const rejectedMessage = 'Не удалось разобрать пожелание.'
                + ' Проверьте услугу, дату, число участников и исполнителя'
            throw new Error(signal.aborted ? interruptedMessage : rejectedMessage)
        } finally {
            offAbort()
            pending.delete(ctx.run.id)
        }
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const checkpoint = openAiCheckpoint({
        directory: deps.directory ? path.join(deps.directory, 'runs') : undefined
    })
    const label = deps.provider ? 'Разбор пожелания' : 'Тестовый разбор фразы (без LLM)'
    const host = createAiRunHost({
        ...checkpoint,
        runner,
        history: 5,
        capabilities: [{kind: 'preferences', label}],
        policy: {
            canRead: (account, run) => run.owner == account,
            canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId?: unknown, prompt?: unknown, catalogKey?: unknown} | null
                    if (request.kind != 'preferences' || !wellFormedRequest(input)) return false
                    if (request.resourceIds?.length != 1) return false
                    if (request.resourceIds[0] != input.orgId) return false
                    if (context(account, input.orgId).catalogKey != input.catalogKey) return false
                    const runs = Object.values(host.store.state.runs)
                    const busyStates = ['queued', 'running', 'waiting_input', 'waiting_approval']
                    const active = runs.filter(run => busyStates.includes(run.state))
                    // Повтор того же requestId возвращает прежний запуск и лимитами не ограничен.
                    const repeat = runs.some(function same(run) {
                        return run.owner == account && run.requestId == request.requestId
                    })
                    if (repeat) return true
                    if (runs.length >= 100 || active.length >= 2) return false
                    return !active.some(run => run.owner == account)
                } catch {return false}
            }
        }
    })
    const restartError = 'Разбор прерван рестартом. Создайте новое предложение'
    for (const entry of host.recovery.pending()) {
        host.recovery.settle(entry.run.id, {state: 'failed', error: restartError})
    }
    const resource = {allow: ROLES, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {
            context(orgId: string) {
                ctx.signal.throwIfAborted()
                return context(ctx.principal.account, orgId)
            },
            result(runId: string) {
                ctx.signal.throwIfAborted()
                return result(ctx.principal.account, runId)
            }
        }}, close: connection.close}
    }}
    function mount(state: Store<BookingState>) {
        store = state
        const off = state.on(function changed() {
            for (const input of pending.values()) {
                try {if (context(input.owner, input.orgId).catalogKey != input.catalogKey) input.controller.abort()}
                catch {input.controller.abort()}
            }
        })
        return function close() {
            off()
            for (const input of pending.values()) input.controller.abort()
            host.close()
            store = null
        }
    }
    return {resource, mount}
}

function openResults(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'results.replay')
    const descriptor = openSync(file, 'a', 0o600)
    closeSync(descriptor)
    const storage = openFsReplayStorage<[Record<string, SavedSuggestion>]>(file)
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, SavedSuggestion>) {
        storage.putKeyframe({seq: Date.now(), ts: Date.now(), event: [value]})
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
