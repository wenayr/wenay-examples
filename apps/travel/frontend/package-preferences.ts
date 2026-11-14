import {localStorageCache} from 'wenay-react2/persist'
import {packageDestinations, packageMaxTotal, packageWindowDays} from '../src/package-contract.ts'
import {shiftDate, validDate} from './directory-preferences.ts'

const storageKey = 'wenay.travel.packages.v1'
export const usualBudget = 1_000_000

export function packageDefaults(today = new Date().toISOString().slice(0, 10)) {
    const firstDeparture = shiftDate(today, 1)
    return {
        destination: String(packageDestinations[0]), firstDeparture, lastDeparture: shiftDate(firstDeparture, packageWindowDays - 1),
        nights: 7, adults: 2, minTotal: 0, maxTotal: usualBudget, minStars: 0, hotelId: '', fareId: '',
    }
}

export type PackagePreferences = ReturnType<typeof packageDefaults>

function whole(value: unknown, min: number, max: number): value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false
    return value >= min && value <= max
}

export function supportsPackage(value: unknown) {
    return packageDestinations.some(id => id === value)
}

export function packageHash(destination: string) {
    return supportsPackage(destination) ? '#packages/' + destination : '#packages'
}

export function restorePackagePreferences(raw: unknown) {
    const today = new Date().toISOString().slice(0, 10)
    const state = packageDefaults(today)
    if (!raw || typeof raw !== 'object') return state
    const saved = raw as Record<string, unknown>
    if (typeof saved.destination === 'string' && supportsPackage(saved.destination)) state.destination = saved.destination
    const {firstDeparture, lastDeparture, minTotal, maxTotal} = saved
    if (validDate(firstDeparture) && validDate(lastDeparture) && firstDeparture >= today) {
        if (lastDeparture >= firstDeparture && lastDeparture <= shiftDate(firstDeparture, packageWindowDays - 1)) {
            Object.assign(state, {firstDeparture, lastDeparture})
        }
    }
    if (whole(minTotal, 0, packageMaxTotal) && whole(maxTotal, minTotal, packageMaxTotal)) Object.assign(state, {minTotal, maxTotal})
    if (whole(saved.nights, 1, 30)) state.nights = saved.nights
    if (whole(saved.minStars, 0, 5)) state.minStars = saved.minStars
    if (typeof saved.hotelId === 'string') state.hotelId = saved.hotelId.slice(0, 160)
    if (typeof saved.fareId === 'string') state.fareId = saved.fareId.slice(0, 200)
    return state
}

export async function loadPackages() {
    try {
        return restorePackagePreferences(await localStorageCache.get(storageKey))
    } catch {
        return packageDefaults()
    }
}

export async function savePackages(prefs: PackagePreferences) {
    try {
        await localStorageCache.set(storageKey, prefs)
    } catch {
        // Keep the active search usable when browser storage is disabled.
    }
}

export function packageQuery(prefs: PackagePreferences) {
    const {destination, firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal} = prefs
    return {destination, firstDeparture, lastDeparture, nights, adults, minTotal, maxTotal}
}
