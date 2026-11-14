import {createAsyncQueue} from 'wenay-common2'
import {packageWindowDays} from '../src/package-contract.ts'
import {packageTrendHotelLimit, type PackageHotelTrend, type PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplySource} from '../src/supply-contract.ts'
import type {createTezInventory} from './partners/tez-inventory.ts'

type Provider = ReturnType<typeof createTezInventory>
type Trip = Parameters<Provider['window']>[0]
type Observation = Awaited<ReturnType<Provider['window']>>
interface DayMinima {
    departure: string
    totals: Map<string, number>
    source: SupplySource
    successful: boolean
}
interface TripEntry {
    users: Set<symbol>
    work: Promise<DayMinima[]>
    until: number
    skipped: boolean
}

const oneDay = 86_400_000
const defaultSource = {id: 'tez', name: 'TEZ TOUR Eesti', url: 'https://www.teztour.ee/page/xml-gate.et.html'}

function datesFrom(trip: Trip) {
    const first = Date.parse(trip.first)
    const last = Date.parse(trip.last)
    if (!Number.isFinite(first) || !Number.isFinite(last)) throw new RangeError('Выберите даты вылета.')
    const validFirst = new Date(first).toISOString().slice(0, 10) == trip.first
    const validLast = new Date(last).toISOString().slice(0, 10) == trip.last
    if (!validFirst || !validLast) throw new RangeError('Выберите действительные даты вылета.')
    const span = (last - first) / oneDay
    if (!Number.isInteger(span) || span < 0 || span >= packageWindowDays) throw new RangeError('Период вылета превышает окно поставщика.')
    const validBudget = Number.isSafeInteger(trip.minTotal) && Number.isSafeInteger(trip.maxTotal)
    if (!validBudget || trip.minTotal < 0 || trip.maxTotal < trip.minTotal) throw new RangeError('Проверьте границы бюджета.')
    return Array.from({length: span + 1}, (_, index) => new Date(first + index * oneDay).toISOString().slice(0, 10))
}

function unknownDay(departure: string): DayMinima {
    return {departure, totals: new Map(), successful: false,
        source: {...defaultSource, status: 'unavailable', updatedAt: null, description: 'Поставщик не подтвердил дневные цены.'}}
}

function prepareDay(departure: string, trip: Trip, observation: Observation): DayMinima {
    const successful = observation.source.status == 'live' || observation.source.status == 'cached'
    const totals = new Map<string, number>()
    if (successful) {
        for (const quote of observation.quotes) {
            const validTotal = Number.isSafeInteger(quote.total) && quote.total >= trip.minTotal && quote.total <= trip.maxTotal
            if (quote.departure != departure || !validTotal || quote.total <= 0) continue
            const previous = totals.get(quote.hotelId)
            if (previous == null || quote.total < previous) totals.set(quote.hotelId, quote.total)
        }
    }
    return {departure, totals, successful, source: observation.source}
}

function describeDays(days: DayMinima[]): SupplySource {
    const checked = days.filter(day => day.successful)
    if (!checked.length) return {...defaultSource, status: 'unavailable', updatedAt: null, description: 'Дневные цены пока не подтверждены.'}
    const timestamps = checked.map(day => day.source.updatedAt).filter((time): time is string => Boolean(time)).sort()
    const description = 'Дневные минимумы регионального ответа в текущем бюджете. Подтверждено дат ' + checked.length + ' из ' + days.length
        + '. Отсутствие отеля в ответе дня не подтверждает отсутствие туров.'
    return {...checked[0].source, status: checked.some(day => day.source.status == 'live') ? 'live' : 'cached',
        updatedAt: timestamps[0] ?? null, description}
}

function hotelTrend(hotelId: string, days: DayMinima[]): PackageHotelTrend {
    const points = days.map(day => {
        const total = day.totals.get(hotelId) ?? null
        let status: PackageHotelTrend['days'][number]['status'] = 'unknown'
        if (day.successful) status = total == null ? 'not-returned' : 'quoted'
        return {departure: day.departure, total, status, checkedAt: day.successful ? day.source.updatedAt : null}
    })
    const amounts = points.flatMap(point => point.total == null ? [] : [point.total])
    const minTotal = amounts.length ? Math.min(...amounts) : null
    const maxTotal = amounts.length ? Math.max(...amounts) : null
    return {hotelId, days: points, minTotal, maxTotal}
}

export function createPackageTrends(deps: {provider: Provider, now?: () => Date}) {
    const now = deps.now ?? (() => new Date())
    const queue = createAsyncQueue(3)
    const trips = new Map<string, TripEntry>()

    function begin(trip: Trip, dates: string[], token: symbol) {
        const entry: TripEntry = {users: new Set([token]), until: Number.POSITIVE_INFINITY, skipped: false, work: Promise.resolve([])}
        async function loadDate(departure: string) {
            if (!entry.users.size) {
                entry.skipped = true
                return unknownDay(departure)
            }
            try {
                const observation = await deps.provider.window({...trip, first: departure, last: departure})
                return prepareDay(departure, trip, observation)
            } catch {
                return unknownDay(departure)
            }
        }
        async function loadTrip() {
            const days = await Promise.all(dates.map(departure => queue.add(() => loadDate(departure))))
            const ttl = days.some(day => !day.successful) ? 10_000 : 120_000
            const observed = days.map(day => Date.parse(day.source.updatedAt ?? '')).filter(Number.isFinite)
            const freshUntil = observed.length ? Math.min(...observed) + 120_000 : now().getTime() + ttl
            entry.until = Math.min(now().getTime() + ttl, freshUntil)
            if (entry.skipped) entry.until = 0
            return days
        }
        entry.work = loadTrip()
        return entry
    }

    async function read(trip: Trip, hotelIds: readonly string[], signal?: AbortSignal): Promise<PackageTrends> {
        signal?.throwIfAborted()
        const dates = datesFrom(trip)
        if (hotelIds.length > packageTrendHotelLimit || !hotelIds.every(id => /^tez:[1-9]\d{0,14}$/.test(id))) {
            throw new RangeError('Выберите до ' + packageTrendHotelLimit + ' отелей TEZ.')
        }
        const ids = [...new Set(hotelIds)]
        const base = {coverage: 'regional-daily-minima', first: trip.first, last: trip.last, nights: trip.nights, adults: trip.adults, currency: 'EUR'} as const
        if (!ids.length) return {...base, items: [], source: describeDays([])}
        const key = JSON.stringify([trip.destinationId, trip.first, trip.last, trip.nights, trip.adults, trip.minTotal, trip.maxTotal])
        const token = Symbol('package-trend-reader')
        let entry = trips.get(key)
        const preparedHit = Boolean(entry && Number.isFinite(entry.until) && entry.until > now().getTime())
        if (!entry || entry.until <= now().getTime()) {
            if (!entry && trips.size >= 32) trips.delete(trips.keys().next().value!)
            entry = begin(trip, dates, token)
            trips.set(key, entry)
        } else entry.users.add(token)
        const active = entry
        let rejectAbort: (reason: unknown) => void = () => {}
        const cancelled = new Promise<never>((_, reject) => {rejectAbort = reject})
        function aborted() {
            active.users.delete(token)
            rejectAbort(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', aborted, {once: true})
        try {
            const days = await (signal ? Promise.race([active.work, cancelled]) : active.work)
            signal?.throwIfAborted()
            const source = describeDays(days)
            if (preparedHit && source.status == 'live') source.status = 'cached'
            return {...base, source, items: ids.map(hotelId => hotelTrend(hotelId, days))} satisfies PackageTrends
        } finally {
            active.users.delete(token)
            signal?.removeEventListener('abort', aborted)
        }
    }
    return {read}
}
