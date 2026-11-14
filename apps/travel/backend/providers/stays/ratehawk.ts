import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {basic, hasGeo, hotelOffer, jsonPost, object, ProviderQueryError, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

export function ratehawkRequest(query: ProviderQuery, deps: ProviderDeps) {
    if (!hasGeo(query)) throw new ProviderQueryError('RateHawk ищет вокруг координат выбранного места.')
    if (!query.nationality) throw new ProviderQueryError('Для RateHawk нужно гражданство гостей.')
    if ((query.radiusKm ?? 10) > 70) throw new ProviderQueryError('RateHawk поддерживает географический радиус до 70 км. Другие источники продолжают поиск.')
    return jsonPost({checkin: query.checkIn, checkout: query.checkOut, residency: query.nationality.toLowerCase(),
        language: 'en', currency: query.currency ?? 'EUR', guests: roomAdults(query).map(adults => ({adults, children: []})),
        latitude: query.latitude, longitude: query.longitude, radius: Math.round((query.radiusKm ?? 10) * 1000), hotels_limit: query.limit ?? 30,
        timeout: 10}, {Authorization: basic(deps.env.RATEHAWK_KEY_ID!, deps.env.RATEHAWK_API_KEY!)})
}

export function readRatehawk(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.status != 'ok' || root.error) throw new Error('RateHawk не подтвердил поиск')
    return rows(object(root.data).hotels, 'RateHawk hotels').flatMap(value => {
        const hotel = object(value)
        return rows(hotel.rates, 'RateHawk rates').flatMap(value => {
            const rate = object(value)
            const payments = rows(object(rate.payment_options).payment_types, 'RateHawk payment_types')
            return payments.flatMap((value, index) => {
                const payment = object(value)
                const currency = text(payment.show_currency_code)
                if (currency != (query.currency ?? 'EUR')) return []
                const offer = hotelOffer('ratehawk', query, deps, {hotelId: String(hotel.hid ?? hotel.id ?? ''),
                    rateId: text(rate.match_hash) || text(rate.book_hash) + '-' + index, name: text(hotel.name) || text(hotel.id),
                    total: payment.show_amount, currency, sourceUrl: 'https://www.ratehawk.com/', board: text(rate.meal) || null,
                    conditions: 'Результат SERP. Подробный тариф, налоги на месте и доступность подтверждаются Hotelpage и Prebook.'})
                return offer ? [offer] : []
            })
        })
    })
}

export const {search} = stayAdapter({id: 'ratehawk', website: 'https://www.ratehawk.com/',
    requiredEnv: ['RATEHAWK_KEY_ID', 'RATEHAWK_API_KEY']}, async function execute(query, deps) {
    const origin = deps.env.RATEHAWK_SANDBOX == 'true' ? 'https://api-sandbox.ratehawk.com' : 'https://api.ratehawk.com'
    return readRatehawk(await requestJson(deps, origin + '/api/b2b/v3/search/serp/geo/', ratehawkRequest(query, deps)), query, deps)
})
