import type {ProviderAdapter, ProviderOffer} from '../../../src/provider-contract.ts'
import {fetchGooglePage, readGoogleQuotes} from '../../flights/google.ts'
import {flightQuery, unsupported} from './common.ts'

export const googleAdapter = {
    async search(query, deps) {
        const flight = flightQuery(query)
        if (!flight) return unsupported('google-flights', 'Укажите два аэропорта IATA и дату вылета.')
        if (flight.checkedBag) return unsupported('google-flights', 'Публичные ориентиры не подтверждают зарегистрированный багаж.')
        const checkedAt = deps.now().toISOString()
        const quotes = readGoogleQuotes(await fetchGooglePage(flight), flight, checkedAt)
        const offers = quotes.map(quote => ({
            id: quote.id!, providerId: 'google-flights', kind: 'flights', title: quote.carrier ?? 'Перевозчик не указан',
            price: {amount: quote.total / 100, currency: quote.currency, basis: 'party'}, accuracy: 'published-from',
            sourceUrl: quote.sourceUrl, bookingUrl: quote.sourceUrl, checkedAt, expiresAt: null,
            departure: flight.departure, returnDate: flight.returnDate, adults: flight.adults,
            flight: {origin: flight.origin, destination: flight.destination, carrier: quote.carrier,
                stops: quote.details?.stops ?? null, durationMinutes: quote.details?.durationMinutes ?? null},
            includes: {checkedBags: null, taxes: null}, conditions: quote.description, comparisonKey: null
        } satisfies ProviderOffer))
        return {providerId: 'google-flights', status: quotes.length ? 'live' : 'unavailable', offers, checkedAt,
            description: quotes.length ? 'Опубликованные ориентиры за всех пассажиров. Полные условия и обратный рейс подтверждает продавец.' :
                'Google не подтвердил опубликованные цены на этот запрос.'}
    }
} satisfies ProviderAdapter
