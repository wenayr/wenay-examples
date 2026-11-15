import {packageRegionDefinitions, type TezRegion} from '../../src/package-regions.ts'
import {searchPhrase} from '../catalog-text.ts'
import type {PackageHotel} from '../../src/package-contract.ts'

interface RegionReference {
    name: string
    tourId: number[]
    fromCityId: number[]
}
interface HotelReference {tourId: number, hotelId: number, name: string}
type tDefinition = {countryId: string, regionId?: string, tourName?: string}
const definitions: Readonly<Record<string, tDefinition>> = packageRegionDefinitions
const referenceEndpoint = 'https://search.tezapi.eu/tariffsearch/regions'

export function createTezRegions(deps: {fetch: typeof fetch, now: () => Date}) {
    const cache = new Map<string, {tours: RegionReference[], until: number}>()
    const inflight = new Map<string, Promise<RegionReference[]>>()
    const hotelCache = new Map<string, {hotels: HotelReference[], until: number}>()
    const pendingHotels = new Map<string, Promise<HotelReference[]>>()
    async function country(countryId: string) {
        const cached = cache.get(countryId)
        if (cached && cached.until > deps.now().getTime()) return cached.tours
        const pending = inflight.get(countryId)
        if (pending) return pending
        async function readCountry() {
            const params = new URLSearchParams({cityId: '3746', countryId, locale: 'en'})
            try {
                const response = await deps.fetch(referenceEndpoint + '?' + params, {signal: AbortSignal.timeout(10_000), redirect: 'error'})
                if (!response.ok) throw new Error('Reference unavailable')
                const payload = await response.json() as {success?: boolean, tours?: RegionReference[]}
                if (payload.success != true || !Array.isArray(payload.tours)) throw new Error('Reference not confirmed')
                const tours = payload.tours.filter(tour => typeof tour.name == 'string' && Array.isArray(tour.tourId)
                    && Array.isArray(tour.fromCityId))
                if (!cache.has(countryId) && cache.size >= 32) cache.delete(cache.keys().next().value!)
                cache.set(countryId, {tours, until: deps.now().getTime() + 24 * 60 * 60_000})
                return tours
            } catch {
                cache.set(countryId, {tours: [], until: deps.now().getTime() + 10_000})
                return []
            } finally {
                inflight.delete(countryId)
            }
        }
        const work = readCountry()
        inflight.set(countryId, work)
        return work
    }
    async function resolve(destinationId: string, signal?: AbortSignal): Promise<TezRegion | null> {
        signal?.throwIfAborted()
        const definition = definitions[destinationId]
        if (!definition) return null
        if (definition.regionId) return {countryId: definition.countryId, regionId: definition.regionId}
        const tours = await country(definition.countryId)
        signal?.throwIfAborted()
        const wanted = searchPhrase(definition.tourName ?? '')
        const tour = tours.find(item => searchPhrase(item.name) == wanted && item.fromCityId.includes(3746))
        if (!tour) return null
        const position = tour.fromCityId.indexOf(3746)
        const id = tour.tourId.length == 1 ? tour.tourId[0] : tour.tourId[position]
        if (!Number.isSafeInteger(id) || id <= 0) return null
        return {countryId: definition.countryId, regionId: String(id)}
    }
    async function countryHotels(countryId: string) {
        const cached = hotelCache.get(countryId)
        if (cached && cached.until > deps.now().getTime()) return cached.hotels
        const waiting = pendingHotels.get(countryId)
        if (waiting) return waiting
        async function readHotels() {
            const params = new URLSearchParams({cityId: '3746', countryId, locale: 'en'})
            try {
                const response = await deps.fetch('https://search.tezapi.eu/tariffsearch/hotels?' + params,
                    {signal: AbortSignal.timeout(10_000), redirect: 'error'})
                if (!response.ok) throw new Error('Hotel reference unavailable')
                const payload = await response.json() as {success?: boolean, hotels?: HotelReference[]}
                if (payload.success != true || !Array.isArray(payload.hotels)) throw new Error('Hotel reference not confirmed')
                const hotels = payload.hotels.filter(hotel => Number.isSafeInteger(hotel.hotelId) && hotel.hotelId > 0
                    && Number.isSafeInteger(hotel.tourId) && typeof hotel.name == 'string' && Boolean(hotel.name.trim()))
                if (!hotelCache.has(countryId) && hotelCache.size >= 32) hotelCache.delete(hotelCache.keys().next().value!)
                hotelCache.set(countryId, {hotels, until: deps.now().getTime() + 24 * 60 * 60_000})
                return hotels
            } catch {
                hotelCache.set(countryId, {hotels: [], until: deps.now().getTime() + 10_000})
                return []
            } finally {
                pendingHotels.delete(countryId)
            }
        }
        const work = readHotels()
        pendingHotels.set(countryId, work)
        return work
    }
    async function hotels(destinationId: string, signal?: AbortSignal): Promise<PackageHotel[]> {
        const region = await resolve(destinationId, signal)
        if (!region) return []
        const references = await countryHotels(region.countryId)
        signal?.throwIfAborted()
        return references.filter(hotel => hotel.tourId == Number(region.regionId)).map(function publicHotel(hotel) {
            const rating = /\s([1-5])\s*\*\s*$/.exec(hotel.name)
            return {id: 'tez:' + hotel.hotelId, destinationId, name: hotel.name.trim(), stars: rating ? Number(rating[1]) : null,
                latitude: null, longitude: null, url: 'https://www.tez-tour.com/hotel.html?id=' + hotel.hotelId}
        })
    }
    return {resolve, hotels}
}
