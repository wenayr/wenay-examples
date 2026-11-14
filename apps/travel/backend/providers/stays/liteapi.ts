import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hasGeo, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

export function liteapiRequest(query: ProviderQuery, deps: ProviderDeps) {
    if (!query.nationality) throw new ProviderQueryError('Nuitee Connect требует гражданство гостей.')
    const reference = refs(query, 'liteapi')
    let location: Record<string, unknown>
    if (reference.hotelIds?.length) location = {hotelIds: reference.hotelIds}
    else if (hasGeo(query)) location = {latitude: query.latitude, longitude: query.longitude, radius: Math.round((query.radiusKm ?? 10) * 1000)}
    else if (query.destination && /^[A-Z]{3}$/.test(query.destination)) location = {iataCode: query.destination}
    else throw new ProviderQueryError('Нужны координаты, IATA места или сопоставленные hotelIds Nuitee.')
    return jsonPost({...location, checkin: query.checkIn, checkout: query.checkOut, currency: query.currency ?? 'EUR',
        guestNationality: query.nationality.toUpperCase(), occupancies: roomAdults(query).map(adults => ({adults})),
        timeout: 10, limit: query.limit ?? 30, maxRatesPerHotel: 3, includeHotelData: true}, {'X-API-Key': deps.env.LITEAPI_KEY!})
}

function money(value: unknown, currency: string) {
    if (Array.isArray(value)) return value.map(object).find(price => price.currency == currency) ?? {}
    const price = object(value)
    return price.currency == currency ? price : {}
}

export function readLiteapi(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.error) throw new Error('Nuitee не подтвердил поиск')
    const currency = query.currency ?? 'EUR'
    return rows(root.data, 'Nuitee data').flatMap(value => {
        const hotel = object(value)
        return rows(hotel.roomTypes, 'Nuitee roomTypes').flatMap(value => {
            const type = object(value)
            if (type.rateType == 'package') return []
            const rates = rows(type.rates, 'Nuitee rates').map(object)
            if (rates.length != (query.rooms ?? 1) || rates.some(rate => rate.rateType == 'package')) return []
            const retail = amount(money(type.offerRetailRate, currency).amount)
            const minimumPublic = amount(money(type.suggestedSellingPrice, currency).amount)
            if (retail === null) return []
            const total = Math.max(retail, minimumPublic ?? retail)
            const fees = rates.flatMap(rate => {
                const items = object(rate.retailRate).taxesAndFees
                return Array.isArray(items) ? items.map(object) : []
            })
            const excluded = fees.some(fee => fee.included === false)
            const policies = rates.map(rate => text(object(rate.cancellationPolicies).refundableTag))
            const knownRefundability = policies.every(policy => ['RFN', 'NRFN'].includes(policy))
            const offer = hotelOffer('liteapi', query, deps, {hotelId: text(hotel.hotelId), rateId: text(type.offerId),
                name: text(hotel.name) || 'Nuitee · ' + hotel.hotelId, total, currency, sourceUrl: 'https://liteapi.travel/',
                board: [...new Set(rates.map(rate => text(rate.boardName)).filter(Boolean))].join(', ') || null,
                taxes: excluded ? false : null,
                refundable: knownRefundability ? policies.every(policy => policy == 'RFN') : null,
                conditions: 'Сумма всего предложения за все номера. Соблюдена переданная минимальная публичная цена. Сборы на месте и отмена проверяются в Prebook.'})
            return offer ? [offer] : []
        })
    })
}

export const {search} = stayAdapter({id: 'liteapi', website: 'https://liteapi.travel/', requiredEnv: ['LITEAPI_KEY']}, async function execute(query, deps) {
    return readLiteapi(await requestJson(deps, 'https://api.liteapi.travel/v3.0/hotels/rates', liteapiRequest(query, deps)), query, deps)
})
