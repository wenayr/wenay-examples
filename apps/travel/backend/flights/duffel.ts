import type {FlightOffer, FlightQuery, FlightSlice} from '../../src/flight-contract.ts'
import {comparePrices} from './benchmark.ts'

type RecordValue = Record<string, unknown>
function record(value: unknown): RecordValue {
    return typeof value == 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {}
}
function list(value: unknown): RecordValue[] { return Array.isArray(value) ? value.map(record) : [] }
function text(value: unknown) { return typeof value == 'string' ? value : '' }

export function duffelRequest(query: FlightQuery) {
    const slices = [{origin: query.origin, destination: query.destination, departure_date: query.departure}]
    if (query.returnDate) slices.push({origin: query.destination, destination: query.origin, departure_date: query.returnDate})
    return {data: {slices, cabin_class: 'economy', passengers: Array.from({length: query.adults}, () => ({type: 'adult'}))}}
}

function readOffer(raw: RecordValue, query: FlightQuery, now: Date) {
    const amount = text(raw.total_amount)
    const expiresAt = text(raw.expires_at)
    const id = text(raw.id)
    const total = Math.round(Number(amount) * 100)
    if (!id || raw.total_currency != 'EUR' || !/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(total) || total <= 0) return null
    if (!(Date.parse(expiresAt) > now.getTime()) || raw.live_mode === false) return null
    const expectations = duffelRequest(query).data.slices
    const rawSlices = list(raw.slices)
    if (rawSlices.length != expectations.length || list(raw.passengers).length != query.adults) return null
    const checked: (number | null)[] = []
    const slices: FlightSlice[] = []
    const signatures: string[] = []
    let comparable = true
    for (const [i, slice] of rawSlices.entries()) {
        const segments = list(slice.segments)
        const first = segments[0], last = segments.at(-1)
        if (!first || !last) return null
        const origin = text(record(first.origin).iata_code), destination = text(record(last.destination).iata_code)
        const departingAt = text(first.departing_at), arrivingAt = text(last.arriving_at)
        if (origin != expectations[i].origin || destination != expectations[i].destination ||
            departingAt.slice(0, 10) != expectations[i].departure_date || !arrivingAt) return null
        let stops = segments.length - 1
        for (const segment of segments) {
            stops += list(segment.stops).length
            const travelers = list(segment.passengers)
            if (travelers.length != query.adults) return null
            for (const traveler of travelers) {
                if (traveler.cabin_class !== 'economy') return null
                const baggage = Array.isArray(traveler.baggages) ? list(traveler.baggages) : null
                const allowed = baggage?.find(b => b.type == 'checked')
                const count = allowed ? allowed.quantity : baggage ? 0 : null
                checked.push(typeof count == 'number' && Number.isInteger(count) && count >= 0 ? count : null)
                const fareBasis = text(traveler.fare_basis_code)
                if (!fareBasis || !baggage) comparable = false
                signatures.push(JSON.stringify([fareBasis, baggage?.map(b => [b.type, b.quantity]).sort()]))
            }
            const number = text(segment.marketing_carrier_flight_number)
            const airline = text(record(segment.marketing_carrier).iata_code)
            if (!number || !airline) comparable = false
            signatures.push(JSON.stringify([airline, number, segment.departing_at, segment.arriving_at, record(segment.destination).iata_code]))
        }
        slices.push({origin, destination, departingAt, arrivingAt, stops})
    }
    const checkedBags = checked.some(c => c === null) ? null : Math.min(...checked as number[])
    if (query.checkedBag && (checkedBags ?? 0) < 1) return null
    const conditions = record(raw.conditions)
    if (!conditions.refund_before_departure || !conditions.change_before_departure) comparable = false
    signatures.push(JSON.stringify([conditions.refund_before_departure, conditions.change_before_departure]))
    const carrier = text(record(raw.owner).name)
    if (!carrier) return null
    const offer: FlightOffer = {id, carrier, slices, total, checkedBags, expiresAt, currency: 'EUR', benchmark: null}
    return {offer, group: comparable ? JSON.stringify(signatures) : null}
}

export function readDuffelOffers(payload: unknown, query: FlightQuery, now: Date) {
    const data = record(record(payload).data)
    if (data.live_mode !== true || !Array.isArray(data.offers)) throw new Error('Нет действующего ответа Duffel')
    const byId = new Map<string, NonNullable<ReturnType<typeof readOffer>>>()
    for (const raw of list(data.offers)) {
        const result = readOffer(raw, query, now)
        if (result) byId.set(result.offer.id, result)
    }
    const unique = [...byId.values()]
    const benchmarks = comparePrices(unique, v => v.group, v => v.offer.total)
    return unique.sort((a, b) => a.offer.total - b.offer.total || a.offer.id.localeCompare(b.offer.id))
        .slice(0, 30).map(v => ({...v.offer, benchmark: benchmarks.get(v) ?? null}))
}
