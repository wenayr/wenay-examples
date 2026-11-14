import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hasGeo, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

export function bookingRequest(query: ProviderQuery, deps: ProviderDeps) {
    if (!query.bookerCountry) throw new ProviderQueryError('Для Booking.com нужна страна заказчика.')
    const reference = refs(query, 'booking-demand')
    let location: Record<string, unknown>
    if (reference.hotelIds?.length) location = {accommodations: reference.hotelIds.map(Number)}
    else if (reference.destinationId) location = {city: Number(reference.destinationId)}
    else if (hasGeo(query)) location = {coordinates: {latitude: query.latitude, longitude: query.longitude, radius: query.radiusKm ?? 10}}
    else throw new ProviderQueryError('Нужны координаты, город Booking.com или сопоставленные коды объектов Booking.com.')
    return jsonPost({...location, booker: {country: query.bookerCountry.toLowerCase(), platform: 'desktop'},
        checkin: query.checkIn, checkout: query.checkOut, currency: query.currency ?? 'EUR',
        guests: {number_of_adults: query.adults, number_of_rooms: query.rooms ?? 1}, extras: ['extra_charges', 'products'], rows: 30},
        {Authorization: 'Bearer ' + deps.env.BOOKING_DEMAND_TOKEN, 'X-Affiliate-Id': deps.env.BOOKING_AFFILIATE_ID!})
}

export function readBooking(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.errors) throw new Error('Booking Demand вернул ошибку')
    return rows(root.data, 'Booking data').flatMap(value => {
        const hotel = object(value)
        const price = object(hotel.price)
        const currencies = object(hotel.currency)
        const totals = object(price.total)
        const bookerAmount = amount(totals.booker_currency)
        const total = bookerAmount ?? amount(totals.accommodation_currency) ?? amount(price.total)
        const multiCurrency = bookerAmount !== null ? currencies.booker : currencies.accommodation
        const currency = text(multiCurrency) || text(hotel.currency) || text(price.currency)
        const offer = hotelOffer('booking-demand', query, deps, {hotelId: String(hotel.id ?? ''), rateId: 'search',
            name: text(hotel.name) || 'Booking.com · ' + hotel.id, total, currency,
            sourceUrl: 'https://developers.booking.com/demand/docs/accommodations/search-for-available-properties',
            bookingUrl: text(hotel.url) || null, accuracy: 'published-from',
            conditions: 'Результат поиска Booking.com. Цена выбранного номера, сборы и отмена уточняются через Availability и Orders Preview.'})
        return offer ? [offer] : []
    })
}

export const {search} = stayAdapter({id: 'booking-demand', website: 'https://www.booking.com/',
    requiredEnv: ['BOOKING_DEMAND_TOKEN', 'BOOKING_AFFILIATE_ID']}, async function execute(query, deps) {
    const host = deps.env.BOOKING_DEMAND_SANDBOX == 'true' ? 'https://demandapi-sandbox.booking.com' : 'https://demandapi.booking.com'
    return readBooking(await requestJson(deps, host + '/3.3/accommodations/search', bookingRequest(query, deps)), query, deps)
})
