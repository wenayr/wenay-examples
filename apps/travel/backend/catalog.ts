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
    refresh: (destination: string, source: string, options: {signal: AbortSignal}) => Promise<PlaceDataset>
    photo: (hotel: SupplyHotel) => SupplyHotel['photo']
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

function contains(query: PlaceQuery, hotel: SupplyHotel) {
    if (query.box) {
        const [west, south, east, north] = query.box
        if (hotel.longitude < west || hotel.longitude > east) return false
        if (hotel.latitude < south || hotel.latitude > north) return false
    }
    return normalized(hotel.name + ' ' + (hotel.locality ?? '') + ' ' + (hotel.category ?? '')).includes(query.q)
}

export function createPlaceCatalog(deps: CatalogDeps) {
    const cache = new Map<string, CachedDataset>()
    const now = deps.now ?? Date.now
    const shutdown = new AbortController()
    const blockedUntil = new Map<string, number>()
    let running = 0

    function get(destination: PlaceRegion, source: string) {
        const key = destination.id + ':' + source
        let entry = cache.get(key)
        if (!entry) {
            const data = deps.readSnapshot(destination.id, source)
            entry = {data, due: 0, pending: false, wasLive: false, failed: false}
            cache.set(key, entry)
        }
        if (entry.pending || now() < entry.due || running >= 3) return entry
        if (shutdown.signal.aborted || now() < (blockedUntil.get(source) ?? 0)) return entry
        const current = entry
        current.pending = true
        running++
        // One request per destination/provider for all filters, map moves and simultaneous visitors.
        const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(35_000)])
        void Promise.resolve().then(() => deps.refresh(destination.id, source, {signal})).then(data => {
            current.data = data
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
            return {state, records: entry.data.records}
        })
    }

    function list(query: PlaceQuery): SupplyCatalogPage {
        const batch = collect(query.destination)
        const matching = batch.filter(item => !query.source || item.state.id == query.source)
        const found = matching.flatMap(item => item.records.filter(hotel => contains(query, hotel)))
        const enriched = found.map(hotel => ({...hotel, price: null, photo: hotel.photo ?? deps.photo(hotel)}))
        // A verified photo stays attached to its own provider record when nearby duplicates collapse.
        enriched.sort((a, b) => Number(Boolean(b.photo)) - Number(Boolean(a.photo)))
        const items = deduplicate(enriched).sort((a, b) => {
            const withPhoto = Number(Boolean(b.photo)) - Number(Boolean(a.photo))
            return withPhoto || order.compare(a.name, b.name) || a.id.localeCompare(b.id)
        })
        const end = query.offset + query.limit
        return {
            destination: query.destination, total: items.length, nextOffset: end < items.length ? end : null,
            sources: batch.map(item => item.state),
            items: items.slice(query.offset, end),
        }
    }

    function find(destination: PlaceRegion, id: string) {
        for (const item of collect(destination)) {
            const match = item.records.find(hotel => hotel.id == id)
            if (match) return match
        }
    }

    return {list, find, shutdown: () => shutdown.abort(), destinations: deps.destinations}
}

export function searchPhrase(input: string) {
    return normalized(input)
}
