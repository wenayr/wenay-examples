import {isDeepStrictEqual} from 'node:util'
import type {SupplyCatalogPage, SupplyDestination, SupplyHotel, SupplySource} from '../src/supply-contract.ts'

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
    readSnapshot: (destination: string, source: string) => PlaceDataset
    refresh?: (destination: string, source: string, options: {signal: AbortSignal}) => Promise<PlaceDataset>
    photo: (hotel: SupplyHotel) => SupplyHotel['photo']
    onChange?: (destination: string) => void
    now?: () => number
}

interface CachedDataset {
    data: PlaceDataset
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

const order = new Intl.Collator('ru', {sensitivity: 'base', numeric: true})
const freshFor = 12 * 60 * 60_000
const cooldown = 15 * 60_000

function normalized(value: string) {
    return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function close(a: SupplyHotel, b: SupplyHotel) {
    const longitudeWidth = Math.cos((a.latitude + b.latitude) * Math.PI / 360)
    const east = (a.longitude - b.longitude) * longitudeWidth
    return Math.hypot(a.latitude - b.latitude, east) * 111_200 < 175
}

function deduplicate(records: SupplyHotel[]) {
    const groups = new Map<string, SupplyHotel[]>()
    const known = new Set<string>()
    const ids = new Set<string>()
    const kept = []
    for (const hotel of records) {
        const entity = hotel.wikidataId
        if (ids.has(hotel.id) || (entity && known.has(entity))) continue
        ids.add(hotel.id)
        const name = normalized(hotel.name)
        const sameName = groups.get(name) ?? []
        if (sameName.some(other => close(other, hotel))) continue
        if (entity) known.add(entity)
        sameName.push(hotel)
        groups.set(name, sameName)
        kept.push(hotel)
    }
    return kept
}

function compareHotels(a: SupplyHotel, b: SupplyHotel) {
    const withPhoto = Number(Boolean(b.photo)) - Number(Boolean(a.photo))
    return withPhoto || order.compare(a.name, b.name) || a.id.localeCompare(b.id)
}

interface IndexedHotel {
    hotel: SupplyHotel
    text: string
}

function contains(query: PlaceQuery, row: IndexedHotel) {
    if (query.box) {
        const [west, south, east, north] = query.box
        if (row.hotel.longitude < west || row.hotel.longitude > east) return false
        if (row.hotel.latitude < south || row.hotel.latitude > north) return false
    }
    return row.text.includes(query.q)
}

function createRegionIndex(datasets: CachedDataset[], photo: CatalogDeps['photo']) {
    const rows: IndexedHotel[] = []
    const byId = new Map<string, SupplyHotel>()
    const linkedEntities = new Set<string>()
    const matching = new Map<string, SupplyHotel[]>()
    for (const entry of datasets) {
        for (const place of entry.data.records) {
            const image = place.photo ?? photo(place)
            const hotel = image != place.photo ? {...place, photo: image} : place
            const text = normalized(hotel.name + ' ' + (hotel.locality ?? '') + ' ' + (hotel.category ?? ''))
            rows.push({hotel, text})
            byId.set(hotel.id, hotel)
            if (hotel.wikidataId) linkedEntities.add(hotel.wikidataId)
        }
    }
    // Filter before deduplication: another provider's matching row can have different coordinates or labels.
    rows.sort((a, b) => Number(Boolean(b.hotel.photo)) - Number(Boolean(a.hotel.photo)))
    const all = deduplicate(rows.map(row => row.hotel)).sort(compareHotels)
    function search(query: PlaceQuery) {
        if (!query.source && !query.q && !query.box) return all
        const key = JSON.stringify([query.source, query.q, query.box])
        const cached = matching.get(key)
        if (cached) return cached
        const found = rows.filter(row => (!query.source || row.hotel.sourceId == query.source) && contains(query, row))
        const result = deduplicate(found.map(row => row.hotel)).sort(compareHotels)
        if (matching.size >= 8) matching.delete(matching.keys().next().value!)
        matching.set(key, result)
        return result
    }
    function includesPhotoKey(key: string) {
        const entity = key.startsWith('wikidata:') ? key.slice('wikidata:'.length) : key
        return byId.has(key) || linkedEntities.has(entity) || byId.has('wikidata:' + entity)
    }
    return {byId, search, includesPhotoKey}
}

function sameRecords(previous: SupplyHotel[], incoming: SupplyHotel[]) {
    if (previous == incoming) return true
    if (previous.length != incoming.length) return false
    const current = new Map(previous.map(row => [row.id, row]))
    if (current.size != previous.length) return isDeepStrictEqual(previous, incoming)
    for (const row of incoming) {
        if (!isDeepStrictEqual(current.get(row.id), row)) return false
        current.delete(row.id)
    }
    return true
}

export function createPlaceCatalog(deps: CatalogDeps) {
    const cache = new Map<string, CachedDataset>()
    const now = deps.now ?? Date.now
    const shutdown = new AbortController()
    const blockedUntil = new Map<string, number>()
    let running = 0
    const indexes = new Map<string, ReturnType<typeof createRegionIndex>>()
    const active = new Map<string, PlaceRegion>()

    function changed(destination: string) {
        indexes.delete(destination)
        deps.onChange?.(destination)
    }

    function apply(destination: string, entry: CachedDataset, incoming: PlaceDataset) {
        const differs = !sameRecords(entry.data.records, incoming.records)
        entry.data = incoming
        if (differs) changed(destination)
    }


    function get(destination: PlaceRegion, source: string) {
        const key = destination.id + ':' + source
        let entry = cache.get(key)
        if (!entry) {
            const data = deps.readSnapshot(destination.id, source)
            const due = data.fetchedAt ? Date.parse(data.fetchedAt) + freshFor : 0
            entry = {data, due, pending: false, wasLive: false, failed: false}
            cache.set(key, entry)
        }
        const refresh = deps.refresh
        if (!refresh) return entry
        if (entry.pending || now() < entry.due || running >= 3) return entry
        if (shutdown.signal.aborted || now() < (blockedUntil.get(source) ?? 0)) return entry
        const current = entry
        current.pending = true
        running++
        // One request per destination/provider for all filters, map moves and simultaneous visitors.
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(35_000)])
        void Promise.resolve().then(() => refresh(destination.id, source, {signal})).then(data => {
            if (shutdown.signal.aborted) return
            if (Date.parse(data.fetchedAt ?? '') < Date.parse(current.data.fetchedAt ?? '')) return
            apply(destination.id, current, data)
            current.wasLive = true
            current.failed = false
            current.due = now() + freshFor
        }).catch((error: unknown) => {
            const status = error && typeof error == 'object' && 'status' in error ? error.status : null
            if (status == 429) blockedUntil.set(source, now() + cooldown)
            current.failed = true
            current.due = now() + cooldown
        }).finally(() => {
            current.pending = false
            running--
        })
        return current
    }

    function collect(destination: PlaceRegion) {
        active.set(destination.id, destination)
        return destination.sourceIds.map(id => {
            const source = deps.sources.find(item => item.id == id)
            const entry = get(destination, id)
            const available = entry.data.fetchedAt != null
            let status: SupplySource['status'] = 'unavailable'
            if (available) status = entry.wasLive && !entry.failed ? 'live' : 'cached'
            let description = 'Справочные сведения о размещении.'
            if (entry.failed) description = 'Источник временно не ответил. Показаны последние доступные данные.'
            if (!available) description = 'Свежие записи пока не получены.'
            const state: SupplySource = {
                ...source, id, name: source?.name ?? id, status, updatedAt: entry.data.fetchedAt, description,
                attribution: id == 'osm' ? '© OpenStreetMap contributors' : source?.name,
            }
            return {state, entry}
        })
    }

    function regionIndex(destination: PlaceRegion, datasets: CachedDataset[]) {
        const cached = indexes.get(destination.id)
        if (cached) return cached
        const index = createRegionIndex(datasets, deps.photo)
        indexes.set(destination.id, index)
        return index
    }

    function list(query: PlaceQuery): SupplyCatalogPage {
        const batch = collect(query.destination)
        const index = regionIndex(query.destination, batch.map(item => item.entry))
        const items = index.search(query)
        const end = query.offset + query.limit
        return {
            destination: query.destination, total: items.length, nextOffset: end < items.length ? end : null,
            sources: batch.map(item => item.state), items: items.slice(query.offset, end),
        }
    }

    function find(destination: PlaceRegion, id: string) {
        const batch = collect(destination)
        return regionIndex(destination, batch.map(item => item.entry)).byId.get(id)
    }

    function reloadSnapshot(destination: string, source: string) {
        const entry = cache.get(destination + ':' + source)
        if (!entry) return
        const data = deps.readSnapshot(destination, source)
        apply(destination, entry, data)
        entry.due = data.fetchedAt ? Date.parse(data.fetchedAt) + freshFor : 0
        entry.failed = false
    }

    function invalidatePhotos(changedKeys: readonly string[]) {
        if (!changedKeys.length) return
        // An invalidated region reads the latest photo manifest when it next rebuilds its view.
        for (const [destination, index] of indexes) {
            if (changedKeys.some(index.includesPhotoKey)) changed(destination)
        }
    }

    function refreshActive(destination: string) {
        const region = active.get(destination)
        if (region) for (const id of region.sourceIds) get(region, id)
    }

    return {list, find, reloadSnapshot, invalidatePhotos, refreshActive, shutdown: () => shutdown.abort(), destinations: deps.destinations}

}

export function searchPhrase(input: string) {
    return normalized(input)
}
