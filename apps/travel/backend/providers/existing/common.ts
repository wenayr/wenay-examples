import type {FlightDay, FlightQuery} from '../../../src/flight-contract.ts'
import type {ProviderOffer, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'

export function flightQuery(query: ProviderQuery): FlightQuery | null {
    const route = /^[A-Z]{3}$/.test(query.origin ?? '') && /^[A-Z]{3}$/.test(query.destination ?? '')
    if (!route || !query.departure || query.origin == query.destination) return null
    return {origin: query.origin!, destination: query.destination!, departure: query.departure,
        returnDate: query.returnDate ?? null, adults: query.adults, checkedBag: query.checkedBag ?? false}
}

export function unsupported(providerId: string, description: string): ProviderResult {
    return {providerId, status: 'unsupported-query', offers: [], checkedAt: null, description}
}

export function calendarOffers(providerId: string, providerName: string, rows: FlightDay[], query: FlightQuery, checkedAt: string) {
    return rows.map(day => ({
        id: providerId + ':' + query.origin + ':' + query.destination + ':' + day.departure,
        providerId, kind: 'flights', title: providerName + ' · ' + query.origin + ' → ' + query.destination,
        price: {amount: day.perPerson / 100, currency: 'EUR', basis: 'person'}, accuracy: 'published-from',
        sourceUrl: day.sourceUrl, bookingUrl: day.sourceUrl, checkedAt, expiresAt: null, departure: day.departure, adults: 1,
        flight: {origin: query.origin, destination: query.destination, carrier: providerName, stops: day.direct ? 0 : null, durationMinutes: null},
        includes: {checkedBags: null, taxes: null},
        conditions: 'Календарный минимум за одного взрослого в одну сторону. Наличие мест и багаж проверяются у перевозчика.',
        comparisonKey: null,
        deal: day.benchmark ? {kind: 'observed-saving', description: 'На ' + (day.benchmark.saving / 100) + ' EUR дешевле медианы ' +
            day.benchmark.count + ' других дат этого маршрута с тем же типом перелёта. Причина изменения источником не сообщается.',
            evidenceUrl: day.sourceUrl, expiresAt: null, referenceAmount: day.benchmark.median / 100} : null
    } satisfies ProviderOffer))
}
