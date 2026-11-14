import type {SupplySource} from './supply-contract.ts'

export const packageTrendHotelLimit = 200

export interface PackageTrendPoint {
    departure: string
    total: number | null
    status: 'quoted' | 'not-returned' | 'unknown'
    checkedAt: string | null
}

export interface PackageHotelTrend {
    hotelId: string
    days: PackageTrendPoint[]
    minTotal: number | null
    maxTotal: number | null
}

export interface PackageTrends {
    coverage: 'regional-daily-minima'
    first: string
    last: string
    nights: number
    adults: number
    currency: 'EUR'
    source: SupplySource
    items: PackageHotelTrend[]
}
