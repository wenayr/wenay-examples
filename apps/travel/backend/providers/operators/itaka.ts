import {createHash} from 'node:crypto'
import type {ProviderAdapter, ProviderDeps, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {day, list, matchesDestination, normalized, object, page, queryIssue, result, scriptData, text} from './common.ts'

const providerId = 'itaka-packages'
const sourceUrl = 'https://www.itaka.ee/last-minute/'
const departureNames = {
    TLL: ['Tallinn'], RIX: ['Riia', 'Riga'], HEL: ['Helsingi', 'Helsinki'],
} as const satisfies Record<string, readonly string[]>

function offerLinks(html: string) {
    const links = new Map<string, string>()
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
        try {
            const url = new URL(match[1].replaceAll('&amp;', '&'), sourceUrl)
            const id = url.searchParams.get('id')
            if (id && url.origin == new URL(sourceUrl).origin) links.set(decodeURIComponent(id), url.toString())
        } catch { /* Unrelated or incomplete page links do not identify an offer. */ }
    }
    return links
}

function departureMatches(query: ProviderQuery, departure: string) {
    if (!query.origin) return true
    const titles = departureNames[query.origin as keyof typeof departureNames]
    return titles?.some(title => normalized(title) == normalized(departure)) ?? false
}

function departureCode(departure: string) {
    return Object.entries(departureNames).find(([, titles]) => titles.some(title => normalized(title) == normalized(departure)))?.[0]
}

function readRate(raw: unknown, query: ProviderQuery, deps: ProviderDeps, links: Map<string, string>) {
    const rate = object(raw)
    const participants = list(rate.participants).map(object)
    if (participants.length != query.adults || participants.some(person => person.type != 'adult')) return null
    const total = Number(rate.priceWithSurcharges)
    const included = participants.reduce((sum, person) => sum + Number(person.priceWithSurcharges), 0)
    if (!Number.isSafeInteger(total) || total <= 0 || included != total) return null
    if (rate.currency != 'EUR' || !text(rate.id)) return null
    const segments = list(rate.segments).map(object)
    const flights = segments.filter(segment => segment.type == 'flight')
    const stay = segments.find(segment => segment.type == 'hotel')
    if (!stay || flights.length < 2) return null
    const outbound = flights[0]
    const inbound = flights[flights.length - 1]
    const departure = day(outbound.beginDateTime)
    const returnDate = day(inbound.beginDateTime)
    const checkIn = day(stay.beginDate)
    const checkOut = day(stay.endDate)
    if (!departure || !returnDate) return null
    if (!checkIn || !checkOut) return null
    const nights = (Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000
    if (nights < 1 || returnDate < departure) return null
    if (query.nights !== undefined && query.nights != nights) return null
    if (!departureMatches(query, text(object(outbound.departure).title))) return null
    const datesMatch = (!query.departure || query.departure == departure) && (!query.returnDate || query.returnDate == returnDate)
    if (!datesMatch || departure < deps.now().toISOString().slice(0, 10)) return null
    const hotel = object(stay.content)
    const places = list(hotel.geographicalIdentifiers).map(object)
    const names = places.flatMap(place => [text(place.id), text(place.title)])
    names.push(text(object(outbound.destination).title))
    const requested = query.providerRefs?.[providerId]?.destinationId ?? query.destination
    if (!matchesDestination(requested, names)) return null
    const hotelId = text(rate.supplierObjectId)
    const selected = query.providerRefs?.[providerId]?.hotelIds
    if (!hotelId || !text(hotel.title)) return null
    if (selected?.length && !selected.includes(hotelId)) return null
    const promotion = list(rate.promotions).map(object).find(value => value.value == 'LastMinute')
    if (query.kind == 'deals' && !promotion) return null
    const rating = Number(hotel.hotelRating) / 10
    const country = places.find(place => place.type == 'country')
    const geo = object(hotel.geolocation)
    const coordinates = Number.isFinite(geo.lat) && Number.isFinite(geo.lng)
    const bookingUrl = links.get(text(rate.id)) ?? null
    const id = createHash('sha256').update(text(rate.id)).digest('hex').slice(0, 24)
    return {
        id: providerId + ':' + id, providerId, kind: 'packages', title: text(hotel.title),
        price: {amount: total / 100, currency: 'EUR', basis: 'party', type: 'retail'}, accuracy: 'published-from',
        sourceUrl, bookingUrl, checkedAt: deps.now().toISOString(), expiresAt: null,
        origin: departureCode(text(object(outbound.departure).title)), departure, returnDate, checkIn, checkOut, nights, adults: query.adults,
        destination: {name: text(object(outbound.destination).title), country: text(country?.title)},
        hotel: {id: hotelId, name: text(hotel.title), stars: rating > 0 && rating <= 5 ? rating : null,
            ...(coordinates ? {latitude: Number(geo.lat), longitude: Number(geo.lng)} : {})},
        includes: {checkedBags: null, taxes: null, board: text(object(stay.meal).title) || null, refundable: null}, comparisonKey: null,
        conditions: 'Опубликованная стоимость пакета ITAKA за указанный состав. Вылет из ' + text(object(outbound.departure).title)
            + '. Категорию номера, багаж, местные сборы и правила отмены подтвердите у оператора.',
        deal: promotion ? {kind: 'supplier-sale', description: 'Оператор пометил этот конкретный тариф Last Minute. Размер скидки и срок акции не указаны.',
            evidenceUrl: sourceUrl, expiresAt: null} : null,
    } satisfies ProviderOffer
}

export function readItakaOffers(html: string, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(scriptData(html, '__NEXT_DATA__'))
    const pageProps = object(object(root.props).pageProps)
    const variables = object(pageProps.queryVariables)
    const params = object(variables.rateParams)
    if (params.adultsNumber != query.adults || params.currency != 'EUR') throw new Error('Не подтверждён состав или валюта ITAKA.')
    const queries = list(object(pageProps.initialQueryState).queries).map(object)
    const data = queries.map(item => object(object(item.state).data)).find(item => object(item.main).rates)
    const rates = object(object(data?.main).rates)
    if (!Array.isArray(rates.list)) throw new Error('Не получены опубликованные тарифы ITAKA.')
    const links = offerLinks(html)
    const offers = rates.list.map(rate => readRate(rate, query, deps, links))
    return offers.filter(offer => offer !== null).slice(0, query.limit ?? 50)
}

async function search(query: ProviderQuery, deps: ProviderDeps) {
    const issue = queryIssue(query)
    if (issue) return result(providerId, 'unsupported-query', issue, sourceUrl)
    if (query.origin && !Object.hasOwn(departureNames, query.origin)) {
        return result(providerId, 'unsupported-query', 'Эта публичная витрина ITAKA подтверждает вылеты из Таллина, Риги и Хельсинки.', sourceUrl)
    }
    if (query.adults != 2) return result(providerId, 'unsupported-query', 'Опубликованные тарифы витрины рассчитаны на двух взрослых.', sourceUrl)
    try {
        const snapshot = await page(deps, sourceUrl)
        const offers = readItakaOffers(snapshot.html, query, {...deps, now: () => new Date(snapshot.checkedAt)})
        return {providerId, status: snapshot.cached ? 'cached' as const : 'live' as const, offers, checkedAt: snapshot.checkedAt, sourceUrl,
            description: 'Проверена текущая публичная Last Minute витрина ITAKA. Показанные тарифы отобраны по датам и составу, покрытие витрины частичное.'}
    } catch {
        return result(providerId, 'unavailable', 'Не удалось проверить опубликованные тарифы ITAKA. Повторите запрос или откройте сайт оператора.', sourceUrl)
    }
}

export const adapter = {search} satisfies ProviderAdapter
