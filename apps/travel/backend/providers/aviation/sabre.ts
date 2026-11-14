import type {ProviderAdapter, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, failed, json, list, record, text, unavailable, validFlightQuery} from './common.ts'

const providerId = 'sabre-flights'
const endpoint = 'https://api.platform.sabre.com/v5/offers/shop'
const docsUrl = 'https://developer.sabre.com/rest-api/bargain-finder-max/v5/index.html'

export function sabreRequest(query: ProviderQuery, pcc: string) {
    const trips = [{origin: query.origin!, destination: query.destination!, date: query.departure!}]
    if (query.returnDate) trips.push({origin: query.destination!, destination: query.origin!, date: query.returnDate})
    return {OTA_AirLowFareSearchRQ: {Version: '5',
        POS: {Source: [{PseudoCityCode: pcc, RequestorID: {Type: '1', ID: '1', CompanyName: {Code: 'TN'}}}]},
        OriginDestinationInformation: trips.map((trip, index) => ({RPH: String(index + 1), DepartureDateTime: trip.date + 'T00:00:00',
            OriginLocation: {LocationCode: trip.origin}, DestinationLocation: {LocationCode: trip.destination}})),
        TravelPreferences: {CabinPref: [{Cabin: 'Y', PreferLevel: 'Only'}]},
        TravelerInfoSummary: {AirTravelerAvail: [{PassengerTypeQuantity: [{Code: 'ADT', Quantity: query.adults}]}],
            PriceRequestInformation: {CurrencyCode: query.currency ?? 'EUR'}},
        TPA_Extensions: {IntelliSellTransaction: {RequestType: {Name: '50ITINS'}}}}}
}

function groupMatches(group: Record<string, unknown>, query: ProviderQuery) {
    const legs = list(record(group.groupDescription).legDescriptions)
    const expected = [{origin: query.origin, destination: query.destination, date: query.departure}]
    if (query.returnDate) expected.push({origin: query.destination, destination: query.origin, date: query.returnDate})
    return legs.length == expected.length && legs.every((leg, index) => leg.departureLocation == expected[index].origin &&
        leg.arrivalLocation == expected[index].destination && leg.departureDate == expected[index].date)
}

function itineraryLegs(itinerary: Record<string, unknown>, body: Record<string, unknown>, query: ProviderQuery) {
    const byLeg = new Map(list(body.legDescs).map(leg => [String(leg.id), leg]))
    const bySchedule = new Map(list(body.scheduleDescs).map(schedule => [String(schedule.id), schedule]))
    const references = list(itinerary.legs)
    const legs = references.map(reference => byLeg.get(String(reference.ref)))
    if (legs.length != (query.returnDate ? 2 : 1) || legs.some(leg => !leg)) return null
    const expectations = [{origin: query.origin, destination: query.destination}]
    if (query.returnDate) expectations.push({origin: query.destination, destination: query.origin})
    const resolved = legs.map(leg => {
        const refs = list(leg!.schedules)
        const schedules = refs.map(reference => bySchedule.get(String(reference.ref)))
        return {leg: leg!, refs, schedules}
    })
    for (const [index, result] of resolved.entries()) {
        if (!result.schedules.length || result.schedules.some(schedule => !schedule)) return null
        const first = result.schedules[0]!, last = result.schedules.at(-1)!
        const matches = record(first.departure).airport == expectations[index].origin && record(last.arrival).airport == expectations[index].destination
        if (!matches || Number(result.refs[0].departureDateAdjustment ?? 0) != 0) return null
    }
    return resolved
}

export function readSabre(payload: unknown, query: ProviderQuery, checkedAt: string): ProviderOffer[] {
    if (query.checkedBag) return []
    const body = record(record(payload).groupedItineraryResponse)
    if (!Array.isArray(body.itineraryGroups)) throw new Error('Источник не прислал маршруты')
    const rows: ProviderOffer[] = []
    for (const [groupIndex, group] of list(body.itineraryGroups).entries()) {
        if (!groupMatches(group, query)) continue
        for (const itinerary of list(group.itineraries)) {
            const legs = itineraryLegs(itinerary, body, query)
            if (!legs) continue
            const first = legs[0]
            const carriers = [...new Set(first.schedules.map(schedule => text(record(schedule!.carrier).marketing)).filter(Boolean))]
            for (const [index, pricing] of list(itinerary.pricingInformation).entries()) {
                const fare = record(pricing.fare)
                const total = record(fare.totalFare)
                const price = amount(total.totalPrice)
                if (!price || total.currency != (query.currency ?? 'EUR')) continue
                const passengers = list(fare.passengerInfoList).map(item => record(item.passengerInfo))
                if (!passengers.length || passengers.some(passenger => passenger.passengerType != 'ADT')) continue
                const count = passengers.reduce((sum, passenger) => sum + Number(passenger.passengerNumber ?? 0), 0)
                if (count != query.adults) continue
                const details = record(pricing.offer)
                const ttl = Number(details.timeToLive)
                const expiresAt = Number.isInteger(ttl) && ttl > 0 ? new Date(Date.parse(checkedAt) + ttl * 1000).toISOString() : null
                const id = text(details.offerId) || [groupIndex, itinerary.id, index].join('-')
                const stops = first.schedules.length - 1 + first.schedules.reduce((sum, schedule) => sum + Number(schedule!.stopCount ?? 0), 0)
                rows.push({id: providerId + '-' + id, providerId, kind: 'flights', title: carriers.join(', ') || 'Перелёт Sabre',
                    price: {amount: price, currency: text(total.currency), basis: 'party'}, accuracy: 'live-offer', sourceUrl: docsUrl,
                    bookingUrl: null, checkedAt, expiresAt, departure: query.departure, returnDate: query.returnDate ?? null, adults: query.adults,
                    flight: {origin: query.origin!, destination: query.destination!, carrier: carriers.join(', ') || null, stops,
                        durationMinutes: typeof first.leg.elapsedTime == 'number' ? first.leg.elapsedTime : null},
                    includes: {checkedBags: null, taxes: typeof total.totalTaxAmount == 'number' ? true : null}, comparisonKey: null,
                    conditions: 'Цена за всех взрослых. Требуется повторное подтверждение и оформление через агентский договор Sabre. Багаж, обмен и возврат уточняются при расчёте.'})
            }
        }
    }
    return rows.sort((a, b) => a.price.amount - b.price.amount).slice(0, 50)
}

const adapter = {
    async search(query, deps) {
        if (!validFlightQuery(query)) return unavailable(providerId, 'Укажите конкретные аэропорты, даты и число взрослых.')
        if (query.checkedBag) {
            return unavailable(providerId, 'Для подтверждения багажа нужна подробная тарификация Sabre. Условия уточняются при расчёте тарифа.')
        }
        const token = deps.env.SABRE_ACCESS_TOKEN, pcc = deps.env.SABRE_PCC
        if (!token || !pcc) return unavailable(providerId, 'Нужны договор Sabre, действующий серверный bearer token и PCC.', 'requires-access')
        try {
            const checkedAt = deps.now().toISOString()
            const payload = await json(deps, endpoint, {method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
                body: JSON.stringify(sabreRequest(query, pcc))})
            return {providerId, status: 'live', checkedAt, offers: readSabre(payload, query, checkedAt), sourceUrl: docsUrl,
                description: 'Bargain Finder Max вернул текущие тарифы на точные аэропорты и даты за всех взрослых. Оформление требует агентского доступа.'}
        } catch (error) { return failed(providerId, error) }
    }
} satisfies ProviderAdapter

export default adapter
