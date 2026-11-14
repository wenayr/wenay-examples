import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

export function grnRequest(query: ProviderQuery, deps: ProviderDeps) {
    const hotelIds = refs(query, 'grnconnect').hotelIds
    if (!hotelIds?.length) throw new ProviderQueryError('Нужны сопоставленные hotel_codes GRNconnect из Static API.')
    if (!query.nationality) throw new ProviderQueryError('GRNconnect требует гражданство гостей.')
    return jsonPost({hotel_codes: hotelIds.slice(0, 100), checkin: query.checkIn, checkout: query.checkOut,
        client_nationality: query.nationality.toUpperCase(), currency: query.currency ?? 'EUR',
        rooms: roomAdults(query).map(adults => ({adults})), rates: 'comprehensive', cutoff_time: 10000, more_results: false},
        {'api-key': deps.env.GRNCONNECT_API_KEY!})
}

export function readGrn(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.error || root.errors) throw new Error('GRNconnect не подтвердил поиск')
    if (root.checkin != query.checkIn || root.checkout != query.checkOut) throw new Error('Даты GRNconnect не совпадают')
    return rows(root.hotels, 'GRNconnect hotels').flatMap(value => {
        const hotel = object(value)
        const rates = Array.isArray(hotel.rates) ? hotel.rates : [hotel.min_rate]
        return rates.flatMap(value => {
            const rate = object(value)
            if (rate.no_of_rooms != (query.rooms ?? 1)) return []
            const base = amount(rate.price)
            if (base === null) return []
            const minimum = object(rate.msp)
            const minAmount = minimum.currency == rate.currency ? amount(minimum.price) : null
            if (minimum.currency && minimum.currency != rate.currency) return []
            const details = Object.values(object(rate.price_details)).flatMap(value => Array.isArray(value) ? value.map(object) : [])
            const excluded = details.some(charge => charge.mandatory === true && charge.included === false)
            const offer = hotelOffer('grnconnect', query, deps, {hotelId: text(hotel.hotel_code), rateId: text(rate.rate_key),
                name: text(hotel.name), total: Math.max(base, minAmount ?? base), currency: rate.currency,
                sourceUrl: 'https://www.grnconnect.com/', board: Array.isArray(rate.boarding_details) ? rate.boarding_details.map(text).join(', ') : null,
                refundable: typeof rate.non_refundable == 'boolean' ? !rate.non_refundable : null,
                taxes: excluded ? false : null,
                priceType: minAmount ? 'retail' : 'unknown', conditions: 'Тариф включает все выбранные номера. Сохранён обязательный MSP, доступность и сборы проверяются Recheck.'})
            if (offer && rate.has_promotions === true && Array.isArray(rate.promotions_details)) {
                offer.deal = {kind: 'supplier-sale', description: rate.promotions_details.map(text).filter(Boolean).join(', '),
                    evidenceUrl: offer.sourceUrl, expiresAt: null}
            }
            return offer ? [offer] : []
        })
    })
}

export const {search} = stayAdapter({id: 'grnconnect', website: 'https://www.grnconnect.com/',
    requiredEnv: ['GRNCONNECT_API_KEY', 'GRNCONNECT_API_BASE']}, async function execute(query, deps) {
    const base = deps.env.GRNCONNECT_API_BASE!.replace(/\/$/, '')
    if (!base.startsWith('https://')) throw new ProviderQueryError('Укажите HTTPS host GRNconnect из настроек своего аккаунта.')
    return readGrn(await requestJson(deps, base + '/api/v3/hotels/availability', grnRequest(query, deps)), query, deps)
})
