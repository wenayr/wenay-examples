import {restoreDirectoryPreferences, type DirectoryPreferences} from './directory-preferences.ts'
import {restorePackagePreferences, type PackagePreferences} from './package-preferences.ts'

export const travelPages = {
    discover: 'Направления', catalog: 'Отели', packages: 'Туры', flights: 'Авиабилеты',
    deals: 'Горящие предложения', prices: 'Сравнить цены', providers: 'Источники', guides: 'Гиды агентства',
    assistant: 'Помощник', trip: 'Моя поездка', demo: 'Демо туров',
} as const
type TravelPage = keyof typeof travelPages
type Fields = Record<string, string | number | undefined>

export function travelHash(page: TravelPage, destination?: string, fields?: Fields) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(fields ?? {})) {
        if (value !== undefined) params.set(key, String(value))
    }
    const query = params.toString()
    const path = destination ? '/' + encodeURIComponent(destination) : ''
    return '#' + page + path + (query ? '?' + query : '')
}

export function travelRoute(hash: string) {
    const [path, query] = hash.replace(/^#\/?/, '').split('?')
    const [page, id] = path.split('/')
    let destination: string | undefined
    try { destination = id ? decodeURIComponent(id) : undefined } catch { destination = undefined }
    return {
        page: Object.hasOwn(travelPages, page) ? page as TravelPage : 'discover' as const,
        destination, query: new URLSearchParams(query),
    }
}

export type TravelRoute = ReturnType<typeof travelRoute>

export function browseForRoute(route: TravelRoute, pageSize: number) {
    const offset = Number(route.query.get('offset') ?? 0)
    const coordinates = ['west', 'south', 'east', 'north'].map(key => {
        const value = route.query.get(key)
        return value == null ? NaN : Number(value)
    })
    const [west, south, east, north] = coordinates
    const validLongitude = west >= -180 && east <= 180
    const validLatitude = south >= -90 && north <= 90
    const validBounds = coordinates.every(Number.isFinite) && validLongitude && validLatitude
    const orderedBounds = west < east && south < north
    const bounds = validBounds && orderedBounds ? [west, south, east, north] as const : null
    return {
        offset: Number.isSafeInteger(offset) && offset >= 0 ? Math.floor(offset / pageSize) * pageSize : 0,
        view: route.query.get('view') == 'map' ? 'map' as const : 'list' as const,
        selection: (route.query.get('selected') ?? route.query.get('hotelId') ?? '').slice(0, 160),
        bounds,
    }
}

export function browseFields(state: ReturnType<typeof browseForRoute>) {
    const [west, south, east, north] = state.bounds ?? []
    return {offset: state.offset, view: state.view, selected: state.selection || undefined, west, south, east, north}
}

export function replaceTravelHash(hash: string) {
    if (window.location.hash != hash) window.history.replaceState(window.history.state, '', hash)
}

export function openTravelDetail(hash: string) {
    window.history.pushState({...window.history.state, travelDetail: true}, '', hash)
}

export function dismissTravelDetail(onClose: () => void) {
    if (window.history.state?.travelDetail) window.history.back()
    else onClose()
}

function assignFields<T extends Record<string, string | number>>(stored: T, route: TravelRoute) {
    const next = {...stored}
    for (const key of Object.keys(stored) as (keyof T & string)[]) {
        const value = route.query.get(key)
        if (value == null) continue
        if (typeof stored[key] === 'number' && !/^\d+$/.test(value)) continue
        next[key] = (typeof stored[key] === 'number' ? Number(value) : value) as T[typeof key]
    }
    return next
}

export function directoryForRoute(stored: DirectoryPreferences, route: TravelRoute) {
    const changed = route.destination && route.destination !== stored.destination
    const base = changed ? {...stored, source: '', search: ''} : stored
    return restoreDirectoryPreferences({...assignFields(base, route), destination: route.destination ?? base.destination})
}

export function packagesForRoute(stored: PackagePreferences, route: TravelRoute) {
    const base = route.destination && route.destination !== stored.destination ? {...stored, hotelId: '', fareId: ''} : stored
    return restorePackagePreferences({...assignFields(base, route), destination: route.destination ?? stored.destination})
}
