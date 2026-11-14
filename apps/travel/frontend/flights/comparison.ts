import {localStorageCache} from 'wenay-react2/persist'
import type {FlightQuery, RouteQuote} from '../../src/flight-contract.ts'
import {validDate} from '../directory-preferences.ts'

const storageKey = 'wenay.travel.flight-comparison.v1'
const maxSearches = 8
export const maxFlightSelections = 3
export const flightSelectionStorageKey = 'wenay.travel.flight-selections.v1'
let writes = Promise.resolve()
let rememberedSelections: SavedFlightSelection[] = []
let selectionTemporary = false

export const flightSorts = {
    price: 'Сначала дешевле',
    departure: 'По времени вылета',
    duration: 'Меньше времени в пути',
} as const satisfies Record<string, string>

export type tFlightSort = keyof typeof flightSorts

export function defaultComparison() {
    return {
        sort: 'price' as tFlightSort,
        provider: 'all',
        carrier: 'all',
        maxStops: null as 0 | 1 | null,
    }
}

export type FlightComparisonPreferences = ReturnType<typeof defaultComparison>

export function flightQueryKey(query: FlightQuery) {
    return JSON.stringify([query.origin, query.destination, query.departure, query.returnDate, query.adults, query.checkedBag])
}

function filterName(value: unknown) {
    return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : 'all'
}

export function restoreComparison(value: unknown): FlightComparisonPreferences {
    const restored = defaultComparison()
    if (!value || typeof value !== 'object') return restored
    const current = value as Partial<FlightComparisonPreferences>
    if (typeof current.sort === 'string' && Object.hasOwn(flightSorts, current.sort)) restored.sort = current.sort
    restored.provider = filterName(current.provider)
    restored.carrier = filterName(current.carrier)
    if (current.maxStops === 0 || current.maxStops === 1) restored.maxStops = current.maxStops
    return restored
}

function storedEntries(value: unknown) {
    if (!Array.isArray(value)) return []
    return value.filter(entry => entry && typeof entry === 'object' && typeof entry.query === 'string')
        .slice(0, maxSearches)
        .map(entry => ({query: entry.query as string, preferences: restoreComparison(entry.preferences)}))
}

export async function loadComparison(query: FlightQuery) {
    try {
        const entries = storedEntries(await localStorageCache.get(storageKey))
        return entries.find(entry => entry.query === flightQueryKey(query))?.preferences ?? defaultComparison()
    } catch {
        return defaultComparison()
    }
}

export function saveComparison(query: FlightQuery, preferences: FlightComparisonPreferences) {
    const queryKey = flightQueryKey(query)
    const next = restoreComparison(preferences)
    async function write() {
        try {
            const entries = storedEntries(await localStorageCache.get(storageKey))
            const previous = entries.filter(entry => entry.query !== queryKey)
            await localStorageCache.set(storageKey, [{query: queryKey, preferences: next}, ...previous].slice(0, maxSearches))
        } catch { /* The current selection remains usable when browser storage is disabled. */ }
    }
    writes = writes.then(write)
    return writes
}

export type SavedFlightSelection = {query: FlightQuery, quote: RouteQuote}

export function quoteKey(quote: RouteQuote) {
    return quote.id || JSON.stringify([quote.providerId, quote.sourceUrl, quote.carrier, quote.total, quote.details?.outbound])
}

function storedQuery(value: unknown): FlightQuery | null {
    if (!value || typeof value !== 'object') return null
    const {origin, destination, departure, returnDate, adults, checkedBag} = value as Partial<FlightQuery>
    if (typeof origin !== 'string' || typeof destination !== 'string') return null
    const airports = /^[A-Z]{3}$/.test(origin) && /^[A-Z]{3}$/.test(destination) && origin !== destination
    if (!airports || !validDate(departure)) return null
    if (returnDate !== null && (!validDate(returnDate) || returnDate < departure)) return null
    if (typeof adults !== 'number') return null
    const people = Number.isInteger(adults) && adults >= 1 && adults <= 9
    if (!people) return null
    if (typeof checkedBag !== 'boolean') return null
    return {origin, destination, departure, returnDate, adults, checkedBag}
}

function storedText(value: unknown, limit = 200) {
    return typeof value === 'string' && value.length <= limit ? value : null
}

function nonNegative(value: unknown) {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function storedQuote(value: unknown): RouteQuote | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Partial<RouteQuote>
    const total = nonNegative(raw.total)
    const checkedAt = storedText(raw.checkedAt)
    const sourceUrl = storedText(raw.sourceUrl, 4000)
    if (total === null || raw.currency !== 'EUR') return null
    if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) return null
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) return null
    const quote: RouteQuote = {
        total, currency: 'EUR', checkedAt, sourceUrl, carrier: storedText(raw.carrier), description: storedText(raw.description, 3000) ?? '',
    }
    for (const key of ['id', 'providerId', 'providerName'] as const) {
        const text = storedText(raw[key], 500)
        if (text) quote[key] = text
    }
    if (raw.details && typeof raw.details === 'object') {
        quote.details = {
            stops: nonNegative(raw.details.stops), duration: storedText(raw.details.duration),
            durationMinutes: nonNegative(raw.details.durationMinutes), outbound: storedText(raw.details.outbound),
            checkedBags: nonNegative(raw.details.checkedBags), cabinBag: raw.details.cabinBag === 'excluded' ? 'excluded' : 'unknown',
        }
    }
    return quote
}

function restoredSelections(value: unknown) {
    if (!Array.isArray(value)) return []
    const restored: SavedFlightSelection[] = []
    const counts = new Map<string, Set<string>>()
    for (const entry of value.slice(0, maxSearches * maxFlightSelections)) {
        if (!entry || typeof entry !== 'object') continue
        const query = storedQuery(entry.query)
        const quote = storedQuote(entry.quote)
        if (!query || !quote) continue
        const key = flightQueryKey(query)
        if (!counts.has(key) && counts.size >= maxSearches) continue
        const selected = counts.get(key) ?? new Set<string>()
        const id = quoteKey(quote)
        if (selected.size >= maxFlightSelections || selected.has(id)) continue
        selected.add(id)
        counts.set(key, selected)
        restored.push({query, quote})
    }
    return restored
}

export async function readFlightSelections() {
    try {
        if (!selectionTemporary && typeof localStorage !== 'undefined') {
            rememberedSelections = restoredSelections(await localStorageCache.get(flightSelectionStorageKey))
        }
    } catch {
        selectionTemporary = true
    }
    return rememberedSelections
}

export function toggleFlightSelection(query: FlightQuery, quote: RouteQuote) {
    async function change() {
        const existing = await readFlightSelections()
        const queryKey = flightQueryKey(query)
        const id = quoteKey(quote)
        const matching = (entry: SavedFlightSelection) => flightQueryKey(entry.query) === queryKey && quoteKey(entry.quote) === id
        const found = existing.some(matching)
        const inQuery = existing.filter(entry => flightQueryKey(entry.query) === queryKey)
        if (!found && inQuery.length >= maxFlightSelections) return
        const next = found ? existing.filter(entry => !matching(entry)) : [{query, quote}, ...existing]
        rememberedSelections = restoredSelections(next)
        try {
            selectionTemporary = !await localStorageCache.set(flightSelectionStorageKey, rememberedSelections)
        } catch {
            selectionTemporary = true
        }
    }
    writes = writes.then(change)
    return writes.then(() => rememberedSelections)
}
