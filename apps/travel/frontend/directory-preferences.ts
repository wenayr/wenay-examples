import {localStorageCache, type CacheStorage} from 'wenay-react2/persist'

const key = 'wenay.travel.accommodations.v1'
const dayMs = 86_400_000

function isoDate(value: Date) {
    return value.toISOString().slice(0, 10)
}

export function shiftDate(value: string, days: number) {
    return isoDate(new Date(Date.parse(value + 'T00:00:00Z') + days * dayMs))
}

export function directoryDefaults(now = new Date()) {
    const start = isoDate(now)
    return {
        destination: '', search: '', source: '', checkIn: shiftDate(start, 14), checkOut: shiftDate(start, 21), adults: 2,
    }
}

export type DirectoryPreferences = ReturnType<typeof directoryDefaults>

function validDate(value: unknown): value is string {
    if (typeof value != 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(value + 'T00:00:00Z')
    return Number.isFinite(date.valueOf()) && isoDate(date) == value
}

export function restoreDirectoryPreferences(raw: unknown, now = new Date()) {
    const state = directoryDefaults(now)
    if (!raw || typeof raw != 'object') return state
    if ('destination' in raw && typeof raw.destination == 'string') state.destination = raw.destination.slice(0, 120)
    if ('source' in raw && typeof raw.source == 'string') state.source = raw.source.slice(0, 120)
    if ('search' in raw && typeof raw.search == 'string') state.search = raw.search.slice(0, 120)
    if ('adults' in raw && typeof raw.adults == 'number') {
        if (Number.isInteger(raw.adults) && raw.adults >= 1 && raw.adults <= 8) state.adults = raw.adults
    }
    if (!('checkIn' in raw) || !('checkOut' in raw)) return state
    if (!validDate(raw.checkIn) || !validDate(raw.checkOut)) return state
    if (raw.checkIn >= isoDate(now) && raw.checkOut > raw.checkIn) {
        state.checkIn = raw.checkIn
        state.checkOut = raw.checkOut
    }
    return state
}

export function createDirectoryPreferences(storage: Pick<CacheStorage, 'get' | 'set'> = localStorageCache) {
    async function load() {
        try {
            return restoreDirectoryPreferences(await storage.get(key))
        } catch {
            return directoryDefaults()
        }
    }
    async function save(state: DirectoryPreferences) {
        try {
            await storage.set(key, state)
        } catch {
            // A blocked browser store still permits use of the full directory in this visit.
        }
    }
    return {load, save}
}
