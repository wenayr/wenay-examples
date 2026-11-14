import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

export function didaRequest(query: ProviderQuery, deps: ProviderDeps) {
    const hotels = refs(query, 'dida').hotelIds
    const rooms = query.rooms ?? 1
    if (!hotels?.length || hotels.some(id => !/^\d+$/.test(id))) throw new ProviderQueryError('Нужны сопоставленные числовые HotelID Dida.')
    if (!query.nationality) throw new ProviderQueryError('Dida требует фактическое гражданство гостей.')
    if (query.adults % rooms) throw new ProviderQueryError('Dida PriceSearch поддерживает одинаковое размещение взрослых во всех номерах.')
    return jsonPost({Header: {ClientID: deps.env.DIDA_CLIENT_ID, LicenseKey: deps.env.DIDA_LICENSE_KEY},
        HotelIDList: hotels.slice(0, 50).map(Number), CheckInDate: query.checkIn, CheckOutDate: query.checkOut,
        IsRealTime: {Value: true, RoomCount: rooms}, RealTimeOccupancy: {AdultCount: query.adults / rooms, ChildCount: 0, ChildAgeDetails: []},
        Currency: query.currency ?? 'EUR', Nationality: query.nationality.toUpperCase()})
}

export function readDida(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.Error) throw new Error('Dida не подтвердил поиск')
    const detail = object(object(root.Success).PriceDetails)
    if (text(detail.CheckInDate).slice(0, 10) != query.checkIn || text(detail.CheckOutDate).slice(0, 10) != query.checkOut) {
        throw new Error('Даты Dida не совпадают')
    }
    return rows(detail.HotelList, 'Dida HotelList').flatMap(value => {
        const hotel = object(value)
        return rows(hotel.RatePlanList, 'Dida RatePlanList').flatMap(value => {
            const rate = object(value)
            const occupancy = object(rate.RoomOccupancy)
            if (rate.RoomStatus != 1 || occupancy.AdultCount != query.adults / (query.rooms ?? 1)) return []
            const perRoom = amount(rate.TotalPrice)
            if (perRoom === null) return []
            const offer = hotelOffer('dida', query, deps, {hotelId: String(hotel.HotelID ?? ''), rateId: text(rate.RatePlanID),
                name: text(hotel.HotelName) || 'Dida · ' + hotel.HotelID, total: perRoom * (query.rooms ?? 1), currency: rate.Currency,
                sourceUrl: 'https://www.didatravel.com/', board: rate.BreakfastType == 1 ? 'Breakfast' : null,
                conditions: 'PriceSearch возвращает цену одного номера за срок. Сумма рассчитана для одинакового размещения во всех номерах. PriceConfirm обязателен.'})
            return offer ? [offer] : []
        })
    })
}

export const {search} = stayAdapter({id: 'dida', website: 'https://www.didatravel.com/',
    requiredEnv: ['DIDA_CLIENT_ID', 'DIDA_LICENSE_KEY']}, async function execute(query, deps) {
    return readDida(await requestJson(deps, 'https://apiint.didatravel.com/api/rate/pricesearch?$format=json', didaRequest(query, deps)), query, deps)
})
