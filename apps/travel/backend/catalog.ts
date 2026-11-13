import type {SupplyCatalogPage, SupplyDestination, SupplyHotel, SupplySource} from '../src/supply-contract.ts'
import {createCatalogIndex} from './catalog-index.ts'
import {searchPhrase} from './catalog-text.ts'

export {searchPhrase}

export interface PlaceRegion extends SupplyDestination {
    sourceIds: readonly string[]
}

export interface PlaceSource {
    id: string
    name: string
    url?: string
    license?: string
    licenseUrl?: string
}

export interface PlaceDataset {
    records: SupplyHotel[]
    fetchedAt: string | null
}

interface CatalogDeps {
    destinations: readonly PlaceRegion[]
    sources: readonly PlaceSource[]
    index?: ReturnType<typeof createCatalogIndex>
    readSnapshot?: (destination: string, source: string) => PlaceDataset
    refresh?: (destination: string, source: string, options: {signal: AbortSignal}) => Promise<PlaceDataset>
    afterRefresh?: () => void
    photo: (hotel: SupplyHotel) => SupplyHotel['photo']
    onChange?: (destination: string) => void
    now?: () => number
}

interface FeedStatus {
    due: number
    pending: boolean
    wasLive: boolean
    failed: boolean
}

export interface PlaceQuery {
    destination: PlaceRegion
    q: string
    source: string | null
    box: [number, number, number, number] | null
    offset: number
    limit: number
}

const freshFor = 12 * 60 * 60_000
const cooldown = 15 * 60_000

export function createPlaceCatalog(deps: CatalogDeps) {
    const now = deps.now ?? Date.now
    const index = deps.index ?? createCatalogIndex({path: ':memory:', destinations: deps.destinations})
    if (!deps.index) {
        if (!deps.readSnapshot) throw new Error('An indexed catalog or a seed feed is required')
        for (const region of deps.destinations) {
            for (const source of region.sourceIds) {
                index.replaceSource(region.id, source, deps.readSnapshot(region.id, source), deps.photo)
            }
        }
    }
    const feeds = new Map<string, FeedStatus>()
    const blockedUntil = new Map<string, number>()
    const shutdown = new AbortController()
    let running = 0

    function changed(destination: string) { deps.onChange?.(destination) }

    function apply(destination: string, source: string, incoming: PlaceDataset) {
        if (index.replaceSource(destination, source, incoming, deps.photo).changed) changed(destination)
    }

    function state(destination: string, source: string) {
        const key = destination + ':' + source
        let status = feeds.get(key)
        if (!status) {
            const date = index.meta(destination, source)?.fetchedAt
            status = {due: date ? Date.parse(date) + freshFor : 0, pending: false, failed: false, wasLive: false}
            feeds.set(key, status)
        }
        return status
    }

    function refreshIfDue(destination: string, source: string) {
        const status = state(destination, source)
        const refresh = deps.refresh
        if (!refresh || status.pending) return status
        if (now() < status.due || running >= 3) return status
        if (shutdown.signal.aborted || now() < (blockedUntil.get(source) ?? 0)) return status
        status.pending = true
        running++
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(35_000)])
        void Promise.resolve().then(() => refresh(destination, source, {signal})).then(data => {
            if (shutdown.signal.aborted) return
            const current = index.meta(destination, source)?.fetchedAt
            if (data.fetchedAt && current && Date.parse(data.fetchedAt) < Date.parse(current)) return
            if (deps.afterRefresh) deps.afterRefresh()
            else apply(destination, source, data)
            status.wasLive = true
            status.failed = false
            status.due = now() + freshFor
        }).catch((error: unknown) => {
            const code = error && typeof error == 'object' && 'status' in error ? error.status : null
            if (code == 429) blockedUntil.set(source, now() + cooldown)
            status.failed = true
            status.due = now() + cooldown
        }).finally(() => {
            status.pending = false
            running--
        })
        return status
    }

    function sourcesFor(region: PlaceRegion, selected: string | null) {
        return region.sourceIds.map(id => {
            const source = deps.sources.find(item => item.id == id)
            const status = !selected || selected == id ? refreshIfDue(region.id, id) : state(region.id, id)
            const date = index.meta(region.id, id)?.fetchedAt ?? null
            let availability: SupplySource['status'] = 'unavailable'
            if (date) availability = status.wasLive && !status.failed ? 'live' : 'cached'
            let description = 'Справочные сведения о размещении.'
            if (status.failed) description = 'Источник временно не ответил. Показаны последние доступные данные.'
            if (!date) description = 'Свежие записи пока не получены.'
            return {
                ...source, id, name: source?.name ?? id, status: availability, updatedAt: date, description,
                attribution: id == 'osm' ? '© OpenStreetMap contributors' : source?.name,
            }
        })
    }

    function list(query: PlaceQuery): SupplyCatalogPage {
        const sources = sourcesFor(query.destination, query.source)
        const page = index.list(query)
        const end = query.offset + query.limit
        return {destination: query.destination, ...page, nextOffset: end < page.total ? end : null, sources}
    }

    function find(destination: PlaceRegion, id: string) {
        const hotel = index.find(destination.id, id)
        if (hotel) refreshIfDue(destination.id, hotel.sourceId)
        return hotel
    }

    function reloadSnapshot(destination: string, source: string) {
        if (deps.readSnapshot) apply(destination, source, deps.readSnapshot(destination, source))
        const feed = state(destination, source)
        const date = index.meta(destination, source)?.fetchedAt
        feed.due = date ? Date.parse(date) + freshFor : 0
        feed.failed = false
    }

    function invalidatePhotos(keys: readonly string[]) {
        for (const destination of index.applyPhotos(keys, deps.photo)) changed(destination)
    }

    function refreshActive(destination: string) {
        const region = deps.destinations.find(item => item.id == destination)
        if (region) for (const source of region.sourceIds) refreshIfDue(destination, source)
    }

    function close() {
        shutdown.abort()
        if (!deps.index) index.close()
    }

    return {list, find, reloadSnapshot, refreshActive, invalidatePhotos, shutdown: close, destinations: deps.destinations}
}
