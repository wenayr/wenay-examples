import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {createAsyncQueue} from 'wenay-common2'
import type {PackageCoordinateSource} from '../../src/package-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {allowTezSearch} from './tez-access.ts'
import {buildTezSearch} from './tez.ts'

export interface TezWindow {
    destinationId: string
    first: string
    last: string
    nights: number
    adults: number
    minTotal: number
    maxTotal: number
}
export interface TezQuote {
    id: string
    hotelId: string
    name: string
    stars: number | null
    latitude: number | null
    longitude: number | null
    departure: string
    total: number
    url: string
    coordinateSource?: PackageCoordinateSource
}
export interface TezObservation {
    quotes: readonly TezQuote[]
    byFareId: ReadonlyMap<string, TezQuote>
    source: SupplySource
    generation: string
    complete: boolean
}

interface Location {
    destination: string
    id: number
    latitude: number
    longitude: number
    source: string
    checkedOn?: string
    precision?: PackageCoordinateSource['precision']
    identitySources?: string[]
    coordinateEvidenceUrl?: string
}
const manifest = JSON.parse(readFileSync(new URL('./tez-locations.json', import.meta.url), 'utf8')) as {checkedOn: string, locations: Location[]}
const overrides = JSON.parse(readFileSync(new URL('./tez-location-overrides.json', import.meta.url), 'utf8')) as {locations: Location[]}
// Curated identity checks survive a later supplier page refresh, including a known inaccurate supplier marker.
const locations = new Map([...manifest.locations, ...overrides.locations].map(p => [p.destination + ':' + p.id, p]))
const dayMs = 86_400_000
const priceLimit = 150_000_000 // Same EUR ceiling as the existing TEZ package search, in cents.
const source = {id: 'tez', name: 'TEZ TOUR Eesti', url: 'https://www.teztour.ee/page/xml-gate.et.html'}
const description = 'Пакет из Таллина за двоих с перелётом, трансфером и проживанием. Стоимость уточняется при бронировании.'

function validDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const time = Date.parse(value)
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) == value
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24) }

function buildRequest(input: TezWindow, today: string, hotelId?: string, date?: string) {
    const ordered = input.first <= input.last && input.first >= today
    if (!validDate(input.first) || !validDate(input.last) || !ordered) return null
    const span = (Date.parse(input.last) - Date.parse(input.first)) / dayMs
    const stay = Number.isInteger(input.nights) && input.nights >= 1 && input.nights <= 30
    if (span >= 20 || !stay) return null
    const cents = Number.isSafeInteger(input.minTotal) && Number.isSafeInteger(input.maxTotal)
    if (!cents || input.minTotal < 0 || input.maxTotal < input.minTotal) return null
    if (hotelId !== undefined) {
        if (!/^tez:[1-9]\d*$/.test(hotelId) || !date || !validDate(date)) return null
        if (date < input.first || date > input.last) return null
    }
    const first = date ?? input.first
    const last = date ?? input.last
    const checkOut = new Date(Date.parse(first) + input.nights * dayMs).toISOString().slice(0, 10)
    const base = buildTezSearch({destinationId: input.destinationId, adults: input.adults, checkIn: first, checkOut}, today)
    if (!base) return null
    const url = new URL(base.url)
    url.searchParams.set('before', last.split('-').reverse().join('.'))
    const min = hotelId ? 0 : input.minTotal
    const max = hotelId ? priceLimit : Math.min(input.maxTotal, priceLimit)
    url.searchParams.set('priceMin', String(min / 100))
    url.searchParams.set('priceMax', String(max / 100))
    if (hotelId) {
        url.searchParams.set('hotelId', hotelId.slice(4))
        url.searchParams.delete('groupByHotel') // Return each available fare for the selected property and day.
    }
    return {url: url.href, region: base.region, country: Number(url.searchParams.get('countryId')), hotelId, first, last, min, max, input}
}
type Request = NonNullable<ReturnType<typeof buildRequest>>

function readQuote(row: unknown, request: Request): TezQuote | null {
    if (!Array.isArray(row)) return null
    const [start, , , nights, , area, property, board, room, guests, fare, workstation] = row
    if (typeof start != 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(start)) return null
    const departure = start.split('.').reverse().join('-')
    if (!validDate(departure) || departure < request.first || departure > request.last) return null
    if (nights != request.input.nights || area?.[2] != request.region) return null
    const pair = Array.isArray(guests) && guests.length == 1 && Array.isArray(guests[0])
    if (!pair || guests[0].join(',') != '2,0,0') return null
    const supplierHotel = property?.[3]
    const title = property?.[1]
    if (!Number.isSafeInteger(supplierHotel) || supplierHotel <= 0) return null
    if (typeof title != 'string' || !title.trim()) return null
    const hotelId = 'tez:' + supplierHotel
    if (request.hotelId && request.hotelId != hotelId) return null
    const amount = String(fare?.total ?? '')
    if (fare?.currency != 'EUR' || !/^\d+(\.\d{1,2})?$/.test(amount)) return null
    const total = Math.round(Number(amount) * 100)
    if (!Number.isSafeInteger(total) || total <= 0) return null
    if (total < request.min || total > request.max) return null
    const rating = /\s([1-5])\s*\*\s*$/.exec(title)
    const geo = locations.get(request.input.destinationId + ':' + supplierHotel)
    // The agency-only URL distinguishes supplier reservations. Hash it server-side and expose only the public hotel page.
    const id = 'tez-offer:' + hash([hotelId, departure, nights, board, room, row[17], row[22], workstation?.[0]?.[0], total])
    const evidence = [...(geo?.identitySources ?? [])]
    if (geo?.coordinateEvidenceUrl) evidence.push(geo.coordinateEvidenceUrl)
    const coordinateSource = geo ? {url: geo.source, checkedOn: geo.checkedOn ?? manifest.checkedOn,
        precision: geo.precision ?? 'hotel-marker', evidence} satisfies PackageCoordinateSource : undefined
    return {id, hotelId, name: title.trim(), stars: rating ? Number(rating[1]) : null, latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null, coordinateSource, departure, total, url: 'https://www.tez-tour.com/hotel.html?id=' + supplierHotel}
}

function decode(payload: unknown, request: Request, checkedAt: string): TezObservation {
    if (!payload || typeof payload != 'object') throw new Error('Некорректный ответ TEZ')
    if (!('success' in payload) || payload.success !== true) throw new Error('Поставщик не подтвердил результат запроса')
    if (!('data' in payload) || !Array.isArray(payload.data)) throw new Error('Поставщик не передал список вариантов')
    if (payload.data.length && (!('departureCityId' in payload) || Number(payload.departureCityId) != 3746)) throw new Error('Не совпадает город вылета')
    if ('arrivalCountryId' in payload && Number(payload.arrivalCountryId) != request.country) throw new Error('Не совпадает страна прибытия')
    const offers = new Map<string, TezQuote>()
    for (const row of payload.data) {
        const quote = readQuote(row, request)
        if (quote) offers.set(quote.id, quote)
    }
    const quotes = [...offers.values()].sort((a, b) => a.total - b.total || a.id.localeCompare(b.id))
    const observed = 'info' in payload && Array.isArray(payload.info) ? payload.info : []
    const lastPage = observed.some(item => Array.isArray(item) && item[0] == 'More results' && String(item[1]) == 'false')
    const more = observed.some(item => Array.isArray(item) && item[0] == 'More results' && String(item[1]) == 'true')
    const emptyDay = !payload.data.length && !more
    const complete = Boolean(request.hotelId) && (emptyDay || lastPage && offers.size == payload.data.length)
    return {quotes, byFareId: offers, generation: hash([request.url, quotes, complete]), complete,
        source: {...source, status: 'live', updatedAt: checkedAt, description}}
}

function missing(message: string, handoff = false): TezObservation {
    const status = handoff ? 'handoff' : 'unavailable'
    return {quotes: [], byFareId: new Map(), generation: 'none', complete: false, source: {...source, status, updatedAt: null, description: message}}
}

export function createTezInventory(deps: {fetch: typeof fetch, now: () => Date}) {
    const cache = new Map<string, {result: TezObservation, until: number}>()
    const queue = createAsyncQueue(6)
    const inflight = new Map<string, {
        work: Promise<TezObservation>
        users: Set<symbol>
        controller: AbortController
        signal: AbortSignal
    }>()
    type Pending = NonNullable<ReturnType<typeof inflight.get>>
    function remember(key: string, result: TezObservation, ttl: number) {
        if (!cache.has(key) && cache.size >= 360) cache.delete(cache.keys().next().value!)
        cache.set(key, {result, until: deps.now().getTime() + ttl})
        return result
    }
    function cached(result: TezObservation, message = result.source.description): TezObservation {
        if (!result.source.updatedAt) return result
        return {...result, source: {...result.source, status: 'cached', description: message}}
    }
    async function observe(pending: Pending, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const token = Symbol('supplier-reader')
        pending.users.add(token)
        let rejectAbort: (reason: unknown) => void = () => {}
        const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
        function aborted() {
            pending.users.delete(token)
            if (!pending.users.size) pending.controller.abort(signal?.reason)
            rejectAbort(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', aborted, {once: true})
        try {
            return await (signal ? Promise.race([pending.work, cancelled]) : pending.work)
        } finally {
            pending.users.delete(token)
            signal?.removeEventListener('abort', aborted)
        }
    }
    async function read(input: TezWindow, hotelId?: string, date?: string, forceFresh = false, signal?: AbortSignal): Promise<TezObservation> {
        signal?.throwIfAborted()
        const now = deps.now()
        const request = buildRequest(input, now.toISOString().slice(0, 10), hotelId, date)
        if (!request) return missing('Публичный поиск TEZ не настроен для этого маршрута, состава или периода.', true)
        const search = request
        const prior = cache.get(request.url)
        if (!forceFresh && prior && prior.until > now.getTime()) return cached(prior.result)
        const waiting = inflight.get(request.url)
        if (waiting && !waiting.signal.aborted) return observe(waiting, signal)
        function failed(message: string) {
            const lastTime = Date.parse(prior?.result.source.updatedAt ?? '')
            if (prior && now.getTime() - lastTime <= 15 * 60_000) return cached(prior.result, message + ' Показаны ранее проверенные цены.')
            return missing(message)
        }
        const controller = new AbortController()
        const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)])
        const pending: Pending = {controller, signal: deadline, users: new Set(), work: Promise.resolve(missing('Проверяем тарифы TEZ.'))}
        async function fetchQuotes() {
            try {
                deadline.throwIfAborted()
                if (!allowTezSearch(deps.fetch, deps.now().getTime())) {
                    return remember(search.url, failed('Лимит частоты запросов TEZ. Повторите позже.'), 10_000)
                }
                const timeout = AbortSignal.any([deadline, AbortSignal.timeout(10_000)])
                const response = await deps.fetch(search.url, {signal: timeout, redirect: 'error'})
                if (!response.ok) throw new Error('Поставщик не вернул цены')
                return remember(search.url, decode(await response.json(), search, deps.now().toISOString()), 120_000)
            } catch {
                if (controller.signal.aborted) throw controller.signal.reason
                return remember(search.url, failed('Нет свежего ответа TEZ.'), 10_000)
            } finally {
                if (inflight.get(search.url) == pending) inflight.delete(search.url)
            }
        }
        inflight.set(request.url, pending)
        pending.work = queue.add(fetchQuotes)
        return observe(pending, signal)
    }
    return {window: (input: TezWindow, signal?: AbortSignal) => read(input, undefined, undefined, false, signal),
        day: (input: TezWindow, hotelId: string, date: string, forceFresh = false, signal?: AbortSignal) =>
            read(input, hotelId, date, forceFresh, signal)}
}
