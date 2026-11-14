import type {FlightDay, FlightQuery} from '../../src/flight-contract.ts'
import {comparePrices} from './benchmark.ts'

export function balticUrl(query: FlightQuery) {
    const params = new URLSearchParams({originCode: query.origin, destinCode: query.destination, originType: 'A', destinType: 'A',
        tripType: query.returnDate ? 'return' : 'oneway', departure: query.departure, return: query.returnDate ?? '',
        numAdt: String(query.adults), numChd: '0', numInf: '0', numYth: '0'})
    return 'https://www.airbaltic.com/en/book-flight?' + params
}

export function readBalticCalendar(html: string, query: FlightQuery, today: string): FlightDay[] {
    // Read only published booking-calendar data, never evaluate page scripts.
    const source = /<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
    if (!source) throw new Error('Календарь не найден')
    const payload: unknown = JSON.parse(source[1])
    if (!Array.isArray(payload)) throw new Error('Календарь изменился')
    const table: unknown[] = payload
    function value(ref: unknown): unknown {
        if (!Number.isInteger(ref)) return undefined
        let v: unknown = table[Number(ref)]
        for (let depth = 0; depth < 4 && Array.isArray(v) && ['Ref', 'Reactive'].includes(v[0]); depth++) v = table[v[1]]
        return v
    }
    function field(node: unknown, key: string) {
        if (typeof node != 'object' || !node || !(key in node)) return undefined
        return value((node as Record<string, unknown>)[key])
    }
    const stores = field(value(0), 'pinia')
    const search = field(stores, 'Fsf')
    const guests = field(field(stores, 'pax'), 'selected')
    if (field(search, 'origin') != query.origin || field(search, 'destin') != query.destination ||
        field(search, 'currentFlightMode') != 'oneway' || field(guests, 'adults') != query.adults) throw new Error('Маршрут не совпал')
    const flights = field(field(stores, 'FsfFlights'), 'outboundFlights')
    if (!Array.isArray(flights)) throw new Error('Календарь недоступен')
    const days = new Map<string, FlightDay>()
    for (const ref of flights) {
        const row = value(ref)
        const departure = field(row, 'date')
        const amount = field(row, 'updatedPrice') ?? field(row, 'price')
        if (typeof departure != 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(departure) || departure < today) continue
        if (Math.abs(Date.parse(departure) - Date.parse(query.departure)) > 3 * 86_400_000) continue
        if (query.returnDate && departure > query.returnDate) continue
        if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) continue
        const perPerson = Math.round(Number(amount) * 100)
        if (perPerson <= 0 || !Number.isSafeInteger(perPerson)) continue
        const direct = field(row, 'isDirect')
        days.set(departure, {departure, perPerson, direct: typeof direct == 'boolean' ? direct : null,
            sourceUrl: balticUrl({...query, departure, returnDate: null}), benchmark: null})
    }
    const calendar = [...days.values()].sort((a, b) => a.departure.localeCompare(b.departure))
    const benchmarks = comparePrices(calendar, d => d.direct === null ? null : String(d.direct), d => d.perPerson)
    return calendar.map(day => ({...day, benchmark: benchmarks.get(day) ?? null}))
}
