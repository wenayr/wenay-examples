import type {
    PackageDayPrices, PackageFare, PackageHotel, PackageMarker, PackageSearchResults, PackageSummary
} from '../src/package-contract.ts'
import {boundary, createRangeIndex, type IndexSlice} from './range-index.ts'

type DateBudget = {
    firstDeparture: string
    lastDeparture: string
    minTotal: number
    maxTotal: number
}
export interface PackageQuery extends DateBudget {
    box: readonly [number, number, number, number] | null
    minStars: number
    offset: number
    limit: number
}

type IndexedFare = PackageFare & {hotelId: string}
interface Observations {
    hotels: readonly PackageHotel[]
    offers: readonly IndexedFare[]
}
interface Match {
    hotel: PackageHotel
    best: PackageFare
    maxTotal: number
}
const markerLimit = 200

function fareOrder(a: PackageFare, b: PackageFare) {
    if (a.total != b.total) return a.total - b.total
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
function fareIndex(fares: readonly IndexedFare[]) {
    return createRangeIndex(fares, fare => fare.departure, fare => fare.total, fareOrder)
}
function prices(index: ReturnType<typeof fareIndex>, query: DateBudget) {
    return index(query.firstDeparture, query.lastDeparture, query.minTotal, query.maxTotal)
}
function count<T>(slices: readonly IndexSlice<T>[]) {
    return slices.reduce((total, slice) => total + slice.end - slice.start, 0)
}
function* points<T>(slices: readonly IndexSlice<T>[]) {
    for (const {entries, start, end} of slices) {
        for (let i = start; i < end; i++) yield entries[i]
    }
}
function located(hotel: PackageHotel): hotel is PackageHotel & {latitude: number, longitude: number} {
    return Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude)
}
export function matchesPackageHotel(hotel: PackageHotel, filter: Pick<PackageQuery, 'minStars' | 'box'>) {
    if ((hotel.stars ?? 0) < filter.minStars) return false
    if (!filter.box) return true
    const [west, south, east, north] = filter.box
    return located(hotel) && hotel.longitude >= west && hotel.longitude <= east && hotel.latitude >= south && hotel.latitude <= north
}

function publicFare({id, departure, total}: PackageFare): PackageFare { return {id, departure, total} }
function summary({hotel, best, maxTotal}: Match): PackageSummary {
    const {id, name, stars, latitude, longitude, url} = hotel
    return {hotelId: id, name, stars, latitude, longitude, url, best: publicFare(best), minTotal: best.total, maxTotal}
}

/** One immutable snapshot per supplier trip context and observed departure window. */
export function createOfferIndex(observations: Observations) {
    const hotels = new Map(observations.hotels.map(hotel => [hotel.id, {...hotel}]))
    const byHotel = new Map<string, IndexedFare[]>()
    const offers: IndexedFare[] = []
    for (const {id, hotelId, departure, total} of observations.offers) {
        if (!hotels.has(hotelId) || !Number.isSafeInteger(total) || total < 0) continue
        const fare = {id, hotelId, departure, total}
        offers.push(fare)
        const group = byHotel.get(hotelId)
        if (group) group.push(fare)
        else byHotel.set(hotelId, [fare])
    }
    const hotelPrices = new Map([...byHotel].map(([id, group]) => [id, fareIndex(group)]))
    const geoPoints = [...hotels.values()].filter(located)
    const geography = createRangeIndex(geoPoints, hotel => hotel.latitude, hotel => hotel.longitude)
    const allPrices = fareIndex(offers)
    const byStars = [...hotels.values()].sort((a, b) => (a.stars ?? 0) - (b.stars ?? 0))

    function search(query: PackageQuery): PackageSearchResults {
        const box = query.box
        const area = box && geography(box[1], box[3], box[0], box[2])
        const tariffs = prices(allPrices, query)
        const start = boundary(byStars, hotel => (hotel.stars ?? 0) < query.minStars)
        const stars = [{entries: byStars, start, end: byStars.length}]
        const candidates = area && count(area) < byStars.length - start ? area : stars
        const matches = new Map<string, Match>()
        function record(hotel: PackageHotel, cheapest: PackageFare, highest: number) {
            const current = matches.get(hotel.id)
            if (!current) matches.set(hotel.id, {hotel, best: cheapest, maxTotal: highest})
            else {
                if (fareOrder(cheapest, current.best) < 0) current.best = cheapest
                current.maxTotal = Math.max(current.maxTotal, highest)
            }
        }
        if (count(candidates) <= count(tariffs)) {
            for (const hotel of points(candidates)) {
                if (!matchesPackageHotel(hotel, query)) continue
                const index = hotelPrices.get(hotel.id)
                if (!index) continue
                for (const {entries, start, end} of prices(index, query)) {
                    record(hotel, entries[start], entries[end - 1].total)
                }
            }
        } else {
            for (const fare of points(tariffs)) {
                const hotel = hotels.get(fare.hotelId)!
                if (matchesPackageHotel(hotel, query)) record(hotel, fare, fare.total)
            }
        }
        const sorted = [...matches.values()].sort((a, b) => a.best.total - b.best.total || a.hotel.id.localeCompare(b.hotel.id))
        const markers: PackageMarker[] = []
        let markersTruncated = false
        for (const {hotel, best, maxTotal} of sorted) {
            if (!located(hotel)) continue
            if (markers.length == markerLimit) {
                markersTruncated = true
                break
            }
            markers.push({hotelId: hotel.id, name: hotel.name, latitude: hotel.latitude, longitude: hotel.longitude,
                stars: hotel.stars, minTotal: best.total, maxTotal})
        }
        const end = query.offset + query.limit
        const items = sorted.slice(query.offset, end).map(summary)
        return {items, total: sorted.length, markers, markersTruncated, nextOffset: end < sorted.length ? end : null}
    }

    function calendar(query: DateBudget, hotelId: string): PackageDayPrices[] {
        const index = hotelPrices.get(hotelId)
        const first = Date.parse(query.firstDeparture + 'T00:00:00Z')
        const last = Date.parse(query.lastDeparture + 'T00:00:00Z')
        const days: PackageDayPrices[] = []
        for (let day = first; day <= last; day += 86_400_000) {
            const departure = new Date(day).toISOString().slice(0, 10)
            // A single departure is one leaf, sorted by price and then fare ID.
            const entries = index?.(departure, departure, 0, Infinity)[0]?.entries ?? []
            const position = boundary(entries, fare => fare.total < query.minTotal)
            const inBudget = entries[position]
            days.push({departure, lowest: entries.length ? publicFare(entries[0]) : null,
                inBudget: inBudget && inBudget.total <= query.maxTotal ? publicFare(inBudget) : null,
                highest: entries.length ? publicFare(entries[entries.length - 1]) : null})
        }
        return days
    }
    return {search, calendar}
}
