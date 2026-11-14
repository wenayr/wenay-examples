import type {SupplySource} from './supply-contract.ts'

export interface FlightQuery {
    origin: string
    destination: string
    departure: string
    returnDate: string | null
    adults: number
    checkedBag: boolean
}

/** Integer EUR cents. The reference median excludes this offer/date. */
export interface FlightBenchmark {median: number, count: number, saving: number}
export interface FlightSlice {origin: string, destination: string, departingAt: string, arrivingAt: string, stops: number}
export interface FlightOffer {
    id: string
    carrier: string
    total: number
    currency: 'EUR'
    slices: FlightSlice[]
    checkedBags: number | null
    expiresAt: string
    benchmark: FlightBenchmark | null
    providerId?: string
    providerName?: string
    sourceUrl?: string
    checkedAt?: string
    marketingCarriers?: string[]
    operatingCarriers?: string[]
    taxesIncluded?: boolean | null
    cabin?: 'economy'
    conditions?: string | null
    comparisonKey?: string | null
}
export interface FlightDay {
    departure: string
    perPerson: number
    direct: boolean | null
    sourceUrl: string
    benchmark: FlightBenchmark | null
}
export interface RouteQuote {
    total: number
    currency: 'EUR'
    checkedAt: string
    sourceUrl: string
    carrier: string | null
    description: string
    id?: string
    providerId?: string
    providerName?: string
    details?: {
        stops: number | null
        duration: string | null
        durationMinutes: number | null
        outbound: string | null
        checkedBags: number | null
        cabinBag: 'excluded' | 'unknown'
    }
}
export interface AirlineLink {
    id: string
    name: string
    iata: string
    country: string
    url: string
    queryApplied: 'full' | 'route' | 'none'
    description: string
}
export interface FlightCalendar {
    providerId: string
    providerName: string
    rows: FlightDay[]
    source: SupplySource
    basis: 'one-adult-one-way'
}
export interface FlightComparison {
    groups: {key: string, offerIds: string[], lowest: number, highest: number, saving: number}[]
    description: string
}
export interface FlightSearch {
    routeQuote: RouteQuote | null
    query: FlightQuery
    offers: FlightOffer[]
    sources: SupplySource[]
    links: {label: string, url: string, providerId?: string, kind?: 'search' | 'carrier'}[]
    calendar: FlightDay[]
    routeQuotes?: RouteQuote[]
    carrierLinks?: AirlineLink[]
    calendars?: FlightCalendar[]
    comparison?: FlightComparison
}
