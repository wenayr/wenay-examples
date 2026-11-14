import type {ProviderAdapter, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, failed, httpsUrl, json, list, record, text, unavailable, validFlightQuery} from './common.ts'

const providerId = 'skyscanner-flights'
const endpoint = 'https://partners.api.skyscanner.net/apiservices/v3/flights/live/search/'
const scales = {PRICE_UNIT_WHOLE: 1, PRICE_UNIT_CENTI: 100, PRICE_UNIT_MILLI: 1000, PRICE_UNIT_MICRO: 1_000_000} as const

function dateObject(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    return {year, month, day}
}

function dateTime(value: unknown) {
    const date = record(value)
    const parts = [date.year, date.month, date.day, date.hour, date.minute]
    if (!parts.every(v => typeof v == 'number' && Number.isInteger(v))) return ''
    const formatted = [date.year, String(date.month).padStart(2, '0'), String(date.day).padStart(2, '0')].join('-')
    return formatted + 'T' + String(date.hour).padStart(2, '0') + ':' + String(date.minute).padStart(2, '0')
}

export function skyscannerRequest(query: ProviderQuery, market = 'DE', locale = 'en-GB') {
    const queryLegs = [{originPlaceId: {iata: query.origin!}, destinationPlaceId: {iata: query.destination!}, date: dateObject(query.departure!)}]
    if (query.returnDate) {
        queryLegs.push({originPlaceId: {iata: query.destination!}, destinationPlaceId: {iata: query.origin!}, date: dateObject(query.returnDate)})
    }
    return {query: {market, locale, currency: query.currency ?? 'EUR', queryLegs, adults: query.adults,
        cabinClass: 'CABIN_CLASS_ECONOMY', nearbyAirports: false}}
}

function sourceUrl(query: ProviderQuery) {
    const dates = [query.departure, query.returnDate].filter((v): v is string => !!v).map(v => v.slice(2).replaceAll('-', ''))
    const path = [query.origin!.toLowerCase(), query.destination!.toLowerCase(), ...dates].join('/')
    return 'https://www.skyscanner.net/transport/flights/' + path + '/?' +
        new URLSearchParams({adultsv2: String(query.adults), currency: query.currency ?? 'EUR', cabinclass: 'economy', rtn: query.returnDate ? '1' : '0'})
}

function readLegs(itinerary: Record<string, unknown>, results: Record<string, unknown>, query: ProviderQuery) {
    const ids = Array.isArray(itinerary.legIds) ? itinerary.legIds.map(text) : []
    if (ids.length != (query.returnDate ? 2 : 1)) return null
    const legs = ids.map(id => record(record(results.legs)[id]))
    const expectations = [{origin: query.origin, destination: query.destination, departure: query.departure}]
    if (query.returnDate) expectations.push({origin: query.destination, destination: query.origin, departure: query.returnDate})
    for (const [index, leg] of legs.entries()) {
        const places = record(results.places)
        const origin = text(record(places[text(leg.originPlaceId)]).iata)
        const destination = text(record(places[text(leg.destinationPlaceId)]).iata)
        const sameRoute = origin == expectations[index].origin && destination == expectations[index].destination
        if (!sameRoute || dateTime(leg.departureDateTime).slice(0, 10) != expectations[index].departure) return null
    }
    return legs
}

export function readSkyscanner(payload: unknown, query: ProviderQuery, checkedAt: string): ProviderOffer[] {
    const body = record(payload)
    if (body.status == 'RESULT_STATUS_FAILED') throw new Error('Поиск поставщика завершился ошибкой')
    const results = record(record(body.content).results)
    if (!results.itineraries) throw new Error('Источник не прислал маршруты')
    const rows: ProviderOffer[] = []
    for (const [itineraryId, raw] of Object.entries(record(results.itineraries))) {
        const itinerary = record(raw)
        const legs = readLegs(itinerary, results, query)
        if (!legs || query.checkedBag) continue
        const first = legs[0]
        const carrierIds = Array.isArray(first.marketingCarrierIds) ? first.marketingCarrierIds.map(text) : []
        const carriers = carrierIds.map(id => text(record(record(results.carriers)[id]).name)).filter(Boolean)
        for (const [index, option] of list(itinerary.pricingOptions).entries()) {
            const price = record(option.price)
            const scale = scales[text(price.unit) as keyof typeof scales]
            const value = amount(Number(price.amount) / scale)
            if (!scale || !value) continue
            const items = list(option.items)
            const sellerUrl = items.length == 1 ? httpsUrl(items[0].deepLink) : null
            const managed = option.transferType == 'TRANSFER_TYPE_MANAGED' && !!sellerUrl
            const id = providerId + '-' + itineraryId + '-' + (text(option.id) || index)
            rows.push({id, providerId, kind: 'flights', title: carriers.join(', ') || 'Перелёт Skyscanner',
                price: {amount: value, currency: query.currency ?? 'EUR', basis: 'party'}, accuracy: 'live-offer',
                sourceUrl: sourceUrl(query), bookingUrl: sellerUrl, checkedAt, expiresAt: null, adults: query.adults,
                departure: query.departure, returnDate: query.returnDate ?? null,
                flight: {origin: query.origin!, destination: query.destination!, carrier: carriers.join(', ') || null,
                    stops: typeof first.stopCount == 'number' ? first.stopCount : null,
                    durationMinutes: typeof first.durationInMinutes == 'number' ? first.durationInMinutes : null},
                includes: {checkedBags: null, taxes: null}, comparisonKey: null,
                conditions: managed ? 'Цена за всех взрослых. Багаж, обмен и возврат проверяются у продавца.' :
                    'Цена за всех взрослых. Возможны отдельные билеты и самостоятельная пересадка. Проверьте весь маршрут у продавца.'})
        }
    }
    const unique = new Map(rows.map(row => [row.id, row]))
    return [...unique.values()].sort((a, b) => a.price.amount - b.price.amount).slice(0, 50)
}

function mergeResults(previous: unknown, next: unknown) {
    const body = record(next)
    if (body.action == 'RESULT_ACTION_REPLACED') return next
    const first = record(record(record(previous).content).results)
    const second = record(record(body.content).results)
    const results: Record<string, unknown> = {...first}
    for (const [key, value] of Object.entries(second)) results[key] = {...record(first[key]), ...record(value)}
    return {...record(previous), ...body, content: {...record(body.content), results}}
}

const adapter = {
    async search(query, deps) {
        if (!validFlightQuery(query)) return unavailable(providerId, 'Укажите конкретные аэропорты, даты и число взрослых.')
        if (query.checkedBag) {
            return unavailable(providerId, 'Багаж Skyscanner требует отдельного подключения дополнительных тарифных данных. Проверьте тариф у продавца.')
        }
        const key = deps.env.SKYSCANNER_API_KEY
        if (!key) return unavailable(providerId, 'Добавьте SKYSCANNER_API_KEY, полученный по коммерческому договору.', 'requires-access')
        try {
            const headers = {'x-api-key': key, 'Content-Type': 'application/json'}
            const request = skyscannerRequest(query, deps.env.SKYSCANNER_MARKET ?? 'DE', deps.env.SKYSCANNER_LOCALE ?? 'en-GB')
            let payload = await json(deps, endpoint + 'create', {method: 'POST', headers, body: JSON.stringify(request)})
            const session = text(record(payload).sessionToken)
            if (record(payload).status == 'RESULT_STATUS_INCOMPLETE' && session) {
                const polled = await json(deps, endpoint + 'poll/' + encodeURIComponent(session), {method: 'POST', headers})
                payload = mergeResults(payload, polled)
            }
            const checkedAt = deps.now().toISOString()
            const offers = readSkyscanner(payload, query, checkedAt)
            const complete = record(payload).status == 'RESULT_STATUS_COMPLETE'
            return {providerId, status: 'live', checkedAt, offers, sourceUrl: sourceUrl(query),
                description: complete ? 'Поиск Skyscanner завершён. Суммы за всю указанную группу, экономический класс.' :
                    'Первые результаты Skyscanner. Поставщик продолжает поиск. Повторите запрос для обновления.'}
        } catch (error) { return failed(providerId, error) }
    }
} satisfies ProviderAdapter

export default adapter
