import locationManifest from './tez-locations.json' with {type: 'json'}
import locationOverrides from './tez-location-overrides.json' with {type: 'json'}
import type {PackageCoordinateSource, PackageHotel} from '../../src/package-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {createProviderBuffer, ProviderRateLimitError, providerRetryAt} from '../provider-buffer.ts'
import type {ProviderBucket} from '../provider-buffer-storage.ts'
import type {ProviderBufferConfig} from '../provider-buffer-config.ts'
import {allowTezSearch, tezSearchRetryAt} from './tez-access.ts'
import {readBoundedProviderText} from '../provider-buffer-body.ts'
import {buildTezSearch} from './tez.ts'
import type {TezRegion} from '../../src/package-regions.ts'
import type {createTezProperties} from './tez-properties.ts'

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
    conditions?: {nights: number, adults: number, children: 0, room: string | null, board: string | null}
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
const manifest = locationManifest as {checkedOn: string, locations: Location[]}
const overrides = locationOverrides as {locations: Location[]}
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
async function hash(value: unknown) {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
}

function conditionName(value: unknown, position: number) {
    const name = Array.isArray(value) ? value[position] : null
    return typeof name == 'string' && name.trim() ? name.trim() : null
}

function buildRequest(input: TezWindow, today: string, hotelId?: string, date?: string, requestedNights?: readonly number[], region?: TezRegion | null) {
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
    const nights = requestedNights ?? [input.nights]
    const validNights = nights.length > 0 && nights.every(value => Number.isInteger(value) && value >= 1 && value <= 30)
    if (!validNights) return null
    if (requestedNights && !hotelId) return null
    const minNights = Math.min(...nights)
    const maxNights = Math.max(...nights)
    const first = date ?? input.first
    const last = date ?? input.last
    const checkOut = new Date(Date.parse(first) + minNights * dayMs).toISOString().slice(0, 10)
    const base = buildTezSearch({destinationId: input.destinationId, adults: input.adults, checkIn: first, checkOut}, today, region)
    if (!base) return null
    const url = new URL(base.url)
    url.searchParams.set('before', last.split('-').reverse().join('.'))
    url.searchParams.set('nightsMin', String(minNights))
    url.searchParams.set('nightsMax', String(maxNights))
    const min = hotelId ? 0 : input.minTotal
    const max = hotelId ? priceLimit : Math.min(input.maxTotal, priceLimit)
    url.searchParams.set('priceMin', String(min / 100))
    url.searchParams.set('priceMax', String(max / 100))
    if (hotelId) {
        url.searchParams.set('hotelId', hotelId.slice(4))
        url.searchParams.delete('groupByHotel') // Return each available fare for the selected property and day.
    }
    url.searchParams.sort()
    return {url: url.href, region: base.region, country: Number(url.searchParams.get('countryId')),
        hotelId, first, last, min, max, minNights, maxNights, input}
}
type Request = NonNullable<ReturnType<typeof buildRequest>>

async function readQuote(row: unknown, request: Request): Promise<TezQuote | null> {
    if (!Array.isArray(row)) return null
    const [start, , , nights, , area, property, board, room, guests, fare, workstation] = row
    if (typeof start != 'string' || !/^\d{2}\.\d{2}\.\d{4}$/.test(start)) return null
    const departure = start.split('.').reverse().join('-')
    if (!validDate(departure) || departure < request.first || departure > request.last) return null
    const actualNights = Number(nights)
    const matchingNights = Number.isInteger(actualNights) && actualNights >= request.minNights && actualNights <= request.maxNights
    if (!matchingNights || area?.[2] != request.region) return null
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
    const id = 'tez-offer:' + await hash([hotelId, departure, actualNights, board, room, row[17], row[22], workstation?.[0]?.[0], total])
    const evidence = [...(geo?.identitySources ?? [])]
    if (geo?.coordinateEvidenceUrl) evidence.push(geo.coordinateEvidenceUrl)
    const coordinateSource = geo ? {url: geo.source, checkedOn: geo.checkedOn ?? manifest.checkedOn,
        precision: geo.precision ?? 'hotel-marker', evidence} satisfies PackageCoordinateSource : undefined
    return {id, hotelId, name: title.trim(), stars: rating ? Number(rating[1]) : null, latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null, coordinateSource, departure, total, url: 'https://www.tez-tour.com/hotel.html?id=' + supplierHotel,
        conditions: {nights: actualNights, adults: request.input.adults, children: 0,
            room: conditionName(room, 1), board: conditionName(board, 0)}}
}

async function decode(payload: unknown, request: Request, checkedAt: string): Promise<TezObservation> {
    if (!payload || typeof payload != 'object') throw new Error('Некорректный ответ TEZ')
    if (!('success' in payload) || payload.success !== true) throw new Error('Поставщик не подтвердил результат запроса')
    if (!('data' in payload) || !Array.isArray(payload.data)) throw new Error('Поставщик не передал список вариантов')
    if (payload.data.length && (!('departureCityId' in payload) || Number(payload.departureCityId) != 3746)) throw new Error('Не совпадает город вылета')
    if ('arrivalCountryId' in payload && Number(payload.arrivalCountryId) != request.country) throw new Error('Не совпадает страна прибытия')
    const offers = new Map<string, TezQuote>()
    const decoded = await Promise.all(payload.data.map(row => readQuote(row, request)))
    for (const quote of decoded) {
        if (quote) offers.set(quote.id, quote)
    }
    const quotes = [...offers.values()].sort((a, b) => a.total - b.total || a.id.localeCompare(b.id))
    const observed = 'info' in payload && Array.isArray(payload.info) ? payload.info : []
    const lastPage = observed.some(item => Array.isArray(item) && item[0] == 'More results' && String(item[1]) == 'false')
    const more = observed.some(item => Array.isArray(item) && item[0] == 'More results' && String(item[1]) == 'true')
    const emptyDay = !payload.data.length && !more
    const complete = Boolean(request.hotelId) && (emptyDay || lastPage && offers.size == payload.data.length)
    return {quotes, byFareId: offers, generation: await hash([request.url, quotes, complete]), complete,
        source: {...source, status: 'live', updatedAt: checkedAt, description}}
}

function missing(message: string, handoff = false): TezObservation {
    const status = handoff ? 'handoff' : 'unavailable'
    return {quotes: [], byFareId: new Map(), generation: 'none', complete: false, source: {...source, status, updatedAt: null, description: message}}
}

export function createTezInventory(deps: {
    fetch: typeof fetch, now: () => Date, resolveRegion?: (id: string, signal?: AbortSignal) => Promise<TezRegion | null>,
    bucket?: ProviderBucket, config?: ProviderBufferConfig, waitUntil?: (work: Promise<unknown>) => void,
    catalog?: Omit<ReturnType<typeof createTezProperties>, 'information'> & {
        information?: ReturnType<typeof createTezProperties>['information']
        known?: (id: string, signal?: AbortSignal) => Promise<PackageHotel[]>
    },
}) {
    function cached(result: TezObservation, message = result.source.description): TezObservation {
        if (!result.source.updatedAt) return result
        return {...result, source: {...result.source, status: 'cached', description: message}}
    }
    const buffer = createProviderBuffer<TezObservation>({
        providerId: 'tez', accountScope: 'public-ee-tallinn-3746-eur-v1', memoryScope: deps.fetch,
        bucket: deps.bucket, config: deps.config, waitUntil: deps.waitUntil, now: () => deps.now().getTime(),
        codec: {
            encode: value => ({...value, byFareId: undefined}),
            decode(value) {
                if (!value || typeof value != 'object') throw new Error('Некорректный снимок TEZ.')
                const observation = value as Omit<TezObservation, 'byFareId'>
                if (!Array.isArray(observation.quotes) || !observation.source || typeof observation.generation != 'string') {
                    throw new Error('Некорректный снимок TEZ.')
                }
                return {...observation, byFareId: new Map(observation.quotes.map(quote => [quote.id, quote]))}
            },
        },
        traits: {
            checkedAt: value => value.source.updatedAt ? Date.parse(value.source.updatedAt) : null,
            negative: value => value.complete && !value.quotes.length,
            cached,
            deferred(value, retryAt) {
                const result = cached(value)
                return {...result, source: {...result.source, retryAt: new Date(retryAt).toISOString()}}
            },
            stale(value, retryAt, message) {
                const result = cached(value, message + ' Показаны ранее проверенные цены.')
                return {...result, source: {...result.source, stale: true, retryAt: new Date(retryAt).toISOString()}}
            },
            missing(retryAt, message, failed = false) {
                const result = missing(message)
                const retry = retryAt ? {retryAt: new Date(retryAt).toISOString()} : {}
                return {...result, source: {...result.source, ...retry, ...(failed ? {failed: true} : {})}}
            },
        },
    })
    async function read(input: TezWindow, hotelId?: string, date?: string, forceFresh = false, signal?: AbortSignal,
        requestedNights?: readonly number[]): Promise<TezObservation> {
        signal?.throwIfAborted()
        const now = deps.now()
        const region = await deps.resolveRegion?.(input.destinationId, signal)
        signal?.throwIfAborted()
        const request = buildRequest(input, now.toISOString().slice(0, 10), hotelId, date, requestedNights, region)
        if (!request) return missing('Публичный поиск TEZ не настроен для этого маршрута, состава или периода.', true)
        const search = request
        async function fetchQuotes(sharedSignal: AbortSignal) {
            if (!deps.bucket && !allowTezSearch(deps.fetch, deps.now().getTime())) {
                throw new ProviderRateLimitError(tezSearchRetryAt(deps.fetch, deps.now().getTime())!)
            }
            const timeout = AbortSignal.any([sharedSignal, AbortSignal.timeout(10_000)])
            const response = await deps.fetch(search.url, {signal: timeout, redirect: 'error'})
            if (response.status == 429) throw new ProviderRateLimitError(providerRetryAt(response.headers.get('retry-after'), deps.now().getTime()))
            if (!response.ok) throw new Error('Поставщик не вернул цены')
            const size = Number(response.headers.get('content-length')) || undefined
            const text = await readBoundedProviderText({size, body: response.body, text: () => response.text()},
                deps.config?.maxSnapshotBytes ?? 2_000_000, timeout)
            return decode(JSON.parse(text), search, deps.now().toISOString())
        }
        // This is a normalized request observation, not a claim that regional minima cover every fare or budget.
        return buffer.source.read({key: request.url, load: fetchQuotes, signal, refresh: forceFresh})
    }
    function range(input: TezWindow, hotelId: string, date: string, nights: readonly number[], signal?: AbortSignal, forceFresh = false) {
        return read(input, hotelId, date, forceFresh, signal, nights)
    }
    // The ranged operation is an optional capability for injected providers that implement day/window only.
    const ranged: {range?: typeof range} = {range}
    const catalog: {catalog?: NonNullable<typeof deps.catalog>} = deps.catalog ? {catalog: deps.catalog} : {}
    return {...catalog, events: buffer.events, health: buffer.health,
        window: (input: TezWindow, signal?: AbortSignal, forceFresh = false) => read(input, undefined, undefined, forceFresh, signal),
        day: (input: TezWindow, hotelId: string, date: string, forceFresh = false, signal?: AbortSignal) =>
            read(input, hotelId, date, forceFresh, signal), ...ranged}
}

type TezInventory = ReturnType<typeof createTezInventory>
export type TezProvider = Omit<TezInventory, 'events' | 'health'> & Partial<Pick<TezInventory, 'events' | 'health'>>
