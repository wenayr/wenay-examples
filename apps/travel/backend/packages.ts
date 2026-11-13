import {packageMaxTotal, type PackageCalendar, type PackageDay, type PackageHotel, type PackagePage} from '../src/package-contract.ts'
import type {SupplySource} from '../src/supply-contract.ts'
import {createOfferIndex} from './package-index.ts'
import {createTezInventory} from './partners/tez-inventory.ts'

type Provider = ReturnType<typeof createTezInventory>
type Trip = Parameters<Provider['window']>[0]
type Observation = Awaited<ReturnType<Provider['window']>>
type Filter = Parameters<ReturnType<typeof createOfferIndex>['search']>[0]

function prepare(observation: Observation) {
    const hotels = new Map<string, PackageHotel>()
    for (const quote of observation.quotes) {
        if (hotels.has(quote.hotelId)) continue
        const {hotelId: id, name, latitude, longitude, stars, url} = quote
        hotels.set(id, {id, name, latitude, longitude, stars, url})
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
    // Price data is short-lived. Reuse the prepared geography and price buckets while a
    // supplier observation is current. Page and viewport changes reuse the same result.
    const prepared = new Map<string, ReturnType<typeof prepare>>()
    function observed(key: string, data: Observation) {
        const generation = key + '/' + data.generation
        const cached = prepared.get(generation)
        if (cached) return cached
        const entry = prepare(data)
        if (prepared.size >= 96) prepared.delete(prepared.keys().next().value!)
        prepared.set(generation, entry)
        return entry
    }
    async function window(trip: Trip) {
        const data = await provider.window(trip)
        const key = JSON.stringify([trip.destinationId, trip.first, trip.last, trip.nights, trip.adults, trip.minTotal, trip.maxTotal])
        return {data, ...observed(key, data)}
    }
    async function search(trip: Trip, filter: Filter): Promise<PackagePage> {
        const batch = await window(trip)
        return {...batch.index.search(filter), source: batch.data.source, coverage: 'supplier-minima'}
    }
    async function calendar(trip: Trip, filter: Filter, hotelId: string, signal?: AbortSignal): Promise<PackageCalendar | null> {
        const batch = await window(trip)
        const hotel = batch.hotels.get(hotelId)
        if (!hotel) {
            if (batch.data.source.status == 'unavailable') throw new Error('Поставщик не ответил.')
            return null
        }
        const dates = datesFrom(trip.first, trip.last)
        const days: PackageDay[] = new Array(dates.length)
        let cursor = 0
        let anyLive = false
        async function loadDates() {
            while (cursor < dates.length) {
                signal?.throwIfAborted()
                const position = cursor++
                const date = dates[position]
                // A grouped window cannot establish the cheapest departure on each day.
                // Request all supplier variants for this exact hotel/date, then apply the visitor's budget.
                const data = await provider.day({...trip, minTotal: 0, maxTotal: packageMaxTotal}, hotelId, date)
                const key = JSON.stringify([trip.destinationId, hotelId, date, trip.nights, trip.adults])
                const {index} = observed(key, data)
                const [price] = index.calendar({...filter, firstDeparture: date, lastDeparture: date}, hotelId)
                let status: PackageDay['status'] = 'unknown'
                const successful = data.source.status == 'live' || data.source.status == 'cached'
                if (successful && data.complete) status = 'empty'
                if (price.lowest) status = 'quoted'
                if (data.source.status == 'live') anyLive = true
                days[position] = {...price, status, complete: data.complete, checkedAt: successful ? data.source.updatedAt : null}
            }
        }
        await Promise.all(Array.from({length: Math.min(dates.length, 3)}, loadDates))
        return {hotel, days, source: calendarSource(days, batch.data.source, anyLive)}
    }
    return {search, calendar}
}
