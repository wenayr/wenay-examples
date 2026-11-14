import {createHash} from 'node:crypto'
import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hotelOffer, object, ProviderQueryError, refs, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

export function rapidRequest(query: ProviderQuery, deps: ProviderDeps) {
    const ids = refs(query, 'expedia-rapid').hotelIds
    if (!ids?.length) throw new ProviderQueryError('Expedia Rapid нужны сопоставленные property_id из Content или Typeahead API.')
    if (!query.bookerCountry) throw new ProviderQueryError('Expedia Rapid нужна страна заказчика.')
    const params = new URLSearchParams({checkin: query.checkIn!, checkout: query.checkOut!, currency: query.currency ?? 'EUR',
        country_code: query.bookerCountry.toUpperCase(), language: 'en-US', sales_channel: 'website', sales_environment: 'hotel_only'})
    for (const id of ids.slice(0, 250)) params.append('property_id', id)
    for (const count of roomAdults(query)) params.append('occupancy', String(count))
    const key = deps.env.EXPEDIA_RAPID_KEY!
    const timestamp = Math.floor(deps.now().getTime() / 1000)
    const signature = createHash('sha512').update(key + deps.env.EXPEDIA_RAPID_SECRET + timestamp).digest('hex')
    return {params, headers: {Accept: 'application/json', 'Accept-Encoding': 'gzip',
        Authorization: 'EAN APIKey=' + key + ',Signature=' + signature + ',timestamp=' + timestamp}}
}

export function readRapid(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    return rows(payload, 'Expedia Rapid properties').flatMap(value => {
        const property = object(value)
        return rows(property.rooms, 'Expedia Rapid rooms').flatMap(value => {
            const room = object(value)
            return rows(room.rates, 'Expedia Rapid rates').flatMap(value => {
                const rate = object(value)
                const pricing = object(rate.occupancy_pricing)
                const amounts = roomAdults(query).map(count => {
                    const totals = object(object(pricing[String(count)]).totals)
                    const inclusive = object(totals.property_inclusive)
                    const requested = object(inclusive.request_currency)
                    return requested.currency == (query.currency ?? 'EUR') ? amount(requested.value) : null
                })
                if (amounts.some(price => price === null)) return []
                const total = (amounts as number[]).reduce((sum, price) => sum + price, 0)
                const offer = hotelOffer('expedia-rapid', query, deps, {hotelId: text(property.property_id),
                    rateId: text(room.id) + ':' + text(rate.id), name: 'Expedia · ' + property.property_id,
                    total, currency: query.currency ?? 'EUR', sourceUrl: 'https://developers.expediagroup.com/rapid/lodging',
                    priceType: 'retail', taxes: true, refundable: typeof rate.refundable == 'boolean' ? rate.refundable : null,
                    conditions: 'Property-inclusive total включает сборы Expedia и объекта за весь срок. Цена и доступность требуют Price Check.'})
                if (offer && room.room_name) offer.title += ' · ' + text(room.room_name)
                return offer ? [offer] : []
            })
        })
    })
}

export const {search} = stayAdapter({id: 'expedia-rapid', website: 'https://developers.expediagroup.com/rapid',
    requiredEnv: ['EXPEDIA_RAPID_KEY', 'EXPEDIA_RAPID_SECRET']}, async function execute(query, deps) {
    const request = rapidRequest(query, deps)
    const host = deps.env.EXPEDIA_RAPID_SANDBOX == 'true' ? 'https://test.ean.com' : 'https://api.ean.com'
    const payload = await requestJson(deps, host + '/v3/properties/availability?' + request.params, {headers: request.headers})
    return readRapid(payload, query, deps)
})
