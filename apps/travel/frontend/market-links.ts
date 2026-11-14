import type {ProviderQuery, tProviderKind} from '../src/provider-contract.ts'
import type {tMarketCountry} from '../src/market-contract.ts'
import {providerQueryFromParams, providerQueryLink} from './provider-client.ts'
import {validDate} from './directory-preferences.ts'

const contextFields = [
    'origin', 'destination', 'departure', 'returnDate', 'checkIn', 'checkOut', 'adults', 'rooms', 'nights',
    'checkedBag', 'currency', 'bookerCountry', 'nationality', 'adultAges', 'firstDeparture', 'lastDeparture',
] as const

export function marketContext(params: URLSearchParams) {
    const fields: Record<string, string> = {}
    for (const key of contextFields) {
        const value = params.get(key)
        if (value !== null) fields[key] = value
    }
    if (params.get('kind') == 'flights' && validDate(fields.departure)) {
        fields.checkIn = fields.departure
        if (validDate(fields.returnDate)) fields.checkOut = fields.returnDate
        else delete fields.checkOut
    }
    if (params.get('kind') == 'hotels' && validDate(fields.checkIn)) {
        fields.departure = fields.checkIn
        if (validDate(fields.checkOut)) fields.returnDate = fields.checkOut
    }
    return fields
}

export function marketSearchLink(country: tMarketCountry, kind: tProviderKind, params: URLSearchParams, details: {
    origin?: string, destination?: string, latitude?: number, longitude?: number, providerId?: string,
} = {}) {
    const initial = new URLSearchParams(marketContext(params))
    initial.set('kind', kind)
    const departure = initial.get('departure') || initial.get('checkIn') || initial.get('firstDeparture')
    if (validDate(departure)) {
        initial.set('departure', departure)
        if (!validDate(initial.get('checkIn'))) initial.set('checkIn', departure)
    }
    const checkOut = initial.get('checkOut')
    const returnDate = initial.get('returnDate')
    if (!validDate(returnDate) && validDate(checkOut)) initial.set('returnDate', checkOut)
    if (!validDate(checkOut) && validDate(returnDate)) initial.set('checkOut', returnDate)
    const context = providerQueryFromParams(initial, kind)
    const query: ProviderQuery = {
        kind, adults: context.adults, currency: context.currency,
        nationality: context.nationality, bookerCountry: context.bookerCountry, adultAges: context.adultAges,
        checkedBag: context.checkedBag,
    }
    if (/^[A-Z]{3}$/.test(context.origin ?? '')) query.origin = context.origin
    if (kind != 'flights') query.country = country
    if (kind == 'hotels') {
        Object.assign(query, {destination: details.destination, latitude: details.latitude, longitude: details.longitude,
            checkIn: context.checkIn, checkOut: context.checkOut, rooms: context.rooms ?? 1, radiusKm: 15})
    } else {
        const origin = /^[A-Z]{3}$/.test(context.origin ?? '') ? context.origin : undefined
        Object.assign(query, {origin: details.origin ?? origin, departure: context.departure,
            returnDate: context.returnDate, nights: context.nights})
        if (kind == 'flights') {
            query.destination = details.destination ?? (/^[A-Z]{3}$/.test(context.destination ?? '') ? context.destination : undefined)
        } else {
            query.destination = details.destination
        }
    }
    if (details.providerId) query.providers = [details.providerId]
    return providerQueryLink(query)
}
