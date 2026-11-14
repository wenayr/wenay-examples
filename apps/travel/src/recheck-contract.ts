import type {PackageFare} from './package-contract.ts'
import type {SupplySource} from './supply-contract.ts'

export interface FareRecheck {
    status: 'confirmed' | 'unavailable' | 'unknown'
    fare: PackageFare | null
    source: SupplySource
    hotelUrl: string
}
