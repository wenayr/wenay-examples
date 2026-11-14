import {localStorageCache} from 'wenay-react2/persist'
import type {FlightQuery} from '../../src/flight-contract.ts'
import {shiftDate, validDate} from '../directory-preferences.ts'
import {travelHash} from '../navigation.ts'

const key = 'wenay.travel.flights.v1'
const today = () => new Date().toISOString().slice(0, 10)

export function defaultFlight(): FlightQuery {
    return {origin: '', destination: '', departure: shiftDate(today(), 30), returnDate: null, adults: 1, checkedBag: false}
}

export function flightError(query: FlightQuery) {
    if (![query.origin, query.destination].every(code => /^[A-Z]{3}$/.test(code))) {
        return 'Выберите оба аэропорта из списка или введите их трёхбуквенные коды IATA.'
    }
    if (query.origin === query.destination) return 'Для вылета и прилёта выберите разные аэропорты.'
    if (!validDate(query.departure) || query.departure < today()) return 'Выберите сегодняшнюю или будущую дату вылета.'
    if (query.returnDate !== null && (!validDate(query.returnDate) || query.returnDate < query.departure)) {
        return 'Обратный вылет должен быть в день отправления или позже.'
    }
    if (!Number.isInteger(query.adults) || query.adults < 1 || query.adults > 9) return 'Выберите от одного до девяти взрослых.'
    return ''
}

export function flightParams(query: FlightQuery) {
    return {...query, returnDate: query.returnDate ?? '', checkedBag: String(query.checkedBag)}
}

export function flightLink(query: FlightQuery) {
    return travelHash('flights', undefined, flightParams(query))
}

export function flightForRoute(base: FlightQuery, params: URLSearchParams) {
    const explicit = ['origin', 'destination', 'departure', 'returnDate', 'adults', 'checkedBag'].some(field => params.has(field))
    const origin = params.get('origin') ?? (explicit ? '' : base.origin)
    const destination = params.get('destination') ?? (explicit ? '' : base.destination)
    return {
        origin: origin.trim().toUpperCase(), destination: destination.trim().toUpperCase(),
        departure: params.get('departure') ?? base.departure, returnDate: params.get('returnDate') || (params.has('departure') ? null : base.returnDate),
        adults: params.has('adults') ? Number(params.get('adults')) : base.adults,
        checkedBag: params.has('checkedBag') ? params.get('checkedBag') === 'true' : base.checkedBag,
    } satisfies FlightQuery
}

export async function loadFlight(): Promise<FlightQuery | null> {
    try {
        const raw: unknown = await localStorageCache.get(key)
        if (!raw || typeof raw !== 'object') return null
        const candidate = {...defaultFlight(), ...raw}
        return typeof candidate.checkedBag === 'boolean' && !flightError(candidate) ? candidate : null
    } catch { return null }
}

export async function saveFlight(query: FlightQuery) {
    try { await localStorageCache.set(key, query) } catch { /* Search stays usable in this tab. */ }
}
