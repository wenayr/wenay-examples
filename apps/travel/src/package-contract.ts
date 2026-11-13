import type {SupplySource} from './supply-contract.ts'

export const packageDestinations = ['hurghada', 'sharm', 'rhodes'] as const
export const packageWindowDays = 20
export const packageMaxTotal = 150_000_000

export interface PackageHotel {
    id: string
    name: string
    stars: number | null
    latitude: number | null
    longitude: number | null
    url: string
}

export interface PackageFare {
    id: string
    departure: string
    total: number
}

export interface PackageSummary extends Omit<PackageHotel, 'id'> {
    hotelId: string
    minTotal: number
    maxTotal: number
    best: PackageFare
}

export interface PackageMarker extends Pick<PackageSummary, 'hotelId' | 'name' | 'stars' | 'minTotal' | 'maxTotal'> {
    latitude: number
    longitude: number
}

export interface PackageSearchResults {
    items: PackageSummary[]
    markers: PackageMarker[]
    markersTruncated: boolean
    total: number
    nextOffset: number | null
}

export interface PackagePage extends PackageSearchResults {
    source: SupplySource
    coverage: 'supplier-minima'
}

export interface PackageDayPrices {
    departure: string
    lowest: PackageFare | null
    inBudget: PackageFare | null
    highest: PackageFare | null
}

export interface PackageDay extends PackageDayPrices {
    status: 'quoted' | 'empty' | 'unknown'
    complete: boolean
    checkedAt: string | null
}

export interface PackageCalendar {
    hotel: PackageHotel
    source: SupplySource
    days: PackageDay[]
}
