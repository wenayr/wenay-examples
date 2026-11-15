import type {SupplyDestination} from './supply-contract.ts'
import type {PackageHotel} from './package-contract.ts'

export type tPackageBounds = readonly [number, number, number, number]

export interface PackageArea {
    mode: 'map' | 'destination'
    bounds: tPackageBounds | null
    destinations: SupplyDestination[]
    coverage: 'connected-regions' | 'partial' | 'unsupported'
    description: string
}

/** Geographic identities known before any observation of the visitor's trip. */
export interface PackageMapHotels {
    area: PackageArea
    knownHotels: PackageHotel[]
    markersTruncated: boolean
}
