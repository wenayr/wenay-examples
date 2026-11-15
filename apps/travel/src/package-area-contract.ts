import type {SupplyDestination} from './supply-contract.ts'

export type tPackageBounds = readonly [number, number, number, number]

export interface PackageArea {
    mode: 'map' | 'destination'
    bounds: tPackageBounds | null
    destinations: SupplyDestination[]
    coverage: 'connected-regions' | 'partial' | 'unsupported'
    description: string
}
