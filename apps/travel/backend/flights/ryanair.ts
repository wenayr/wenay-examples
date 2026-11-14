import type {FlightDay, FlightQuery} from '../../src/flight-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {comparePrices} from './benchmark.ts'

const provider = {id: 'ryanair', name: 'Ryanair', url: 'https://www.ryanair.com/ie/en/fare-finder'}
const dayMs = 86_400_000

export function ryanairUrl(query: FlightQuery) {
    const params = new URLSearchParams({adults: String(query.adults), teens: '0', children: '0', infants: '0',
        originIata: query.origin, destinationIata: query.destination, dateOut: query.departure,
        dateIn: query.returnDate ?? '', isReturn: String(!!query.returnDate), currency: 'EUR'})
    return 'https://www.ryanair.com/ie/en/trip/flights/select?' + params
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value == 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function readRyanairCalendar(payload: unknown, query: FlightQuery, today: string): FlightDay[] {
    const outbound = record(record(payload)?.outbound)
    if (!Array.isArray(outbound?.fares)) throw new Error('Календарь Ryanair изменился')
    const departureTime = Date.parse(query.departure)
    const days = new Map<string, FlightDay>()
    for (const item of outbound.fares) {
        const row = record(item)
        if (!row || row.soldOut !== false || row.unavailable !== false) continue
        const departure = row.day
        if (typeof departure != 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(departure) || departure < today) continue
        const time = Date.parse(departure)
        if (!Number.isFinite(time)) continue
        if (new Date(time).toISOString().slice(0, 10) != departure || Math.abs(time - departureTime) > 3 * dayMs) continue
        if (query.returnDate && departure > query.returnDate) continue
        const price = record(row.price)
        if (price?.currencyCode != 'EUR' || typeof price.value != 'number' || !Number.isFinite(price.value)) continue
        const perPerson = Math.round(price.value * 100)
        if (perPerson <= 0 || !Number.isSafeInteger(perPerson)) continue
        // Fare Finder is a one-adult minimum. It does not confirm seats for a party of several adults.
        const sourceUrl = ryanairUrl({...query, adults: 1, departure, returnDate: null})
        const previous = days.get(departure)
        if (!previous || perPerson < previous.perPerson) days.set(departure, {departure, perPerson, direct: true, sourceUrl, benchmark: null})
    }
    const rows = [...days.values()].sort((a, b) => a.departure.localeCompare(b.departure))
    const benchmarks = comparePrices(rows, () => 'direct', day => day.perPerson)
    return rows.map(day => ({...day, benchmark: benchmarks.get(day) ?? null}))
}

export async function ryanairCalendar(deps: {fetch: typeof fetch, now: () => Date}, query: FlightQuery) {
    const url = ryanairUrl(query)
    if (query.checkedBag) return {rows: [] as FlightDay[], source: {...provider, url, status: 'handoff', updatedAt: null,
        description: 'Календарь базовых тарифов не подтверждает зарегистрированный багаж. Выберите его у Ryanair.'} satisfies SupplySource}
    const today = deps.now().toISOString().slice(0, 10)
    const months = new Set([-3, 3].map(offset => new Date(Date.parse(query.departure) + offset * dayMs).toISOString().slice(0, 7)))
    try {
        async function monthFares(month: string) {
            const params = new URLSearchParams({outboundMonthOfDate: month + '-01', currency: 'EUR'})
            const endpoint = 'https://www.ryanair.com/api/farfnd/v4/oneWayFares/' + query.origin + '/' + query.destination + '/cheapestPerDay?'
            const response = await deps.fetch(endpoint + params, {signal: AbortSignal.timeout(10_000), redirect: 'error'})
            if (!response.ok) throw new Error('Календарь Ryanair недоступен')
            return readRyanairCalendar(await response.json(), query, today)
        }
        const monthly = await Promise.all([...months].map(monthFares))
        const rows = monthly.flat().sort((a, b) => a.departure.localeCompare(b.departure))
        const benchmarks = comparePrices(rows, () => 'direct', day => day.perPerson)
        return {rows: rows.map(day => ({...day, benchmark: benchmarks.get(day) ?? null})),
            source: {...provider, url, status: 'live', updatedAt: deps.now().toISOString(),
                description: rows.length ? 'Минимумы Fare Finder в EUR за одного взрослого в одну сторону, без зарегистрированного багажа. Цену группы проверяет Ryanair.' :
                    'В опубликованном календаре Ryanair нет доступных цен рядом с выбранной датой.'} satisfies SupplySource}
    } catch {
        return {rows: [] as FlightDay[], source: {...provider, url, status: 'unavailable', updatedAt: null,
            description: 'Ryanair не подтвердил цены этого маршрута. Доступен поиск с выбранными аэропортами, датами и пассажирами.'} satisfies SupplySource}
    }
}
