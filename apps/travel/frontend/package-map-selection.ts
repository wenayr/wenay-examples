import {localStorageCache} from 'wenay-react2/persist'
import type {PackageHotel} from '../src/package-contract.ts'
import {packageHotelId, type tPackageHotel} from './package-hotel.ts'

export type tSelectedMapHotel = Pick<PackageHotel, 'id' | 'destinationId' | 'name' | 'stars' | 'latitude' | 'longitude' | 'url'>

const storageKey = 'wenay.travel.selected-map-hotel.v1'
let writes = Promise.resolve()

function coordinate(value: unknown, limit: number): value is number {
    if (typeof value != 'number' || !Number.isFinite(value)) return false
    return Math.abs(value) <= limit
}

function coordinatePair(latitude: unknown, longitude: unknown) {
    return coordinate(latitude, 90) && coordinate(longitude, 180)
}

function text(value: unknown, limit: number): value is string {
    if (typeof value != 'string') return false
    return value.length > 0 && value.length <= limit && value.trim().length > 0
}

function hotelUrl(value: unknown): value is string {
    if (typeof value != 'string') return false
    if (value == '') return true
    if (!text(value, 2000)) return false
    try {
        const url = new URL(value)
        return url.protocol == 'https:' || url.protocol == 'http:'
    } catch {
        return false
    }
}

export function mapHotelReference(hotel: tPackageHotel): tSelectedMapHotel {
    const mapped = coordinatePair(hotel.latitude, hotel.longitude)
    const url = 'url' in hotel ? hotel.url : hotel.photo?.sourceUrl ?? ''
    return {
        id: packageHotelId(hotel), destinationId: hotel.destinationId, name: hotel.name, stars: hotel.stars,
        latitude: mapped ? hotel.latitude : null,
        longitude: mapped ? hotel.longitude : null,
        url,
    }
}

export function restoreSelectedMapHotel(raw: unknown): tSelectedMapHotel | null {
    if (!raw || typeof raw != 'object' || Array.isArray(raw)) return null
    const saved = raw as Record<string, unknown>
    if (saved.version != 1) return null
    const {id, destinationId, name, stars, latitude, longitude, url} = saved
    if (!text(id, 200) || !text(name, 500) || !hotelUrl(url)) return null
    if (id.trim() != id) return null
    if (destinationId != null && !text(destinationId, 120)) return null
    if (stars != null) {
        const rating = coordinate(stars, 5) && Number.isInteger(stars) && stars >= 0
        if (!rating) return null
    }
    if (!Object.hasOwn(saved, 'latitude') || !Object.hasOwn(saved, 'longitude')) return null
    const unmapped = latitude == null && longitude == null
    if (!unmapped && !coordinatePair(latitude, longitude)) return null
    return mapHotelReference({
        id, name, url, destinationId: typeof destinationId == 'string' ? destinationId : undefined,
        stars: typeof stars == 'number' ? stars : null,
        latitude: typeof latitude == 'number' ? latitude : null,
        longitude: typeof longitude == 'number' ? longitude : null,
    })
}

export function selectedMapHotelReference(previous: tSelectedMapHotel | null, selectedId: string | null,
    candidate?: tPackageHotel | null): tSelectedMapHotel | null {
    if (!selectedId) return null
    const saved = previous?.id == selectedId ? previous : null
    if (!candidate || packageHotelId(candidate) != selectedId) return saved
    const supplied = mapHotelReference(candidate)
    const next = {...supplied, url: supplied.url || saved?.url || '', destinationId: supplied.destinationId ?? saved?.destinationId}
    if (!coordinatePair(next.latitude, next.longitude) && saved) {
        next.latitude = saved.latitude
        next.longitude = saved.longitude
    }
    const fields = ['id', 'destinationId', 'name', 'stars', 'latitude', 'longitude', 'url'] as const
    return saved && fields.every(key => saved[key] == next[key]) ? saved : next
}

export async function loadSelectedMapHotel() {
    await writes
    try {
        return restoreSelectedMapHotel(await localStorageCache.get(storageKey))
    } catch {
        return null
    }
}

export function saveSelectedMapHotel(reference: tSelectedMapHotel | null) {
    const payload = reference ? {version: 1, ...mapHotelReference(reference)} : null
    async function write() {
        try {
            if (payload) await localStorageCache.set(storageKey, payload)
            else await localStorageCache.delete(storageKey)
        } catch {
            // Selection remains usable in this visit when browser persistence is unavailable.
        }
    }
    writes = writes.then(write, write)
    return writes
}
