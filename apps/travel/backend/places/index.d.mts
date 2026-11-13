export interface PlaceSource {
    id: string
    name: string
    url: string
    license: string
    licenseUrl: string
}
export interface PlaceDestination {
    id: string
    name: string
    country: string
    latitude: number
    longitude: number
    bbox: [number, number, number, number]
    sourceIds: string[]
}
export interface ReferencePlace {
    id: string
    destinationId: string
    name: string
    latitude: number
    longitude: number
    category: string
    locality: string
    sourceId: string
    sourceName: string
    sourceUrl: string
    registrationId: string | null
    commonsFile?: string | null
    wikidataId: string | null
    website: string | null
    price: null
    photo: null
}
export interface PlaceSnapshot {
    sourceId: string
    partial?: boolean
    records: ReferencePlace[]
    fetchedAt: string | null
}

export const placeSources: PlaceSource[]
export const placeDestinations: PlaceDestination[]
export function readPlaceSnapshot(destinationId: string, sourceId: string): PlaceSnapshot
export function snapshotPath(destinationId: string, sourceId: string): URL
export function encodePlaceSnapshot(snapshot: PlaceSnapshot): string
export function refreshPlaceDestination(
    destinationId: string, sourceId: string, options?: {fetchImpl?: typeof fetch, signal?: AbortSignal},
): Promise<PlaceSnapshot>

export function runtimeSnapshotDirectory(): string
export function snapshotRegion(filename: string): {destinationId: string, sourceId: string} | null
export function savePlaceSnapshot(destinationId: string, snapshot: PlaceSnapshot): PlaceSnapshot
export const refreshAndSavePlaceDestination: typeof refreshPlaceDestination
