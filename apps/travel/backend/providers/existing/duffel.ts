import type {ProviderAdapter, ProviderOffer} from '../../../src/provider-contract.ts'
import {duffelRequest, readDuffelOffers} from '../../flights/duffel.ts'
import {flightQuery, unsupported} from './common.ts'

export const duffelAdapter = {
    async search(query, deps) {
        const flight = flightQuery(query)
        if (!flight) return unsupported('duffel', 'Укажите два аэропорта IATA и дату вылета.')
        const token = deps.env.DUFFEL_ACCESS_TOKEN ?? ''
        if (!token || token.startsWith('duffel_test_')) return {providerId: 'duffel', status: 'requires-access', offers: [], checkedAt: null,
            description: 'Нужен серверный Duffel токен Live Mode. Тестовые тарифы не публикуются как действующие.'}
        const response = await deps.fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=8000', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
            headers: {Authorization: 'Bearer ' + token, 'Duffel-Version': 'v2', Accept: 'application/json', 'Content-Type': 'application/json'},
            body: JSON.stringify(duffelRequest(flight))
        })
        if (!response.ok) throw new Error('Duffel не подтвердил поиск.')
        const checkedAt = deps.now().toISOString()
        const fares = readDuffelOffers(await response.json(), flight, deps.now())
        const offers = fares.map(fare => ({
            id: fare.id, providerId: 'duffel', kind: 'flights', title: fare.carrier,
            price: {amount: fare.total / 100, currency: fare.currency, basis: 'party', type: 'retail'}, accuracy: 'live-offer',
            sourceUrl: fare.sourceUrl!, checkedAt, expiresAt: fare.expiresAt, departure: flight.departure, returnDate: flight.returnDate, adults: flight.adults,
            flight: {origin: flight.origin, destination: flight.destination, carrier: fare.carrier,
                stops: fare.slices.reduce((total, slice) => total + slice.stops, 0), durationMinutes: null},
            includes: {checkedBags: fare.checkedBags, taxes: fare.taxesIncluded ?? null}, conditions: fare.conditions ?? null,
            comparisonKey: fare.comparisonKey ?? null
        } satisfies ProviderOffer))
        return {providerId: 'duffel', status: 'live', offers, checkedAt, description: 'Действующие тарифы на всю группу из ответа авиакомпаний Duffel.'}
    }
} satisfies ProviderAdapter
