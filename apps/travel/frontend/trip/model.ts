import type {PackageFare, PackageHotel} from '../../src/package-contract.ts'
import {packageComparisonLimit, packageMaxTotal, packageWindowDays} from '../../src/package-contract.ts'
import type {SupplyDestination, SupplyHotel, SupplySource} from '../../src/supply-contract.ts'
import {shiftDate, validDate, type DirectoryPreferences} from '../directory-preferences.ts'
import {supportsPackage, type PackagePreferences} from '../package-preferences.ts'

export function directoryTrip(hotel: SupplyHotel, destination: SupplyDestination, prefs: DirectoryPreferences, updatedAt: string | null = null) {
    return {
        kind: 'hotel' as const, hotelId: hotel.id, name: hotel.name, destination: destination.name, category: hotel.category,
        prefs: {...prefs, destination: destination.id}, source: hotel.sourceName, checkedAt: updatedAt,
    }
}

export function packageTrip(hotel: Pick<PackageHotel, 'id' | 'name' | 'stars'>, fare: PackageFare, destination: SupplyDestination,
    prefs: PackagePreferences, source: SupplySource, checkedAt: string | null = source.updatedAt) {
    return {
        kind: 'package' as const, hotelId: hotel.id, name: hotel.name, destination: destination.name,
        category: hotel.stars == null ? null : hotel.stars + ' ★', fare, prefs: {...prefs, destination: destination.id, hotelId: hotel.id, fareId: fare.id},
        source: source.name, checkedAt,
    }
}

export type TripItem = ReturnType<typeof directoryTrip> | ReturnType<typeof packageTrip>
export type PackageTrip = ReturnType<typeof packageTrip>

export function tripDates(item: TripItem) {
    if (item.kind == 'hotel') return [item.prefs.checkIn, item.prefs.checkOut] as const
    return [item.fare.departure, shiftDate(item.fare.departure, item.prefs.nights)] as const
}

export function tripKey(item: TripItem) {
    const stay = item.kind == 'package' ? [item.fare.id, item.prefs.nights] : [item.prefs.checkIn, item.prefs.checkOut]
    return JSON.stringify([item.kind, item.prefs.destination, item.hotelId, item.prefs.adults, ...stay])
}

export const today = () => new Date().toISOString().slice(0, 10)
const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})
const dates = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
const times = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'})

export const amount = (cents: number) => money.format(cents / 100)
export const dayLabel = (date: string) => dates.format(new Date(date + 'T00:00:00Z'))
export const checkedLabel = (iso: string | null) => iso ? times.format(new Date(iso)) : 'Время не указано'
export const tripPeriod = (item: TripItem) => tripDates(item).map(dayLabel).join(' — ')

function obj(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value == 'object'
}
function text(value: unknown): value is string {
    return typeof value == 'string' && value.length > 0
}
function whole(value: unknown, min: number, max: number): value is number {
    if (typeof value != 'number' || !Number.isSafeInteger(value)) return false
    return value >= min && value <= max
}

function isTrip(value: unknown): value is TripItem {
    if (!obj(value) || !obj(value.prefs)) return false
    const {kind, prefs, category, checkedAt} = value
    if (![value.hotelId, value.name, value.destination, value.source, prefs.destination].every(text)) return false
    if (!(category === null || typeof category == 'string')) return false
    if (!(checkedAt === null || text(checkedAt) && Number.isFinite(Date.parse(checkedAt)))) return false
    if (!whole(prefs.adults, 1, 8)) return false
    if (kind == 'hotel') {
        if (!validDate(prefs.checkIn) || !validDate(prefs.checkOut) || prefs.checkOut <= prefs.checkIn) return false
        return typeof prefs.source == 'string' && typeof prefs.search == 'string'
    }
    if (kind != 'package' || !obj(value.fare) || !supportsPackage(prefs.destination)) return false
    const {id, departure, total} = value.fare
    if (!text(id) || !validDate(departure) || !whole(total, 1, packageMaxTotal)) return false
    if (!validDate(prefs.firstDeparture) || !validDate(prefs.lastDeparture)) return false
    if (departure < prefs.firstDeparture || departure > prefs.lastDeparture) return false
    if (Date.parse(prefs.lastDeparture) - Date.parse(prefs.firstDeparture) >= packageWindowDays * 86_400_000) return false
    if (!whole(prefs.minTotal, 0, packageMaxTotal) || !whole(prefs.maxTotal, prefs.minTotal, packageMaxTotal)) return false
    if (!whole(prefs.minStars, 0, 5) || !whole(prefs.nights, 1, 30)) return false
    return prefs.hotelId == value.hotelId && prefs.fareId == id
}

export interface TripState {version: 1, items: TripItem[], compare: string[]}

export function restoreTrip(raw: unknown): TripState {
    if (!obj(raw) || raw.version != 1 || !Array.isArray(raw.items)) return {version: 1, items: [], compare: []}
    const entries = new Map(raw.items.filter(isTrip).map(item => [tripKey(item), item]))
    const keys = Array.isArray(raw.compare) ? raw.compare.filter(key => typeof key == 'string' && entries.has(key)) : []
    return {version: 1, items: [...entries.values()], compare: [...new Set<string>(keys)].slice(0, packageComparisonLimit)}
}

export function setTrip(state: TripState, item: TripItem, saved: boolean): TripState {
    const key = tripKey(item)
    const keep = state.items.filter(saved => tripKey(saved) != key)
    const found = keep.length != state.items.length
    if (saved == found) return state
    if (saved) return {...state, items: [item, ...keep]}
    return {...state, items: keep, compare: state.compare.filter(id => id != key)}
}

export function compareTrip(state: TripState, key: string, selected: boolean): TripState {
    if (state.compare.includes(key) == selected) return state
    if (!selected) return {...state, compare: state.compare.filter(id => id != key)}
    if (state.compare.length >= packageComparisonLimit || !state.items.some(saved => tripKey(saved) == key)) return state
    return {...state, compare: [...state.compare, key]}
}
