import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

export function agodaRequest(query: ProviderQuery, deps: ProviderDeps) {
    const hotelIds = refs(query, 'agoda').hotelIds
    if (!hotelIds?.length || hotelIds.some(id => !/^\d+$/.test(id))) throw new ProviderQueryError('Нужны сопоставленные propertyIds Agoda.')
    if (!query.nationality) throw new ProviderQueryError('Agoda требует гражданство гостей для доступных тарифов.')
    return jsonPost({waitTime: 10, criteria: {propertyIds: hotelIds.slice(0, 100).map(Number),
        checkIn: query.checkIn, checkOut: query.checkOut, rooms: query.rooms ?? 1, adults: query.adults, children: 0,
        language: 'en-us', currency: query.currency ?? 'EUR', userCountry: query.nationality.toUpperCase()},
        features: {ratesPerProperty: hotelIds.length > 30 ? 1 : 5, extra: ['content', 'rateDetail', 'taxDetail', 'surchargeDetail']}},
        {Authorization: deps.env.AGODA_SITE_ID + ':' + deps.env.AGODA_API_KEY, 'Accept-Encoding': 'gzip'})
}

export function readAgoda(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.error || root.errors) throw new Error('Agoda не подтвердил поиск')
    return rows(root.properties, 'Agoda properties').flatMap(value => {
        const hotel = object(value)
        return rows(hotel.rooms, 'Agoda rooms').flatMap(value => {
            const room = object(value)
            const payment = object(room.totalPayment)
            const inclusive = amount(payment.inclusive)
            const minimum = amount(payment.minSellPrice)
            const reference = amount(payment.refSellAmount)
            if (inclusive === null) return []
            const total = Math.max(inclusive, minimum ?? inclusive, reference ?? inclusive)
            const refundable = room.freeCancellation
            const offer = hotelOffer('agoda', query, deps, {hotelId: String(hotel.propertyId ?? ''),
                rateId: text(room.blockId) || String(room.roomId ?? '') + ':' + String(room.ratePlanId ?? ''),
                name: text(hotel.propertyName), total, currency: object(room.rate).currency,
                priceType: 'retail', sourceUrl: 'https://www.agoda.com/', board: room.freeBreakfast === true ? 'Breakfast' : null,
                refundable: typeof refundable == 'boolean' ? refundable : null,
                conditions: 'Сумма totalPayment за бронирование с соблюдением минимальной и обязательной reference selling price. Нужен Precheck.'})
            if (offer && room.roomName) offer.title += ' · ' + text(room.roomName)
            return offer ? [offer] : []
        })
    })
}

export const {search} = stayAdapter({id: 'agoda', website: 'https://www.agoda.com/',
    requiredEnv: ['AGODA_SITE_ID', 'AGODA_API_KEY', 'AGODA_API_BASE']}, async function execute(query, deps) {
    const base = deps.env.AGODA_API_BASE!.replace(/\/$/, '')
    if (!base.startsWith('https://')) throw new ProviderQueryError('Укажите HTTPS endpoint Agoda, предоставленный менеджером партнёра.')
    return readAgoda(await requestJson(deps, base + '/api/v4/property/availability', agodaRequest(query, deps)), query, deps)
})
