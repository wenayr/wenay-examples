import {createHash} from 'node:crypto'
import type {ProviderAdapter, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, failed, httpsUrl, json, list, record, text, unavailable, validFlightQuery} from './common.ts'

const providerId = 'travelpayouts-flights'
const endpoint = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates'

export function travelpayoutsRequest(query: ProviderQuery, market = 'us') {
    const params = new URLSearchParams({origin: query.origin!, destination: query.destination!, departure_at: query.departure!,
        currency: query.currency ?? 'EUR', one_way: String(!query.returnDate), direct: 'false', sorting: 'price', unique: 'false',
        limit: '30', page: '1', market})
    if (query.returnDate) params.set('return_at', query.returnDate)
    return endpoint + '?' + params
}

/** Aviasales' data feed contains previous searches for one traveller, not a group quotation. */
export function readTravelpayouts(payload: unknown, query: ProviderQuery, checkedAt: string): ProviderOffer[] {
    const body = record(payload)
    if (body.success !== true || !Array.isArray(body.data)) throw new Error('Источник не подтвердил данные')
    const currency = query.currency ?? 'EUR'
    if (body.currency && text(body.currency).toUpperCase() != currency) return []
    if (query.adults != 1 || query.checkedBag) return []
    const unique = new Map<string, ProviderOffer>()
    for (const row of list(body.data)) {
        const origin = text(row.origin_airport), destination = text(row.destination_airport)
        const departure = text(row.departure_at).slice(0, 10), returnDate = text(row.return_at).slice(0, 10) || null
        const matches = origin == query.origin && destination == query.destination && departure == query.departure && returnDate == (query.returnDate ?? null)
        if (!matches) continue
        const price = amount(row.price)
        const path = text(row.link)
        if (!path.startsWith('/search/')) continue
        const bookingUrl = httpsUrl(new URL(path, 'https://www.aviasales.com').href)
        if (!price || !bookingUrl || !bookingUrl.startsWith('https://www.aviasales.com/')) continue
        const id = providerId + '-' + createHash('sha256').update(path + ':' + price).digest('hex').slice(0, 20)
        const stops = typeof row.transfers == 'number' ? row.transfers : null
        const durationMinutes = typeof row.duration_to == 'number' ? row.duration_to : null
        unique.set(id, {id, providerId, kind: 'flights', title: text(row.airline) || 'Перелёт Aviasales',
            price: {amount: price, currency, basis: 'person'}, accuracy: 'cached-indicative', sourceUrl: bookingUrl, bookingUrl,
            checkedAt, expiresAt: null, departure, returnDate, adults: 1,
            flight: {origin, destination, carrier: text(row.airline) || null, stops, durationMinutes},
            includes: {checkedBags: null, taxes: null}, comparisonKey: null,
            conditions: 'Цена из кеша пользовательских поисков за последние 48 часов за одного взрослого. Доступность, багаж и сборы проверяются у продавца.'})
    }
    return [...unique.values()].sort((a, b) => a.price.amount - b.price.amount)
}

const adapter = {
    async search(query, deps) {
        if (!validFlightQuery(query)) return unavailable(providerId, 'Укажите конкретные аэропорты, даты и число взрослых.')
        if (query.adults != 1 || query.checkedBag) {
            return unavailable(providerId, 'Кеш Aviasales подтверждает ориентиры только за одного взрослого без проверки багажа.')
        }
        const token = deps.env.TRAVELPAYOUTS_TOKEN
        if (!token) return unavailable(providerId, 'Добавьте серверный TRAVELPAYOUTS_TOKEN из партнёрского кабинета.', 'requires-access')
        try {
            const checkedAt = deps.now().toISOString()
            const url = travelpayoutsRequest(query, deps.env.TRAVELPAYOUTS_MARKET ?? 'us')
            const payload = await json(deps, url, {headers: {'X-Access-Token': token}})
            const offers = readTravelpayouts(payload, query, checkedAt)
            return {providerId, status: 'cached', checkedAt, offers, sourceUrl: 'https://www.aviasales.com',
                description: 'Ориентиры на точные аэропорты и даты из кеша поисков Aviasales за последние 48 часов. При пустом ответе источник не подтвердил цену.'}
        } catch (error) { return failed(providerId, error) }
    }
} satisfies ProviderAdapter

export default adapter
