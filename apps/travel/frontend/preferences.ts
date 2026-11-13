import {localStorageCache, type CacheStorage} from 'wenay-react2/persist'
import {defaultSearch, destinations, demoOffers, hotels, type DestinationId} from '../demo/catalog.ts'
import {searchTours, type SearchCriteria} from '../src/search-tours.ts'

export type tDestination = DestinationId
type tSearch = SearchCriteria & {destinationId: tDestination}

export const preferenceKey = 'wenay.travel.hotel-search'
export const budgetLimit = Math.ceil(Math.max(...demoOffers.map(offer => offer.total)) / 50_000) * 50_000

export function initialSelection() {
    const search: tSearch = {...defaultSearch}
    return {search, hotelId: '', offerId: ''}
}

export type TravelSelection = ReturnType<typeof initialSelection>

function record(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value == 'object' && !Array.isArray(value)
}

function validDate(value: unknown): value is string {
    if (typeof value != 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const withinSeason = value >= defaultSearch.firstDeparture && value <= defaultSearch.lastDeparture
    const day = new Date(value + 'T00:00:00Z')
    return withinSeason && Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) == value
}

function validAmount(value: unknown): value is number {
    if (typeof value != 'number' || !Number.isSafeInteger(value)) return false
    return value >= 0 && value <= budgetLimit
}

function knownDestination(value: unknown): value is tDestination {
    return typeof value == 'string' && Object.hasOwn(destinations, value)
}

export function restoreSelection(raw: unknown): TravelSelection {
    const fresh = initialSelection()
    if (!record(raw) || raw.version !== 1 || !record(raw.search)) return fresh
    const stored = raw.search
    if (knownDestination(stored.destinationId)) fresh.search.destinationId = stored.destinationId
    const {firstDeparture, lastDeparture, minTotal, maxTotal} = stored
    const validInterval = validDate(firstDeparture) && validDate(lastDeparture)
    if (validInterval && firstDeparture <= lastDeparture) {
        fresh.search.firstDeparture = firstDeparture
        fresh.search.lastDeparture = lastDeparture
    }
    const validBudget = validAmount(minTotal) && validAmount(maxTotal)
    if (validBudget && minTotal <= maxTotal) {
        fresh.search.minTotal = minTotal
        fresh.search.maxTotal = maxTotal
    }
    // A saved hotel or rate can disappear from the current catalogue after a deployment.
    if (typeof raw.hotelId != 'string' || !Object.hasOwn(hotels, raw.hotelId)) return fresh
    const result = searchTours(demoOffers, fresh.search).find(hotel => hotel.hotelId == raw.hotelId)
    if (!result) return fresh
    fresh.hotelId = result.hotelId
    const day = result.calendar.find(row => row.inBudget?.id == raw.offerId)
    fresh.offerId = day?.inBudget?.id ?? result.best.id
    return fresh
}

export function createPreferences(storage: Pick<CacheStorage, 'get' | 'set' | 'delete'> = localStorageCache) {
    async function load() {
        try {
            return restoreSelection(await storage.get(preferenceKey))
        } catch {
            return initialSelection()
        }
    }

    async function save(state: TravelSelection) {
        try {
            return await storage.set(preferenceKey, {version: 1, ...state})
        } catch {
            return false
        }
    }

    async function clear() {
        try {
            return await storage.delete(preferenceKey)
        } catch {
            return false
        }
    }

    return {load, save, clear}
}
