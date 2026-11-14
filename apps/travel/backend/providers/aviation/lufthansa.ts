import {createHash} from 'node:crypto'
import type {ProviderAdapter, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, createCredentialsToken, failed, httpsUrl, json, many, record, text, unavailable, validFlightQuery} from './common.ts'

const providerId = 'lufthansa-fares'
const endpoint = 'https://api.lufthansa.com/v1/offers/faresbestprice/lowestfares'
const auth = createCredentialsToken({url: 'https://api.lufthansa.com/v1/partners/oauth/token',
    idEnv: 'LUFTHANSA_CLIENT_ID', secretEnv: 'LUFTHANSA_CLIENT_SECRET'})

export function lufthansaRequest(query: ProviderQuery) {
    return endpoint + '?' + new URLSearchParams({origin: query.origin!, destination: query.destination!,
        'travel-date': query.departure!, 'return-date': query.returnDate!, 'cabin-class': 'Economy', travelers: '(adult=1)'})
}

function scalar(value: unknown) {
    if (typeof value == 'string' || typeof value == 'number') return String(value)
    return text(record(value).$)
}

function endpointMatches(segment: Record<string, unknown>, origin: string, date: string) {
    const departure = record(segment.Departure)
    return scalar(departure.AirportCode) == origin && scalar(departure.Date).slice(0, 10) == date
}

function matchingSegments(segments: Record<string, unknown>[], query: ProviderQuery) {
    if (!segments.length || !endpointMatches(segments[0], query.origin!, query.departure!)) return null
    const outboundEnd = segments.findIndex(segment => scalar(record(segment.Arrival).AirportCode) == query.destination)
    if (outboundEnd < 0 || outboundEnd == segments.length - 1) return null
    const outbound = segments.slice(0, outboundEnd + 1)
    const inbound = segments.slice(outboundEnd + 1)
    if (!endpointMatches(inbound[0], query.destination!, query.returnDate!)) return null
    if (scalar(record(inbound.at(-1)!.Arrival).AirportCode) != query.origin) return null
    for (const route of [outbound, inbound]) {
        const connected = route.slice(1).every((segment, index) =>
            scalar(record(route[index].Arrival).AirportCode) == scalar(record(segment.Departure).AirportCode))
        if (!connected) return null
    }
    return outbound
}

export function readLufthansa(payload: unknown, query: ProviderQuery, checkedAt: string): ProviderOffer[] {
    if (query.adults != 1 || query.checkedBag || !query.returnDate) return []
    const root = record(record(payload).LowestFaresResponse)
    const shopping = record(root.AirShoppingRS)
    if (!shopping.OffersGroup) throw new Error('Источник не прислал тарифы')
    const data = record(shopping.DataLists)
    const travelers = many(record(data.AnonymousTravelerList).AnonymousTraveler)
    const singleAdult = travelers.length == 1 && scalar(record(travelers[0].PTC).$ ?? travelers[0].PTC) == 'ADT' &&
        Number(record(travelers[0].PTC)['@Quantity']) == 1
    if (!singleAdult) return []
    const segments = many(record(data.FlightSegmentList).FlightSegment)
    const byId = new Map(segments.map(segment => [text(segment['@SegmentKey']), segment]))
    const rows: ProviderOffer[] = []
    for (const airline of many(record(shopping.OffersGroup).AirlineOffers)) {
        for (const offer of many(airline.AirlineOffer)) {
            const total = record(record(offer.TotalPrice).DetailCurrencyPrice)
            const price = amount(scalar(total.Total))
            const currency = text(record(total.Total)['@Code'])
            if (!price || currency != (query.currency ?? 'EUR')) continue
            const priced = record(offer.PricedOffer)
            const associations = record(priced.Associations)
            const references = many(record(associations.ApplicableFlight).FlightSegmentReference)
            const applicable = references.map(reference => byId.get(text(reference['@ref']))).filter(v => v !== undefined)
            if (applicable.length != references.length) continue
            const outbound = matchingSegments(applicable, query)
            if (!outbound) continue
            const others = many(associations.OtherAssociation).flatMap(value => many(value.OtherAssociation))
            const deepLink = others.find(value => scalar(value.Type).toLowerCase() == 'deep link')
            const bookingUrl = httpsUrl(deepLink?.ReferenceValue)
            const carrier = scalar(airline.Owner) || text(record(offer.OfferID)['@Owner']) || 'Lufthansa Group'
            const rawId = scalar(offer.OfferID) || createHash('sha256').update(JSON.stringify([references, price])).digest('hex').slice(0, 20)
            rows.push({id: providerId + '-' + rawId, providerId, kind: 'flights', title: carrier,
                price: {amount: price, currency, basis: 'person'}, accuracy: 'published-from',
                sourceUrl: bookingUrl ?? 'https://www.lufthansa.com', bookingUrl, checkedAt, expiresAt: null,
                departure: query.departure, returnDate: query.returnDate, adults: 1,
                flight: {origin: query.origin!, destination: query.destination!, carrier, stops: outbound.length - 1, durationMinutes: null},
                includes: {checkedBags: null, taxes: total.Taxes ? true : null}, comparisonKey: null,
                conditions: 'Опубликованный Lowest Fares за одного взрослого туда и обратно. Валюта зависит от страны вылета. Подтвердите наличие и багаж на сайте перевозчика.'})
        }
    }
    return rows.sort((a, b) => a.price.amount - b.price.amount)
}

const adapter = {
    async search(query, deps) {
        if (!validFlightQuery(query)) return unavailable(providerId, 'Укажите конкретные аэропорты, даты и число взрослых.')
        if (query.adults != 1 || query.checkedBag || !query.returnDate) {
            return unavailable(providerId, 'Lowest Fares поддерживает одного взрослого туда и обратно. Багаж проверяется у перевозчика.')
        }
        try {
            const token = await auth.token(deps)
            if (!token) return unavailable(providerId, 'Нужны действующие партнёрские ключи Lufthansa с доступом к Fares. Приём новых приложений приостановлен.', 'requires-access')
            const checkedAt = deps.now().toISOString()
            const payload = await json(deps, lufthansaRequest(query), {headers: {Authorization: 'Bearer ' + token}})
            const offers = readLufthansa(payload, query, checkedAt)
            return {providerId, status: 'live', offers, checkedAt, sourceUrl: 'https://www.lufthansa.com',
                description: 'Ответ Lufthansa Lowest Fares за одного взрослого. Возвращаются только цены в выбранной валюте. Отсутствие цены не подтверждает отсутствие рейсов.'}
        } catch (error) { return failed(providerId, error) }
    }
} satisfies ProviderAdapter

export default adapter
