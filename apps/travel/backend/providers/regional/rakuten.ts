import type {ProviderDeps, ProviderOffer, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'
import {
    hotelInput, hotelOffer, object, ProviderAccessError, ProviderQueryError, refs, requestJson, text
} from '../stays/common.ts'
import {httpsUrl} from '../aviation/common.ts'

const id = 'rakuten'
const docs = 'https://webservice.rakuten.co.jp/documentation/vacant-hotel-search'
const endpoint = 'https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426'

export function rakutenRequest(query: ProviderQuery, deps: ProviderDeps) {
    const problem = hotelInput(query)
    if (problem) throw new ProviderQueryError(problem)
    if (query.country && query.country != 'JP') throw new ProviderQueryError('Этот источник обслуживает гостиницы Японии.')
    if ((query.rooms ?? 1) != 1) throw new ProviderQueryError('Для сопоставимой цены Rakuten в этом адаптере укажите один номер.')
    const hotels = refs(query, id).hotelIds ?? []
    const geo = Number.isFinite(query.latitude) && Number.isFinite(query.longitude)
    if (!hotels.length && !geo) throw new ProviderQueryError('Rakuten требует координаты гостиничного района или собственные hotel IDs.')
    if (hotels.length > 15 || hotels.some(value => !/^[1-9]\d{0,9}$/.test(value))) {
        throw new ProviderQueryError('Rakuten принимает до 15 числовых hotel IDs.')
    }
    if (!hotels.length && (query.radiusKm ?? 1) > 3) throw new ProviderQueryError('Геопоиск Rakuten имеет радиус до 3 км. Другие источники продолжают поиск.')
    const hits = Math.min(query.limit ?? 10, 30)
    const offset = query.offset ?? 0
    if (offset % hits || offset / hits >= 100) throw new ProviderQueryError('Укажите начало страницы Rakuten и до 100 страниц.')
    const url = new URL(endpoint)
    const params = new URLSearchParams({applicationId: deps.env.RAKUTEN_APPLICATION_ID!, format: 'json', formatVersion: '1',
        checkinDate: query.checkIn!, checkoutDate: query.checkOut!, adultNum: String(query.adults), roomNum: '1', datumType: '1',
        searchPattern: '0', responseType: 'large', hits: String(hits), page: String(offset / hits + 1)})
    if (hotels.length) params.set('hotelNo', hotels.join(','))
    else {
        params.set('latitude', String(query.latitude))
        params.set('longitude', String(query.longitude))
        params.set('searchRadius', String(Math.max(0.1, Math.round((query.radiusKm ?? 1) * 10) / 10)))
    }
    if (deps.env.RAKUTEN_AFFILIATE_ID) params.set('affiliateId', deps.env.RAKUTEN_AFFILIATE_ID)
    url.search = params.toString()
    return {url: url.href, init: {headers: {accessKey: deps.env.RAKUTEN_ACCESS_KEY!, Accept: 'application/json'}}}
}

function hotelParts(value: unknown) {
    const hotel = object(value).hotel ?? value
    return Array.isArray(hotel) ? hotel.map(object) : [object(hotel)]
}

function coordinate(value: unknown) {
    if (value === null || value === undefined || value === '') return undefined
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
}

function offerForRoom(hotel: Record<string, unknown>, roomValue: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const parts = Array.isArray(roomValue) ? roomValue.map(object) : [object(roomValue)]
    const room = object(parts.find(part => part.roomBasicInfo)?.roomBasicInfo)
    const daily = object(parts.find(part => part.dailyCharge)?.dailyCharge)
    if (Number(daily.chargeFlag) != 1 || daily.stayDate != query.checkIn) return null
    const hotelId = String(hotel.hotelNo ?? '')
    const roomClass = text(room.roomClass)
    const planId = String(room.planId ?? '')
    if (!hotelId || !roomClass || !planId) return null
    const breakfast = Number(room.withBreakfastFlag) == 1
    const dinner = Number(room.withDinnerFlag) == 1
    const includedMeals = {Завтрак: breakfast, Ужин: dinner}
    const meals = Object.keys(includedMeals).filter(name => includedMeals[name as keyof typeof includedMeals]).join(', ') || null
    const offer = hotelOffer(id, query, deps, {hotelId, rateId: roomClass + ':' + planId,
        name: text(hotel.hotelName), total: daily.rakutenCharge, currency: 'JPY', sourceUrl: docs,
        bookingUrl: httpsUrl(room.reserveUrl), basis: 'room-night', accuracy: 'published-from', priceType: 'retail', board: meals,
        latitude: coordinate(hotel.latitude), longitude: coordinate(hotel.longitude),
        conditions: 'Цена одного номера за первую ночь ' + query.checkIn + ' в JPY. Остальные ночи, сборы и правила отмены проверяются у продавца. ' +
            text(room.roomName) + '. ' + text(room.planName)})
    if (!offer) return null
    const image = httpsUrl(hotel.hotelImageUrl)
    return image ? {...offer, media: [{url: image, sourceUrl: httpsUrl(hotel.hotelInformationUrl) ?? docs, credit: 'Rakuten Travel'}]} : offer
}

export function readRakuten(payload: unknown, query: ProviderQuery, deps: ProviderDeps): ProviderResult {
    const data = object(payload)
    if (data.error == 'not_found') return {providerId: id, status: 'live', offers: [], checkedAt: deps.now().toISOString(),
        sourceUrl: docs, description: 'Источник подтвердил отсутствие подходящих комнат по запросу.'}
    if (data.error) throw new Error('Rakuten не подтвердил ответ.')
    if (!Array.isArray(data.hotels)) throw new Error('Неверный формат Rakuten hotels.')
    const offers: ProviderOffer[] = []
    const requested = refs(query, id).hotelIds ?? []
    for (const value of data.hotels) {
        const parts = hotelParts(value)
        const hotel = object(parts.find(part => part.hotelBasicInfo)?.hotelBasicInfo)
        if (requested.length && !requested.includes(String(hotel.hotelNo))) continue
        for (const part of parts) {
            if (!part.roomInfo) continue
            const offer = offerForRoom(hotel, part.roomInfo, query, deps)
            if (offer) offers.push(offer)
        }
    }
    const paging = object(data.pagingInfo)
    const count = Number(paging.recordCount)
    const total = Number.isSafeInteger(count) && count >= 0 ? count : null
    const hits = Math.min(query.limit ?? 10, 30)
    const next = (query.offset ?? 0) + data.hotels.length
    const hasMore = total !== null && next < total && data.hotels.length == hits
    const unsupportedUnits = data.hotels.length > 0 && offers.length == 0
    return {providerId: id, status: unsupportedUnits ? 'unsupported-query' : 'live', offers, checkedAt: deps.now().toISOString(),
        sourceUrl: docs, total, partial: hasMore, nextOffset: hasMore ? next : null,
        description: unsupportedUnits ? 'Источник вернул комнаты без подтверждённой цены за номер первой ночи. Полная цена не рассчитана.' :
            'Доступные комнаты по датам запроса. Отображается опубликованная цена первой ночи за один номер в JPY.'}
}

export async function search(query: ProviderQuery, deps: ProviderDeps): Promise<ProviderResult> {
    if (!deps.env.RAKUTEN_APPLICATION_ID || !deps.env.RAKUTEN_ACCESS_KEY) return {providerId: id, status: 'requires-access', offers: [],
        checkedAt: null, sourceUrl: docs, description: 'Нужны серверные RAKUTEN_APPLICATION_ID и RAKUTEN_ACCESS_KEY.'}
    try {
        const request = rakutenRequest(query, deps)
        return readRakuten(await requestJson(deps, request.url, request.init), query, deps)
    } catch (error) {
        if (error instanceof ProviderQueryError) return {providerId: id, status: 'unsupported-query', offers: [], checkedAt: null,
            sourceUrl: docs, description: error.message}
        return {providerId: id, status: error instanceof ProviderAccessError ? 'requires-access' : 'unavailable', offers: [], checkedAt: null,
            sourceUrl: docs, description: 'Rakuten не подтвердил данные. Проверьте доступ и повторите поиск.'}
    }
}
