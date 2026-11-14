import {
    packageComparisonLimit, packageMaxTotal, type PackageCalendar, type PackageComparison, type PackageComparisonItem,
    type PackageDay, type PackageHotel, type PackagePage
} from '../src/package-contract.ts'
import type {SupplySource} from '../src/supply-contract.ts'
import {recheckFare} from './recheck.ts'
import {createOfferIndex, matchesPackageHotel} from './package-index.ts'
import {createTezInventory} from './partners/tez-inventory.ts'
import {createPackageTrends} from './package-trends.ts'
import {createPackageMatrix} from './package-matrix.ts'
import {tezHotelMedia} from './partners/tez-media.ts'

type Provider = ReturnType<typeof createTezInventory>
type Trip = Parameters<Provider['window']>[0]
type Observation = Awaited<ReturnType<Provider['window']>>
type Filter = Parameters<ReturnType<typeof createOfferIndex>['search']>[0]

function prepare(observation: Observation) {
    const hotels = new Map<string, PackageHotel>()
    for (const quote of observation.quotes) {
        if (hotels.has(quote.hotelId)) continue
        const {hotelId: id, name, latitude, longitude, stars, url, coordinateSource} = quote
        hotels.set(id, {id, name, latitude, longitude, stars, url, coordinateSource, ...tezHotelMedia(id)})
    }
    const index = createOfferIndex({hotels: [...hotels.values()], offers: observation.quotes})
    return {hotels, index}
}

function datesFrom(first: string, last: string) {
    const dates: string[] = []
    for (let time = Date.parse(first); time <= Date.parse(last); time += 86_400_000) {
        dates.push(new Date(time).toISOString().slice(0, 10))
    }
    return dates
}

function calendarSource(days: PackageDay[], original: SupplySource, anyLive: boolean): SupplySource {
    const checked = days.filter(day => day.checkedAt).map(day => day.checkedAt!)
    const failures = days.filter(day => day.status == 'unknown').length
    if (checked.length == 0) return {...original, status: 'unavailable', updatedAt: null, description: 'Поставщик не подтвердил цены по выбранным датам.'}
    let description = 'Поставщик ответил по каждой дате вылета. Время проверки указано у дня.'
    if (failures) description = 'Проверено дат: ' + (days.length - failures) + ' из ' + days.length + '.'
    else if (days.some(day => !day.complete)) description = 'По части дат поставщик вернул ограниченный набор тарифов. Показаны цены из его ответа.'
    return {...original, status: anyLive ? 'live' : 'cached', updatedAt: checked.sort()[0], description}
}

export function createPackages(provider: Provider = createTezInventory({fetch, now: () => new Date()})) {
    const dailyTrends = createPackageTrends({provider})
    // Price data is short-lived. Reuse the prepared geography and price buckets while a
    // supplier observation is current. Page and viewport changes reuse the same result.
    const prepared = new Map<string, ReturnType<typeof prepare>>()
    // A successful supplier observation establishes a property identity for later empty-day responses.
    // Prices and availability always come from the distinct observation for the selected trip and day.
    const knownHotels = new Map<string, PackageHotel>()
    const priceMatrix = createPackageMatrix({provider,
        knownHotel: (destination, id) => knownHotels.has(destination + '/' + id) || Boolean(tezHotelMedia(id).photo)})
    function remember(destination: string, hotels: Map<string, PackageHotel>) {
        for (const [id, hotel] of hotels) {
            const key = destination + '/' + id
            if (!knownHotels.has(key) && knownHotels.size >= 2048) knownHotels.delete(knownHotels.keys().next().value!)
            knownHotels.set(key, hotel)
        }
    }
    function observed(destination: string, key: string, data: Observation) {
        const generation = key + '/' + data.generation
        const cached = prepared.get(generation)
        if (cached) return cached
        const entry = prepare(data)
        remember(destination, entry.hotels)
        if (prepared.size >= 96) prepared.delete(prepared.keys().next().value!)
        prepared.set(generation, entry)
        return entry
    }
    async function window(trip: Trip, signal?: AbortSignal) {
        const data = await provider.window(trip, signal)
        const key = JSON.stringify([trip.destinationId, trip.first, trip.last, trip.nights, trip.adults, trip.minTotal, trip.maxTotal])
        return {data, ...observed(trip.destinationId, key, data)}
    }
    async function search(trip: Trip, filter: Filter): Promise<PackagePage> {
        const batch = await window(trip)
        const result = batch.index.search(filter)
        const direction = filter.box ? batch.index.search({...filter, box: null, offset: 0, limit: 0}) : result
        return {...result, source: batch.data.source, coverage: 'supplier-minima', direction: {total: direction.total, ...direction.geo}}
    }
    async function trends(trip: Trip, filter: Filter, hotelIds?: readonly string[], signal?: AbortSignal) {
        signal?.throwIfAborted()
        const batch = await window(trip)
        signal?.throwIfAborted()
        const ids = hotelIds ?? batch.index.search(filter).markers.map(marker => marker.hotelId)
        return dailyTrends.read(trip, ids, signal)
    }
    async function dayQuote(trip: Trip, filter: Filter, hotelId: string, departure: string, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const data = await provider.day({...trip, minTotal: 0, maxTotal: packageMaxTotal}, hotelId, departure, false, signal)
        signal?.throwIfAborted()
        const key = JSON.stringify([trip.destinationId, hotelId, departure, trip.nights, trip.adults])
        const batch = observed(trip.destinationId, key, data)
        const hotel = batch.hotels.get(hotelId) ?? knownHotels.get(trip.destinationId + '/' + hotelId) ?? null
        const successful = data.source.status == 'live' || data.source.status == 'cached'
        const accepted = hotel && matchesPackageHotel(hotel, filter)
        const blank = {departure, lowest: null, inBudget: null, highest: null}
        const price = accepted ? batch.index.calendar({...filter, firstDeparture: departure, lastDeparture: departure}, hotelId)[0] : blank
        const complete = Boolean(accepted && successful && data.complete)
        let dayStatus: PackageDay['status'] = 'unknown'
        if (price.lowest) dayStatus = 'quoted'
        else if (complete) dayStatus = 'empty'
        const day: PackageDay = {...price, complete, checkedAt: successful ? data.source.updatedAt : null, status: dayStatus}
        let status: PackageComparisonItem['status'] = 'unknown'
        if (hotel && !accepted) status = 'filtered'
        else if (day.inBudget) status = 'in-budget'
        else if (complete) status = day.lowest ? 'outside-budget' : 'empty'
        return {hotelId, hotel, day, status, source: data.source} satisfies PackageComparisonItem
    }

    async function compare(trip: Trip, filter: Filter, hotelIds: readonly string[], departure: string, signal?: AbortSignal): Promise<PackageComparison> {
        if (!hotelIds.length || hotelIds.length > packageComparisonLimit || new Set(hotelIds).size != hotelIds.length
            || !hotelIds.every(id => /^tez:[1-9]\d{0,14}$/.test(id))) throw new RangeError('Выберите до трёх разных отелей TEZ.')
        const time = Date.parse(departure + 'T00:00:00Z')
        if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) != departure
            || departure < trip.first || departure > trip.last) throw new RangeError('Выберите дату вылета внутри периода поездки.')
        const items = await Promise.all(hotelIds.map(id => dayQuote(trip, filter, id, departure, signal)))
        return {departure, items}
    }

    async function calendar(trip: Trip, filter: Filter, hotelId: string, signal?: AbortSignal): Promise<PackageCalendar | null> {
        const batch = await window(trip, signal)
        const hotel = batch.hotels.get(hotelId) ?? knownHotels.get(trip.destinationId + '/' + hotelId)
        if (!hotel) {
            if (batch.data.source.status == 'unavailable') throw new Error('Поставщик не ответил.')
            return null
        }
        if (!matchesPackageHotel(hotel, filter)) return null
        const dates = datesFrom(trip.first, trip.last)
        const days: PackageDay[] = new Array(dates.length)
        let cursor = 0
        let anyLive = false
        async function loadDates() {
            while (cursor < dates.length) {
                const position = cursor++
                const result = await dayQuote(trip, filter, hotelId, dates[position], signal)
                days[position] = result.day
                if (result.source.status == 'live') anyLive = true
            }
        }
        await Promise.all(Array.from({length: Math.min(dates.length, 3)}, loadDates))
        return {hotel, days, source: calendarSource(days, batch.data.source, anyLive)}
    }
    function recheck(trip: Trip, filter: Filter, hotelId: string, departure: string, fareId: string) {
        return recheckFare(provider, trip, filter, hotelId, departure, fareId)
    }
    return {search, calendar, compare, recheck, trends, matrix: priceMatrix.read}
}
