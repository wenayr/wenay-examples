import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {hotelOffer, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

function displayedAmount(value: unknown, currency: string) {
    if (typeof value == 'number') return value
    if (typeof value != 'string') return null
    const symbols: Record<string, string> = {EUR: '€', USD: '$', GBP: '£'}
    const symbol = symbols[currency]
    const cleaned = value.replaceAll(currency, '').replaceAll(symbol ?? '\u0000', '').replaceAll(',', '').trim()
    return /^\d+(\.\d{1,2})?$/.test(cleaned) ? Number(cleaned) : null
}

export function readMakcorps(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const currency = query.currency ?? 'EUR'
    return rows(payload, 'Makcorps hotels').flatMap(value => {
        const hotel = object(value)
        return [1, 2, 3, 4].flatMap(index => {
            const vendor = text(hotel['vendor' + index])
            if (!vendor) return []
            const offer = hotelOffer('makcorps', query, deps, {hotelId: String(hotel.hotelId ?? ''), rateId: vendor,
                name: text(hotel.name), total: displayedAmount(hotel['price' + index], currency), currency,
                sourceUrl: 'https://www.makcorps.com/', basis: 'room-night', accuracy: 'cached-indicative', taxes: true,
                conditions: 'Ориентир Makcorps за номер за ночь от ' + vendor + '. Запрошены налоги; тип номера, отмена и сборы проверяются у продавца.'})
            return offer ? [offer] : []
        })
    })
}

export const {search} = stayAdapter({id: 'makcorps', website: 'https://www.makcorps.com/',
    requiredEnv: ['MAKCORPS_API_KEY']}, async function execute(query, deps) {
    const reference = refs(query, 'makcorps')
    let destinationId = reference.destinationId
    if (!destinationId && query.destination) {
        const params = new URLSearchParams({api_key: deps.env.MAKCORPS_API_KEY!, name: query.destination})
        const places = rows(await requestJson(deps, 'https://api.makcorps.com/mapping?' + params), 'Makcorps mapping').map(object)
        const match = places.find(place => place.type == 'GEO' && text(place.name).toLowerCase() == query.destination!.toLowerCase())
        destinationId = match ? String(match.document_id ?? '') : undefined
    }
    if (!destinationId) throw new ProviderQueryError('Нужен однозначный город Makcorps или destinationId, полученный через Mapping API.')
    const params = new URLSearchParams({api_key: deps.env.MAKCORPS_API_KEY!, cityid: destinationId, pagination: '0', cur: query.currency ?? 'EUR',
        rooms: String(query.rooms ?? 1), adults: String(query.adults), checkin: query.checkIn!, checkout: query.checkOut!, tax: 'true'})
    return readMakcorps(await requestJson(deps, 'https://api.makcorps.com/city?' + params), query, deps)
})
