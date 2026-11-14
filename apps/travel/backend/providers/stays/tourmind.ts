import {randomUUID} from 'node:crypto'
import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

export function tourmindRequest(query: ProviderQuery, deps: ProviderDeps) {
    const hotelIds = refs(query, 'tourmind').hotelIds
    if (!hotelIds?.length || hotelIds.some(id => !/^\d+$/.test(id))) throw new ProviderQueryError('Нужны сопоставленные HotelCodes TourMind.')
    if (!query.nationality) throw new ProviderQueryError('TourMind требует гражданство гостей.')
    const rooms = query.rooms ?? 1
    if (query.adults % rooms) throw new ProviderQueryError('TourMind поддерживает одинаковое число гостей во всех номерах.')
    return jsonPost({CheckIn: query.checkIn, CheckOut: query.checkOut, HotelCodes: hotelIds.slice(0, 20).map(Number),
        Nationality: query.nationality.toUpperCase(), Timeout: 10000,
        PaxRooms: roomAdults(query).map(adults => ({Adults: adults, Children: 0, ChildrenAges: [], RoomCount: 1})),
        RequestHeader: {AgentCode: deps.env.TOURMIND_AGENT_CODE, UserName: deps.env.TOURMIND_USERNAME, Password: deps.env.TOURMIND_PASSWORD,
            RequestTime: deps.now().toISOString(), TransactionID: randomUUID()}},
        {'X-Agent-Code': deps.env.TOURMIND_AGENT_CODE!, 'X-Username': deps.env.TOURMIND_USERNAME!, 'Accept-Encoding': 'gzip'})
}

export function readTourmind(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.Error) throw new Error('TourMind не подтвердил поиск')
    return rows(root.Hotels, 'TourMind hotels').flatMap(value => {
        const hotel = object(value)
        if (hotel.CheckIn != query.checkIn || hotel.CheckOut != query.checkOut) return []
        return rows(hotel.RoomTypes, 'TourMind RoomTypes').flatMap(value => {
            const room = object(value)
            return rows(room.RateInfos, 'TourMind RateInfos').flatMap(value => {
                const rate = object(value)
                if (rate.OnRequest !== false || Number(rate.Allotment) < (query.rooms ?? 1)) return []
                const fees = Array.isArray(rate.TaxesAndFees) ? rate.TaxesAndFees.map(object) : []
                const excluded = fees.some(fee => fee.Included === false)
                const offer = hotelOffer('tourmind', query, deps, {hotelId: String(hotel.HotelCode ?? ''), rateId: text(rate.RateCode),
                    name: 'TourMind · ' + hotel.HotelCode, total: rate.TotalPrice, currency: rate.CurrencyCode,
                    sourceUrl: 'https://www.tourmind.cn/', board: text(object(rate.MealInfo).MealType) || null,
                    taxes: excluded ? false : null,
                    refundable: typeof rate.Refundable == 'boolean' ? rate.Refundable : null,
                    conditions: 'Сумма TotalPrice поставщика. Только подтверждаемые тарифы, доступность и итог проверяются в Prebook.'})
                if (offer && room.Name) offer.title += ' · ' + text(room.Name)
                return offer ? [offer] : []
            })
        })
    })
}

export const {search} = stayAdapter({id: 'tourmind', website: 'https://www.tourmind.cn/',
    requiredEnv: ['TOURMIND_AGENT_CODE', 'TOURMIND_USERNAME', 'TOURMIND_PASSWORD', 'TOURMIND_API_BASE']}, async function execute(query, deps) {
    const base = deps.env.TOURMIND_API_BASE!.replace(/\/$/, '')
    if (!base.startsWith('https://')) throw new ProviderQueryError('Укажите HTTPS host TourMind, согласованный для вашей среды.')
    return readTourmind(await requestJson(deps, base + '/v2/HotelDetail', tourmindRequest(query, deps)), query, deps)
})
