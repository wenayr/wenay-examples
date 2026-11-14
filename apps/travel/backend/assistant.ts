import type {TravelChatQuery, TravelChatReply, TravelChatResult} from '../src/assistant-contract.ts'
import {packageDestinations, packageMaxTotal} from '../src/package-contract.ts'
import {interpretTravel} from './assistant-language.ts'
import {airportQuestion} from './assistant-airports.ts'
import {modelTrip} from './assistant-model.ts'
import {createAssistantTools, travelParams, type AssistantDeps} from './assistant-tools.ts'
import {dateValue, packageQuery} from './travel-query.ts'
import {readFlightQuery} from './flights/index.ts'

function record(value: unknown): value is Record<string, unknown> {return !!value && typeof value === 'object' && !Array.isArray(value)}
function whole(value: unknown, max: number, min = 0): value is number {return Number.isInteger(value) && Number(value) >= min && Number(value) <= max}
function validateContext(raw: unknown, destinations: readonly {id: string}[]): Partial<TravelChatQuery> {
    if (raw === undefined) return {}
    if (!record(raw)) throw new RangeError('Ожидались параметры поездки.')
    const query: Partial<TravelChatQuery> = {}
    if (raw.kind !== undefined) {
        if (raw.kind !== 'flights' && raw.kind !== 'catalog' && raw.kind !== 'packages') throw new RangeError('Неизвестный режим поиска.')
        query.kind = raw.kind
    }
    if (raw.destination !== undefined) {
        if (typeof raw.destination !== 'string' || !destinations.some(p => p.id === raw.destination)) throw new RangeError('Неизвестное направление.')
        query.destination = raw.destination
    }
    const limits = {nights: [1, 30], adults: [1, 9], minTotal: [0, packageMaxTotal], maxTotal: [0, packageMaxTotal], minStars: [0, 5]} as const
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
        const value = raw[key]
        if (value === undefined) continue
        if (!whole(value, limits[key][1], limits[key][0])) throw new RangeError('Проверьте длительность, число путешественников, звёзды и бюджет.')
        query[key] = value
    }
    for (const key of ['firstDeparture', 'lastDeparture'] as const) {
        if (raw[key] === undefined) continue
        if (typeof raw[key] !== 'string') throw new RangeError('Ожидалась дата вылета.')
        query[key] = dateValue(raw[key])
    }
    if (raw.phrase !== undefined) {
        if (typeof raw.phrase !== 'string' || raw.phrase.length > 120) throw new RangeError('Слишком длинное название отеля.')
        query.phrase = raw.phrase
    }
    if (raw.airportChoices !== undefined) {
        if (!record(raw.airportChoices)) throw new RangeError('Проверьте названия аэропортов.')
        query.airportChoices = {}
        for (const side of ['origin', 'destination'] as const) {
            const value = raw.airportChoices[side]
            if (value === undefined) continue
            if (typeof value !== 'string' || value.length > 100) throw new RangeError('Проверьте названия аэропортов.')
            query.airportChoices[side] = value
        }
    }
    if (raw.flight !== undefined) {
        if (!record(raw.flight)) throw new RangeError('Ожидались параметры авиабилета.')
        const f = raw.flight
        const flight: NonNullable<TravelChatQuery['flight']> = {}
        for (const key of ['origin', 'destination'] as const) {
            if (f[key] === undefined) continue
            if (typeof f[key] !== 'string' || !/^[A-Z]{3}$/.test(f[key])) throw new RangeError('Проверьте коды аэропортов IATA.')
            flight[key] = f[key]
        }
        if (f.departure !== undefined) flight.departure = dateValue(typeof f.departure === 'string' ? f.departure : null)
        if (f.returnDate === null) flight.returnDate = null
        else if (f.returnDate !== undefined) flight.returnDate = dateValue(typeof f.returnDate === 'string' ? f.returnDate : null)
        if (f.adults !== undefined && !whole(f.adults, 9, 1)) throw new RangeError('Укажите от 1 до 9 взрослых.')
        if (typeof f.adults === 'number') flight.adults = f.adults
        if (f.checkedBag !== undefined && typeof f.checkedBag !== 'boolean') throw new RangeError('Уточните багаж.')
        if (typeof f.checkedBag === 'boolean') flight.checkedBag = f.checkedBag
        query.flight = flight
    }
    return query
}

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
function summary(result: TravelChatResult, context: Partial<TravelChatQuery>, place: string) {
    if (result.kind === 'flights') return `Подготовил маршрут ${result.query.origin} → ${result.query.destination} на ${result.query.departure}. Откройте поиск, чтобы проверить рейсы и условия багажа.`
    if (result.kind === 'catalog') return `${place}. В справочнике найдено объектов: ${result.total}. У справочных карточек нет подтверждённой цены проживания. ` +
        (result.total ? 'Откройте отель на карте или посмотрите варианты у партнёров.' : 'Попробуйте изменить направление или название.')
    const window = context.firstDeparture === context.lastDeparture ? context.firstDeparture : `${context.firstDeparture} — ${context.lastDeparture}`
    const trip = `${place}, вылет из Таллина ${window}, ночей: ${context.nights}, взрослых: ${context.adults}. `
    if (result.source.status === 'unavailable') return trip + 'Поставщик сейчас не подтвердил цены. Попробуйте обновить поиск позже.'
    if (!result.items.length) return trip + 'В полученных тарифах нет отелей с такими условиями. Можно изменить даты, звёзды или бюджет.'
    return trip + `По данным ${result.source.name} найдено отелей: ${result.total}. От ${euros.format(result.items[0].best.total / 100)} за поездку целиком.`
}

export function createTravelAssistant(deps: AssistantDeps) {
    const tools = createAssistantTools(deps)
    const destinations = deps.catalog.destinations
    const envKey = process.env.OPENAI_API_KEY
    const configuredModel = envKey ? {key: envKey, name: process.env.OPENAI_MODEL || 'gpt-4.1-mini', fetch} : null
    const model = deps.model === undefined ? configuredModel : deps.model
    async function chat(input: unknown, signal?: AbortSignal): Promise<TravelChatReply> {
        if (!record(input) || typeof input.message !== 'string') throw new RangeError('Ожидалось текстовое сообщение.')
        if (!input.message.trim() || input.message.length > 1200) {
            throw new RangeError('Введите сообщение длиной от 1 до 1200 символов.')
        }
        const current = validateContext(input.context, destinations)
        const today = deps.today?.() ?? new Date().toISOString().slice(0, 10)
        let mode: TravelChatReply['mode'] = 'local'
        let interpretation = interpretTravel(input.message, current, destinations, today)
        if (model) {
            try {
                const inferred = await modelTrip(model, input.message, current, destinations, today, signal)
                const parsed = validateContext(inferred.patch, destinations)
                if (interpretation.patch.airportChoices) {
                    parsed.kind = 'flights'
                    parsed.airportChoices = interpretation.patch.airportChoices
                    parsed.flight = {...parsed.flight, ...interpretation.patch.flight}
                }
                interpretation = {...inferred, patch: parsed}
                mode = 'openai'
            } catch {signal?.throwIfAborted()}
        }
        const {patch, question} = interpretation
        try {validateContext(patch, destinations)} catch (error) {
            if (error instanceof RangeError) return {message: error.message, mode, result: null, context: current}
            throw error
        }
        const context = {...current, ...patch}
        if (patch.flight) context.flight = {...current.flight, ...patch.flight}
        if (context.flight && context.kind === 'flights') {
            if (context.airportChoices?.origin) delete context.flight.origin
            if (context.airportChoices?.destination) delete context.flight.destination
        }
        if (interpretation.clearDestination) delete context.destination
        const ask = (message: string): TravelChatReply => ({message, context, mode, result: null})
        const unresolved = context.kind === 'flights' ? airportQuestion(context.airportChoices) : undefined
        if (unresolved) return {...ask(unresolved.message), airportOptions: unresolved.airportOptions}
        if (question) return ask(question)
        if (mode === 'local' && !Object.keys(patch).length && !/поищи|покажи|найди|подбери|повтори|обнови|проверь|искать|вариант/i.test(input.message)) {
            return ask('Уточните направление, даты или бюджет. Например, «Хургада во второй половине января на 10 дней до 2 500 евро».')
        }
        if (context.kind === 'flights') {
            const flight = context.flight ?? {}
            context.flight = flight
            const side = (['origin', 'destination'] as const).find(side => !flight[side])
            if (side) {
                const prompt = side === 'origin' ? 'Откуда летим? Укажите город или аэропорт вылета.' : 'Куда летим? Укажите город или аэропорт прилёта.'
                context.airportChoices = {...context.airportChoices, [side]: ''}
                return {...ask(prompt), airportOptions: {side, query: ''}}
            }
            if (!flight.departure) return ask('Когда нужен вылет? Можно написать «завтра» или назвать дату.')
            try {
                const result = {kind: 'flights', query: readFlightQuery(travelParams(flight), today)} as const
                return {mode, context, result, message: summary(result, context, '')}
            } catch (error) {
                if (error instanceof RangeError) return ask(error.message)
                throw error
            }
        }
        const place = destinations.find(p => p.id === context.destination)
        if (!place) return ask('Куда хотите поехать? Например, Хургада, Шарм-эль-Шейх или Родос.')
        if (context.kind === 'catalog' || !packageDestinations.some(id => id === place.id)) {
            context.kind = 'catalog'
            const result = await tools.run('search_hotels', {destination: place.id, ...(context.phrase ? {phrase: context.phrase} : {})}, signal)
            return {mode, context, result, message: summary(result, context, place.name)}
        }
        Object.assign(context, {kind: 'packages', nights: context.nights ?? 7, adults: context.adults ?? 2,
            minTotal: context.minTotal ?? 0, maxTotal: context.maxTotal ?? packageMaxTotal, minStars: context.minStars ?? 0})
        if (!context.firstDeparture) return ask('На какие даты планируете вылет? Укажите один день или окно до 20 дат.')
        context.lastDeparture ??= context.firstDeparture
        if (context.adults !== 2) return ask('У этого поставщика доступны пакетные тарифы на двух взрослых. Можно искать отели или отдельные авиабилеты.')
        const {firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal, minStars} = context
        const args = {destination: place.id, firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal, minStars}
        try {
            packageQuery(travelParams(args), place.id, today)
            const result = await tools.run('search_packages', args, signal)
            return {mode, context, result, message: summary(result, context, place.name)}
        } catch (error) {
            if (error instanceof RangeError) return ask(error.message)
            throw error
        }
    }
    return {chat, mcp: tools.mcp, close: tools.close}
}
