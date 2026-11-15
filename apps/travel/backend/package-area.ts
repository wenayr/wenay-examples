import {createAsyncQueue} from 'wenay-common2/client'
import type {PackageArea, tPackageBounds} from '../src/package-area-contract.ts'
import type {PackageHotel, PackagePage} from '../src/package-contract.ts'
import type {PackageHotelSearch} from '../src/package-search-contract.ts'
import type {PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplyDestination, SupplySource} from '../src/supply-contract.ts'
import type {TezObservation, TezWindow} from './partners/tez-inventory.ts'
import {createOfferIndex, type PackageQuery} from './package-index.ts'
import {createRangeIndex} from './range-index.ts'
import {packageDestinations} from '../src/package-contract.ts'
import {placeDestinations} from './places/registry.mjs'
import {searchPhrase} from './catalog-text.ts'
import {tezKnownHotels} from './partners/tez-catalog.ts'
import {createBoundedCache, estimatedCacheBytes} from './bounded-cache.ts'

type tAreaMode = PackageArea['mode']
type tRegion = SupplyDestination & {bbox: tPackageBounds}
interface WindowResult {data: TezObservation, hotels: Map<string, PackageHotel>, revision?: string}
interface Selection {area: PackageArea, regions: tRegion[]}
const regionRequestLimit = 6
const knownMarkerLimit = 200
const defaultSource = {id: 'tez', name: 'TEZ TOUR Eesti', url: 'https://www.teztour.ee/page/xml-gate.et.html'}

function regionEnvelope(place: typeof placeDestinations[number]): tRegion {
    const bbox = [...place.bbox] as [number, number, number, number]
    for (const hotel of tezKnownHotels(place.id)) {
        if (hotel.latitude == null || hotel.longitude == null) continue
        bbox[0] = Math.min(bbox[0], hotel.longitude - 0.02)
        bbox[1] = Math.min(bbox[1], hotel.latitude - 0.02)
        bbox[2] = Math.max(bbox[2], hotel.longitude + 0.02)
        bbox[3] = Math.max(bbox[3], hotel.latitude + 0.02)
    }
    return {...place, bbox}
}

const connectedRegions = placeDestinations.filter(place => packageDestinations.some(id => id == place.id))
export const connectedPackageRegions: readonly tRegion[] = connectedRegions.map(regionEnvelope)

function intersects(box: tPackageBounds, target: tPackageBounds) {
    const longitude = box[0] <= target[2] && box[2] >= target[0]
    const latitude = box[1] <= target[3] && box[3] >= target[1]
    return longitude && latitude
}

function sourceFor(observations: {source: SupplySource}[], area: PackageArea): SupplySource {
    const successful = observations.filter(data => data.source.status == 'live' || data.source.status == 'cached')
    if (!successful.length) return {...defaultSource, status: observations.length ? 'unavailable' : 'handoff', updatedAt: null,
        description: area.description, retryAt: observations.map(data => data.source.retryAt).filter(Boolean).sort()[0]}
    const times = successful.map(data => data.source.updatedAt).filter((time): time is string => Boolean(time)).sort()
    const stale = successful.some(data => data.source.stale)
    return {...defaultSource, status: successful.some(data => data.source.status == 'live') ? 'live' : 'cached',
        stale: stale || undefined, updatedAt: times[0] ?? null, description: area.description,
        retryAt: observations.map(data => data.source.retryAt).filter(Boolean).sort()[0]}
}

export function createPackageAreas(deps: {
    window: (trip: TezWindow, signal?: AbortSignal, refresh?: boolean) => Promise<WindowResult>
    trends: (trip: TezWindow, ids: readonly string[], signal?: AbortSignal) => Promise<PackageTrends>
    regions?: readonly tRegion[]
}) {
    const regions = deps.regions ?? connectedPackageRegions
    const regionIndex = createRangeIndex(regions, region => region.latitude, region => region.longitude)
    const maxLatitude = Math.max(0, ...regions.map(region => Math.max(region.latitude - region.bbox[1], region.bbox[3] - region.latitude)))
    const maxLongitude = Math.max(0, ...regions.map(region => Math.max(region.longitude - region.bbox[0], region.bbox[2] - region.longitude)))
    const queue = createAsyncQueue(2)
    const snapshots = createBoundedCache<ReturnType<typeof createOfferIndex>>({maxEntries: 32, maxBytes: 8 * 1024 * 1024})

    function select(mode: tAreaMode, box: tPackageBounds | null, fallback: string, allowedDestinations?: readonly string[]): Selection {
        let candidates = regions.filter(region => region.id == fallback)
        if (mode == 'map' && box) {
            const slices = regionIndex(box[1] - maxLatitude, box[3] + maxLatitude, box[0] - maxLongitude, box[2] + maxLongitude)
            candidates = slices.flatMap(slice => slice.entries.slice(slice.start, slice.end)).filter(region => intersects(box, region.bbox))
            const latitude = (box[1] + box[3]) / 2
            const longitude = (box[0] + box[2]) / 2
            const distance = (region: tRegion) => (region.latitude - latitude) ** 2 + (region.longitude - longitude) ** 2
            candidates.sort((a, b) => distance(a) - distance(b))
        }
        if (allowedDestinations) candidates = candidates.filter(region => allowedDestinations.includes(region.id))
        const selected = candidates.slice(0, regionRequestLimit)
        let coverage: PackageArea['coverage'] = 'connected-regions'
        let description = 'Подключённые источники в области карты: ' + selected.map(region => region.name).join(', ') + '.'
        if (!selected.length) {
            coverage = 'unsupported'
            description = 'В этой области карты источник туров ещё не подключён. Это не означает, что здесь нет отелей.'
        } else if (candidates.length > selected.length) {
            coverage = 'partial'
            description = 'Проверяем ближайшие к центру карты подключённые регионы. Приблизьте нужную область для остальных.'
        }
        return {regions: selected, area: {mode, bounds: box, destinations: selected, coverage, description}}
    }

    async function observe(trip: TezWindow, filter: PackageQuery, mode: tAreaMode, signal?: AbortSignal, refresh = false,
        allowedDestinations?: readonly string[]) {
        const selection = select(mode, filter.box, trip.destinationId, allowedDestinations)
        const batches = await Promise.all(selection.regions.map(region => queue.add(async function observeRegion() {
            signal?.throwIfAborted()
            return deps.window({...trip, destinationId: region.id}, signal, refresh)
        })))
        signal?.throwIfAborted()
        const area = {...selection.area}
        const unresolved = batches.reduce((count, batch) => count + [...batch.hotels.values()]
            .filter(hotel => hotel.latitude == null || hotel.longitude == null).length, 0)
        if (unresolved) {
            area.coverage = 'partial'
            area.description += ' Точные координаты ещё уточняются у ' + unresolved + ' отелей. Они доступны в поиске без вымышленной точки на карте.'
        }
        if (batches.some(batch => (batch.data.source.status != 'live' && batch.data.source.status != 'cached') || batch.data.source.stale)) {
            area.coverage = 'partial'
            area.description += ' Часть цен пока не подтверждена; время проверки и статус сохранены.'
        }
        const key = JSON.stringify([selection.regions.map(region => region.id), batches.map(batch => batch.revision ?? batch.data.generation)])
        let index = snapshots.view.get(key)
        if (!index) {
            const hotels = new Map<string, PackageHotel>()
            for (const batch of batches) for (const [id, hotel] of batch.hotels) hotels.set(id, hotel)
            const input = {hotels: [...hotels.values()], offers: batches.flatMap(batch => batch.data.quotes)}
            index = createOfferIndex(input)
            snapshots.control.set({key, value: index, bytes: estimatedCacheBytes(input)})
        }
        return {index, batches, area, source: sourceFor(batches.map(batch => batch.data), area)}
    }

    async function search(trip: TezWindow, filter: PackageQuery, mode: tAreaMode,
        options: {signal?: AbortSignal, refresh?: boolean, allowedDestinations?: readonly string[]} = {}) {
        const observed = await observe(trip, filter, mode, options.signal, options.refresh, options.allowedDestinations)
        const result = observed.index.search(filter, true)
        const unmapped = observed.index.findHotels({...filter, box: null}).filter(hotel => hotel.latitude == null || hotel.longitude == null)
        const known = [...new Map([...(result.knownHotels ?? []), ...unmapped].map(hotel => [hotel.id, hotel])).values()]
        const knownHotels = known.slice(0, knownMarkerLimit)
        return {...result, knownHotels, markersTruncated: result.markersTruncated || knownHotels.length < known.length,
            area: observed.area, source: observed.source, coverage: 'supplier-minima',
            direction: {...result.geo, total: result.total}} satisfies PackagePage
    }

    async function hotels(trip: TezWindow, filter: PackageQuery, term: string, mode: tAreaMode,
        options: {signal?: AbortSignal, refresh?: boolean, allowedDestinations?: readonly string[]} = {}) {
        if (term.length > 120) throw new RangeError('Название отеля должно быть не длиннее 120 символов.')
        const observed = await observe(trip, filter, mode, options.signal, options.refresh, options.allowedDestinations)
        const normalized = searchPhrase(term)
        const context = {...filter, term: normalized}
        const visible = observed.index.search({...context, offset: 0, limit: Infinity}).items
        const unmapped = observed.index.search({...context, box: null, offset: 0, limit: Infinity}).items
            .filter(hotel => hotel.latitude == null || hotel.longitude == null)
        const quoted = [...new Map([...visible, ...unmapped].map(hotel => [hotel.hotelId, hotel])).values()]
        const pricedIds = new Set(quoted.map(hotel => hotel.hotelId))
        const visibleKnown = observed.index.findHotels(context)
        const unknownKnown = observed.index.findHotels({...context, box: null}).filter(hotel => hotel.latitude == null || hotel.longitude == null)
        const known = [...new Map([...visibleKnown, ...unknownKnown].map(hotel => [hotel.id, hotel])).values()]
            .filter(hotel => !pricedIds.has(hotel.id))
        const entries = [...quoted.map(quote => ({quote, hotel: null})), ...known.map(hotel => ({quote: null, hotel}))]
        const end = filter.offset + filter.limit
        const page = entries.slice(filter.offset, end)
        return {term: normalized, items: page.flatMap(entry => entry.quote ? [entry.quote] : []),
            knownHotels: page.flatMap(entry => entry.hotel ? [entry.hotel] : []), total: entries.length,
            nextOffset: end < entries.length ? end : null, area: observed.area,
            coverage: 'supplier-minima', source: observed.source} satisfies PackageHotelSearch
    }

    async function trends(trip: TezWindow, filter: PackageQuery, mode: tAreaMode, ids: readonly string[] | undefined,
        signal?: AbortSignal, allowedDestinations?: readonly string[]) {
        const observed = await observe(trip, filter, mode, signal, false, allowedDestinations)
        const visible = observed.index.search(filter).markers
        const wanted = ids ? new Set(ids) : null
        const groups = new Map<string, string[]>()
        for (const hotel of visible) {
            if (wanted && !wanted.has(hotel.hotelId)) continue
            if (!hotel.destinationId) continue
            const group = groups.get(hotel.destinationId) ?? []
            group.push(hotel.hotelId)
            groups.set(hotel.destinationId, group)
        }
        const entries = await Promise.all([...groups].map(([destinationId, hotelIds]) => queue.add(
            () => deps.trends({...trip, destinationId}, hotelIds, signal))))
        signal?.throwIfAborted()
        return {coverage: 'regional-daily-minima', first: trip.first, last: trip.last, nights: trip.nights,
            adults: trip.adults, currency: 'EUR', area: observed.area,
            source: entries.length ? sourceFor(entries, observed.area) : observed.source,
            items: entries.flatMap(entry => entry.items)} satisfies PackageTrends
    }
    return {search, hotels, trends, select, health: snapshots.health}
}
