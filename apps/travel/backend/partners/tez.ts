import type {SupplyOffer, SupplySource} from '../../src/supply-contract.ts'
import {allowTezSearch} from './tez-access.ts'

const oneDay = 86_400_000
const searchEndpoint = 'https://search.tezapi.eu/tariffsearch/getResult'

const resorts = {
    hurghada: {countryId: '5732', regionId: '5734'},
    sharm: {countryId: '5732', regionId: '5735'},
    rhodes: {countryId: '7067498', regionId: '9003981'},
} as const

interface TourRequest {
    destinationId: string
    checkIn?: string | null
    checkOut?: string | null
    adults: number
}

function addDays(iso: string, count: number) {
    return new Date(Date.parse(iso) + count * oneDay).toISOString().slice(0, 10)
}

function supplierDate(iso: string) {
    return iso.split('-').reverse().join('.')
}

export function buildTezSearch(query: TourRequest, today: string) {
    if (!Object.hasOwn(resorts, query.destinationId) || query.adults != 2) return null
    const resort = resorts[query.destinationId as keyof typeof resorts]
    const first = query.checkIn || addDays(today, 1)
    const last = query.checkIn ? first : addDays(first, 19)
    const nights = query.checkIn && query.checkOut ? (Date.parse(query.checkOut) - Date.parse(query.checkIn)) / oneDay : 7
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) return null
    if (!!query.checkIn != !!query.checkOut || first < today) return null
    const params = new URLSearchParams({
        cityId: '3746', countryId: resort.countryId, tourId: resort.regionId,
        after: supplierDate(first), before: supplierDate(last), nightsMin: String(nights), nightsMax: String(nights),
        currency: '18864', priceMin: '0', priceMax: '1500000', hotelClassId: '269506', hotelClassBetter: 'true',
        rAndBId: '15350', rAndBBetter: 'true', accommodationId: '2', groupByHotel: '2', tourType: '1', locale: 'en',
        xml: 'false', hotelInStop: 'false', noTicketsTo: 'false', noTicketsFrom: 'false',
    })
    return {url: searchEndpoint + '?' + params, first, last, nights, region: Number(resort.regionId)}
}

function formatSupplierOffer(row: unknown, search: NonNullable<ReturnType<typeof buildTezSearch>>, checkedAt: string) {
    if (!Array.isArray(row)) return null
    const [start, , , nights, , resort, property, meal, , guests, fare] = row
    if (typeof start != 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(start)) return null
    const iso = start.split('.').reverse().join('-')
    const expectedRoute = iso >= search.first && iso <= search.last && resort?.[2] == search.region && nights == search.nights
    if (!expectedRoute || guests?.[0]?.join(',') != '2,0,0') return null
    const hotel = property?.[1]
    const hotelId = property?.[3]
    const total = Math.round(Number(fare?.total) * 100)
    const validPrice = fare?.currency == 'EUR' && Number.isSafeInteger(total) && total > 0
    if (!validPrice || typeof hotel != 'string' || !Number.isSafeInteger(hotelId)) return null
    // The supplier's bookingUrl is an agency order workstation. The guest may inspect the public hotel instead.
    const url = new URL('https://www.tez-tour.com/hotel.html')
    url.searchParams.set('id', String(hotelId))
    return {
        id: 'tez:' + hotelId + ':' + iso + ':' + nights, label: hotel + ' · ' + start + ' · ' + nights + ' ноч. · ' + String(meal?.[0] ?? ''),
        price: {total, currency: 'EUR'}, url: url.href, providerId: 'tez', scope: 'package', checkedAt,
    } satisfies SupplyOffer
}

export function readTezResults(payload: unknown, search: NonNullable<ReturnType<typeof buildTezSearch>>, checkedAt: string): SupplyOffer[] {
    if (!payload || typeof payload != 'object' || !('data' in payload)) throw new Error('Нет результатов TEZ')
    const valid = 'success' in payload && payload.success === true && Array.isArray(payload.data)
    if (!valid) throw new Error('Некорректный ответ TEZ')
    if ((payload.data as unknown[]).length == 0) return []
    if (!('departureCityId' in payload) || Number(payload.departureCityId) != 3746) throw new Error('Не совпадает город вылета')
    const offers = new Map<string, SupplyOffer>()
    for (const row of payload.data as unknown[]) {
        const offer = formatSupplierOffer(row, search, checkedAt)
        if (!offer) continue
        const previous = offers.get(offer.id)
        if (!previous || offer.price.total < previous.price.total) offers.set(offer.id, offer)
    }
    return [...offers.values()].sort((a, b) => a.price.total - b.price.total || a.label.localeCompare(b.label))
}

interface SearchResult {offers: SupplyOffer[], source: SupplySource}

export function createTezProvider(deps: {fetch: typeof fetch, now: () => Date}) {
    const cache = new Map<string, {expires: number, result: SearchResult}>()
    const pending = new Map<string, Promise<SearchResult>>()
    const status = {id: 'tez', name: 'TEZ TOUR Eesti'}
    function empty(description: string, state: 'handoff' | 'unavailable' = 'unavailable'): SearchResult {
        return {offers: [], source: {...status, status: state, updatedAt: null, description}}
    }
    async function fetchSearch(search: NonNullable<ReturnType<typeof buildTezSearch>>): Promise<SearchResult> {
        try {
            const response = await deps.fetch(search.url, {signal: AbortSignal.timeout(12000), redirect: 'error'})
            if (!response.ok) throw new Error('Ошибка поиска TEZ')
            const checkedAt = deps.now().toISOString()
            const offers = readTezResults(await response.json(), search, checkedAt)
            const description = 'Пакет из Таллина за двоих, ' + search.nights + ' ноч. Вылеты ' + search.first + ' — ' + search.last
                + '. На карточке оператора повторите поиск по датам.'
            return {offers, source: {...status, status: 'live', updatedAt: checkedAt, description}}
        } catch {
            return empty('Поставщик сейчас не подтвердил цены. Повторите поиск позже.')
        }
    }
    async function search(query: TourRequest): Promise<SearchResult> {
        const now = deps.now()
        const request = buildTezSearch(query, now.toISOString().slice(0, 10))
        if (!request) return empty('Для этого состава, курорта или периода публичный поиск не настроен.', 'handoff')
        const existing = cache.get(request.url)
        if (existing && existing.expires > now.getTime()) {
            const {offers, source} = existing.result
            return {offers, source: {...source, status: source.status == 'live' ? 'cached' : source.status}}
        }
        const inflight = pending.get(request.url)
        if (inflight) return inflight
        if (!allowTezSearch(deps.fetch, now.getTime())) return empty('Достигнут лимит запросов к поставщику. Повторите через минуту.')
        const work = fetchSearch(request)
        pending.set(request.url, work)
        try {
            const result = await work
            const ttl = result.source.status == 'live' ? 120000 : 10000
            if (cache.size >= 150) cache.delete(cache.keys().next().value!)
            cache.set(request.url, {result, expires: deps.now().getTime() + ttl})
            return result
        } finally {
            pending.delete(request.url)
        }
    }
    return {search}
}
