import type {
    PackageDayPrices, PackageFare, PackageHotel, PackageMarker, PackageSearchResults, PackageSummary
} from '../src/package-contract.ts'

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

interface Observations {
    hotels: readonly PackageHotel[]
    offers: readonly (PackageFare & {hotelId: string})[]
}
interface IndexedHotel {
    details: PackageHotel
    faresByDay: Map<string, PackageFare[]>
    departures: string[]
}
interface Match {
    hotel: PackageHotel
    best: PackageFare
    maxTotal: number
}

const markerLimit = 200

/** First index where the predicate stops holding in a sorted array. */
function boundary<T>(values: readonly T[], before: (value: T) => boolean) {
    let left = 0
    let right = values.length
    while (left < right) {
        const middle = Math.floor((left + right) / 2)
        if (before(values[middle])) left = middle + 1
        else right = middle
    }
    return left
}

function compareFares(a: PackageFare, b: PackageFare) {
    if (a.total != b.total) return a.total - b.total
    if (a.id == b.id) return 0
    return a.id < b.id ? -1 : 1
}

function firstInBudget(fares: readonly PackageFare[], budget: DateBudget) {
    const first = boundary(fares, fare => fare.total < budget.minTotal)
    const fare = fares[first]
    return fare && fare.total <= budget.maxTotal ? fare : null
}

function makeHotelIndex({hotels, offers}: Observations) {
    const byId = new Map<string, IndexedHotel>()
    for (const hotel of hotels) {
        byId.set(hotel.id, {details: {...hotel}, faresByDay: new Map(), departures: []})
    }
    for (const {id, hotelId, departure, total} of offers) {
        const hotel = byId.get(hotelId)
        if (!hotel || !Number.isSafeInteger(total) || total < 0) continue
        let day = hotel.faresByDay.get(departure)
        if (!day) {
            day = []
            hotel.faresByDay.set(departure, day)
            hotel.departures.push(departure)
        }
        day.push(Object.freeze({id, departure, total}))
    }
    for (const hotel of byId.values()) {
        hotel.departures.sort()
        for (const day of hotel.faresByDay.values()) day.sort(compareFares)
    }
    return byId
}

function axisIndex(hotels: Iterable<IndexedHotel>, axis: 'latitude' | 'longitude') {
    const points: {coordinate: number, hotel: IndexedHotel}[] = []
    for (const hotel of hotels) {
        const {latitude, longitude} = hotel.details
        if (latitude == null || longitude == null) continue
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
        points.push({coordinate: axis == 'latitude' ? latitude : longitude, hotel})
    }
    return points.sort((a, b) => a.coordinate - b.coordinate)
}

function axisRange(points: ReturnType<typeof axisIndex>, min: number, max: number) {
    const start = boundary(points, point => point.coordinate < min)
    const end = boundary(points, point => point.coordinate <= max)
    return {points, start, end}
}

function* inBox(
    box: NonNullable<PackageQuery['box']>, latitudes: ReturnType<typeof axisIndex>, longitudes: ReturnType<typeof axisIndex>
) {
    const [west, south, east, north] = box
    const lat = axisRange(latitudes, south, north)
    const lon = axisRange(longitudes, west, east)
    const alongLatitude = lat.end - lat.start < lon.end - lon.start
    const {points, start, end} = alongLatitude ? lat : lon
    for (let cursor = start; cursor < end; cursor++) {
        const {hotel} = points[cursor]
        const coordinate = alongLatitude ? hotel.details.longitude! : hotel.details.latitude!
        const inside = alongLatitude ? coordinate >= west && coordinate <= east : coordinate >= south && coordinate <= north
        if (inside) yield hotel
    }
}

function priceRange(hotel: IndexedHotel, query: DateBudget): Match | null {
    const start = boundary(hotel.departures, date => date < query.firstDeparture)
    let best: PackageFare | null = null
    let maxTotal = 0
    for (let i = start; i < hotel.departures.length; i++) {
        const date = hotel.departures[i]
        if (date > query.lastDeparture) break
        const fares = hotel.faresByDay.get(date)!
        const first = firstInBudget(fares, query)
        if (!first) continue
        if (!best || compareFares(first, best) < 0) best = first
        const end = boundary(fares, fare => fare.total <= query.maxTotal)
        maxTotal = Math.max(maxTotal, fares[end - 1].total)
    }
    return best ? {hotel: hotel.details, best, maxTotal} : null
}

function summary({hotel, best, maxTotal}: Match): PackageSummary {
    const {id, name, stars, latitude, longitude, url} = hotel
    return {hotelId: id, name, stars, latitude, longitude, url, best, minTotal: best.total, maxTotal}
}

/** One immutable snapshot per supplier trip context and observed departure window. */
export function createOfferIndex(observations: Observations) {
    const byId = makeHotelIndex(observations)
    const latitudes = axisIndex(byId.values(), 'latitude')
    const longitudes = axisIndex(byId.values(), 'longitude')

    function search(query: PackageQuery): PackageSearchResults {
        const candidates = query.box ? inBox(query.box, latitudes, longitudes) : byId.values()
        const matches: Match[] = []
        for (const hotel of candidates) {
            if ((hotel.details.stars ?? 0) < query.minStars) continue
            const match = priceRange(hotel, query)
            if (match) matches.push(match)
        }
        matches.sort((a, b) => a.best.total - b.best.total || a.hotel.id.localeCompare(b.hotel.id))
        const markers: PackageMarker[] = []
        let markersTruncated = false
        for (const {hotel, best, maxTotal} of matches) {
            const {id, name, latitude, longitude, stars} = hotel
            if (latitude == null || longitude == null) continue
            if (markers.length == markerLimit) {
                markersTruncated = true
                break
            }
            markers.push({hotelId: id, name, latitude, longitude, stars, minTotal: best.total, maxTotal})
        }
        const end = query.offset + query.limit
        const items = matches.slice(query.offset, end).map(summary)
        const total = matches.length
        return {items, total, markers, markersTruncated, nextOffset: end < total ? end : null}
    }

    function calendar(query: DateBudget, hotelId: string): PackageDayPrices[] {
        const hotel = byId.get(hotelId)
        const first = Date.parse(query.firstDeparture + 'T00:00:00Z')
        const last = Date.parse(query.lastDeparture + 'T00:00:00Z')
        const days: PackageDayPrices[] = []
        for (let day = first; day <= last; day += 86_400_000) {
            const departure = new Date(day).toISOString().slice(0, 10)
            const fares = hotel?.faresByDay.get(departure)
            const lowest = fares?.[0] ?? null
            const highest = fares?.at(-1) ?? null
            const inBudget = fares ? firstInBudget(fares, query) : null
            days.push({departure, lowest, highest, inBudget})
        }
        return days
    }
    return {search, calendar}
}
