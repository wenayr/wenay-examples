import type {ProviderAdapter, ProviderOffer} from '../../../src/provider-contract.ts'
import {createTezInventory} from '../../partners/tez-inventory.ts'
import {packageDestinations, packageMaxTotal} from '../../../src/package-contract.ts'
import {unsupported} from './common.ts'

export function createTezAdapter() {
    let resource: ReturnType<typeof createTezInventory> | undefined
    const adapter = {
        async search(query, deps) {
            const start = query.departure ?? query.checkIn
            const end = query.returnDate ?? query.checkOut
            if (!start || !end) return unsupported('tez', 'Укажите даты начала и конца поездки.')
            const destination = query.providerRefs?.tez?.destinationId ?? query.destination ?? ''
            const supported = packageDestinations.some(id => id == destination) && (!query.origin || query.origin == 'TLL') && query.adults == 2
            if (!supported) return unsupported('tez', 'Этот адаптер проверяет пакеты TEZ из Таллина за двоих в Хургаду, Шарм-эль-Шейх и Родос.')
            const nights = (Date.parse(end) - Date.parse(start)) / 86_400_000
            if (!Number.isInteger(nights) || nights < 1 || nights > 30) return unsupported('tez', 'Длительность тура от 1 до 30 ночей.')
            resource ??= createTezInventory(deps)
            const result = await resource.window({destinationId: destination, first: start, last: start, nights,
                adults: query.adults, minTotal: 0, maxTotal: packageMaxTotal})
            const checkedAt = result.source.updatedAt
            const offers = checkedAt ? result.quotes.map(quote => ({
                id: quote.id, providerId: 'tez', kind: 'packages', title: quote.name,
                price: {amount: quote.total / 100, currency: 'EUR', basis: 'party'}, accuracy: 'published-from',
                sourceUrl: quote.url, bookingUrl: quote.url, checkedAt, expiresAt: null, departure: quote.departure,
                returnDate: end, adults: query.adults, hotel: {id: quote.hotelId, name: quote.name, stars: quote.stars,
                    ...(quote.latitude != null ? {latitude: quote.latitude, longitude: quote.longitude!} : {})},
                includes: {checkedBags: null, taxes: null}, conditions: result.source.description, comparisonKey: null
            } satisfies ProviderOffer)) : []
            return {providerId: 'tez', status: result.source.status, offers, checkedAt, description: result.source.description,
                sourceUrl: result.source.url}
        }
    } satisfies ProviderAdapter
    return adapter
}
