import type {PackageHotel, PackageSummary} from './package-contract.ts'
import type {PackageArea} from './package-area-contract.ts'
import type {SupplySource} from './supply-contract.ts'

export interface PackageHotelSearch {
    area?: PackageArea
    term: string
    items: PackageSummary[]
    knownHotels: PackageHotel[]
    total: number
    nextOffset: number | null
    coverage: 'supplier-minima'
    source: SupplySource
}
