import type {ProviderDeps, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {hotelOffer, object, requestJson, rows, stayAdapter, text} from './common.ts'
import {xoteloHotels} from './xotelo-location.ts'

type tXoteloHotel = {key: string, name: string, image?: string, url?: string, latitude?: number, longitude?: number}

export function readXotelo(payload: unknown, query: ProviderQuery, deps: ProviderDeps, hotelKey: string, hotel?: tXoteloHotel) {
    const root = object(payload)
    if (root.error) throw new Error('Xotelo не подтвердил данные')
    const result = object(root.result)
    if (result.chk_in != query.checkIn || result.chk_out != query.checkOut) throw new Error('Даты Xotelo не совпадают')
    const currency = text(result.currency)
    if (currency != (query.currency ?? 'EUR')) throw new Error('Xotelo не подтвердил валюту')
    const sourceUrl = hotel?.url || 'https://www.tripadvisor.com/Hotel_Review-' + hotelKey + '.html'
    const rates = rows(result.rates, 'Xotelo rates')
    return rates.flatMap(value => {
        const rate = object(value)
        const seller = text(rate.name)
        const offer = hotelOffer('xotelo', query, deps, {hotelId: hotelKey, rateId: text(rate.code), name: hotel?.name || hotelKey,
            total: rate.rate, currency, sourceUrl, basis: 'room-night', accuracy: 'cached-indicative',
            latitude: hotel?.latitude, longitude: hotel?.longitude,
            conditions: 'Ориентир за номер за ночь от ' + seller + '. Налоги, тип номера и условия проверяются у продавца.'})
        if (!offer) return []
        const image = hotel?.image
        if (image?.startsWith('https://dynamic-media-cdn.tripadvisor.com/')) {
            offer.media = [{url: image, sourceUrl, credit: 'Изображение из данных Xotelo / Tripadvisor'}]
        }
        return [{...offer, title: (hotel?.name || hotelKey) + ' · ' + seller}]
    })
}

async function searchPage(query: ProviderQuery, deps: ProviderDeps) {
    const page = await xoteloHotels(query, deps)
    async function rates(hotel: tXoteloHotel) {
        const params = new URLSearchParams({hotel_key: hotel.key, chk_in: query.checkIn!, chk_out: query.checkOut!,
            currency: query.currency ?? 'EUR', adults: String(query.adults), rooms: String(query.rooms ?? 1)})
        const payload = await requestJson(deps, 'https://data.xotelo.com/api/rates?' + params)
        return readXotelo(payload, query, deps, hotel.key, hotel)
    }
    const offers: ProviderOffer[] = []
    let next = 0
    let failures = 0
    async function worker() {
        while (next < page.hotels.length) {
            const hotel = page.hotels[next++]
            try {offers.push(...await rates(hotel))} catch {failures++}
        }
    }
    await Promise.all(Array.from({length: Math.min(4, page.hotels.length)}, worker))
    if (page.hotels.length && failures == page.hotels.length) throw new Error('Xotelo не подтвердил цены отелей')
    return {offers, total: page.total, nextOffset: page.nextOffset, partial: page.nextOffset !== null || failures > 0}
}

export async function search(query: ProviderQuery, deps: ProviderDeps) {
    let page: Awaited<ReturnType<typeof searchPage>> | undefined
    const guarded = stayAdapter({id: 'xotelo', website: 'https://xotelo.com/', requiredEnv: []}, async (input, context) => {
        page = await searchPage(input, context)
        return page.offers
    })
    const result = await guarded.search(query, deps)
    const continuation = page?.nextOffset != null ? ' Доступна следующая порция.' : ''
    return {...result, status: result.status == 'live' ? 'cached' as const : result.status,
        ...(page ? {total: page.total, nextOffset: page.nextOffset, partial: page.partial} : {}),
        description: result.status == 'live' ? 'Кешированные ориентиры OTA за номер за ночь. Показана страница одной локации с отбором по радиусу; ' +
            'общее число относится к каталогу локации, а покрытие области частичное.' + continuation +
            ' Тип номера, сборы и наличие уточняет продавец.' : result.description}
}
