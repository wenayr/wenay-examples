import {createHash} from 'node:crypto'
import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hasGeo, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

export function hotelbedsRequest(query: ProviderQuery, deps: ProviderDeps) {
    const rooms = query.rooms ?? 1
    if (query.adults % rooms) throw new ProviderQueryError('Для Hotelbeds укажите одинаковое число взрослых в каждом номере.')
    const hotelIds = refs(query, 'hotelbeds').hotelIds
    if (!hotelIds?.length && !hasGeo(query)) throw new ProviderQueryError('Для Hotelbeds нужны координаты или сопоставленные коды Hotelbeds.')
    const selector = hotelIds?.length ? {hotels: {hotel: hotelIds.map(Number)}} :
        {geolocation: {latitude: query.latitude, longitude: query.longitude, radius: query.radiusKm ?? 10, unit: 'km'}}
    const seconds = Math.floor(deps.now().getTime() / 1000)
    const key = deps.env.HOTELBEDS_API_KEY!
    const signature = createHash('sha256').update(key + deps.env.HOTELBEDS_SECRET + seconds).digest('hex')
    return jsonPost({stay: {checkIn: query.checkIn, checkOut: query.checkOut}, occupancies: [{rooms, adults: query.adults / rooms, children: 0}], ...selector},
        {'Api-key': key, 'X-Signature': signature})
}

export function readHotelbeds(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const envelope = object(payload)
    if (envelope.error) throw new Error('Hotelbeds вернул ошибку')
    const catalog = object(envelope.hotels)
    if (catalog.checkIn && catalog.checkIn != query.checkIn) throw new Error('Даты Hotelbeds не совпадают')
    if (catalog.checkOut && catalog.checkOut != query.checkOut) throw new Error('Даты Hotelbeds не совпадают')
    return rows(catalog.hotels, 'Hotelbeds hotels').flatMap(value => {
        const hotel = object(value)
        const rooms = rows(hotel.rooms, 'Hotelbeds rooms')
        return rooms.flatMap(value => rows(object(value).rates, 'Hotelbeds rates').flatMap(value => {
            const rate = object(value)
            const selling = amount(rate.sellingRate)
            const net = amount(rate.net)
            if (rate.rooms != (query.rooms ?? 1)) return []
            const taxes = object(rate.taxes).allIncluded
            const offer = hotelOffer('hotelbeds', query, deps, {hotelId: String(hotel.code ?? ''), rateId: text(rate.rateKey), name: text(hotel.name),
                total: selling ?? net, currency: hotel.currency, sourceUrl: 'https://developer.hotelbeds.com/documentation/hotels/booking-api/',
                board: text(rate.boardName) || null, taxes: typeof taxes == 'boolean' ? taxes : null,
                priceType: selling ? 'retail' : 'net',
                accuracy: selling ? 'live-offer' : 'published-from',
                conditions: selling ?
                    'Цена продажи Hotelbeds. Условия отмены, местные сборы и требование CheckRates нужно проверить перед бронью.' :
                    'Нетто-стоимость для агентства. Розничная цена и дополнительные местные сборы требуют расчёта и подтверждения.'})
            return offer ? [offer] : []
        }))
    })
}

export const {search} = stayAdapter({id: 'hotelbeds', website: 'https://www.hotelbeds.com/',
    requiredEnv: ['HOTELBEDS_API_KEY', 'HOTELBEDS_SECRET']}, async function execute(query, deps) {
    const origin = deps.env.HOTELBEDS_SANDBOX == 'true' ? 'https://api.test.hotelbeds.com' : 'https://api.hotelbeds.com'
    return readHotelbeds(await requestJson(deps, origin + '/hotel-api/1.0/hotels', hotelbedsRequest(query, deps)), query, deps)
})
