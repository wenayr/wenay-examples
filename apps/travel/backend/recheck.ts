import {matchesPackageHotel, type PackageQuery} from './package-index.ts'
import type {createTezInventory, TezWindow} from './partners/tez-inventory.ts'
import type {FareRecheck} from '../src/recheck-contract.ts'

export async function recheckFare(provider: ReturnType<typeof createTezInventory>, trip: TezWindow, filter: PackageQuery,
    hotelId: string, departure: string, fareId: string): Promise<FareRecheck> {
    const {byFareId, complete, source} = await provider.day(trip, hotelId, departure, true)
    const hotelUrl = 'https://www.tez-tour.com/hotel.html?id=' + hotelId.slice(4)
    if (source.status != 'live') return {status: 'unknown', source, hotelUrl, fare: null}
    // TEZ returns this single hotel's fares for a single day. IDs incorporate room, meal and quoted total.
    const quote = byFareId.get(fareId)
    if (!quote) return {status: complete ? 'unavailable' : 'unknown', source, hotelUrl, fare: null}
    const inBudget = quote.total >= filter.minTotal && quote.total <= filter.maxTotal
    if (!inBudget || !matchesPackageHotel(quote, filter)) return {status: 'unavailable', source, hotelUrl, fare: null}
    return {status: 'confirmed', source, hotelUrl, fare: {id: quote.id, departure: quote.departure, total: quote.total}}
}
