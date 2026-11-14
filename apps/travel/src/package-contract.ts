import type {SupplyPhoto, SupplySource} from './supply-contract.ts'

export const packageDestinations = ['hurghada', 'sharm', 'rhodes'] as const
export const packageWindowDays = 20
export const packageMaxTotal = 150_000_000

export const packageCoordinatePrecisions = {
    'hotel-marker': 'Метка отеля в источнике',
    'hotel-complex': 'Территория гостиничного комплекса',
    'supplier-map-marker': 'Метка на карте продавца'
} as const

export interface PackageCoordinateSource {
    url: string
    checkedOn: string
    precision: keyof typeof packageCoordinatePrecisions
    evidence?: readonly string[]
}

export interface PackageHotel {
    id: string
    name: string
    stars: number | null
    latitude: number | null
    longitude: number | null
    url: string
    coordinateSource?: PackageCoordinateSource
    photo?: SupplyPhoto | null
    photos?: readonly SupplyPhoto[]
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

export interface PackageMarker extends Pick<PackageSummary, 'hotelId' | 'name' | 'stars' | 'minTotal' | 'maxTotal' | 'coordinateSource' | 'photo'> {
    latitude: number
    longitude: number
}

export interface PackageSearchResults {
    items: PackageSummary[]
    markers: PackageMarker[]
    markersTruncated: boolean
    total: number
    nextOffset: number | null
    geo: {
        mapped: number
        unresolved: number
        bounds: readonly [number, number, number, number] | null
    }
}

export interface PackagePage extends PackageSearchResults {
    source: SupplySource
    coverage: 'supplier-minima'
    direction: PackageSearchResults['geo'] & {total: number}
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

export const packageComparisonLimit = 3

export interface PackageComparisonItem {
    hotelId: string
    hotel: PackageHotel | null
    day: PackageDay
    source: SupplySource
    status: 'in-budget' | 'outside-budget' | 'empty' | 'unknown' | 'filtered'
}

export interface PackageComparison {
    departure: string
    items: PackageComparisonItem[]
}
