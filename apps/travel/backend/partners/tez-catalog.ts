import locationManifest from './tez-locations.json' with {type: 'json'}
import locationOverrides from './tez-location-overrides.json' with {type: 'json'}
import type {PackageCoordinateSource, PackageHotel} from '../../src/package-contract.ts'
import {tezHotelGallery, tezHotelMedia} from './tez-media.ts'

interface KnownLocation {
    destination: string
    id: number
    name?: string
    latitude: number
    longitude: number
    source: string
    checkedOn?: string
    precision?: PackageCoordinateSource['precision']
    identitySources?: string[]
    coordinateEvidenceUrl?: string
}

const manifest = locationManifest as {checkedOn: string, locations: KnownLocation[]}
const overrides = locationOverrides as {locations: KnownLocation[]}
const locations = new Map([...manifest.locations, ...overrides.locations].map(geo => [geo.destination + ':' + geo.id, geo]))
const byDestination = new Map<string, PackageHotel[]>()
const empty: readonly PackageHotel[] = Object.freeze([])

function knownHotel(geo: KnownLocation) {
    const id = 'tez:' + geo.id
    const name = (tezHotelGallery(id)?.name || geo.name || '').trim()
    const latitude = Number.isFinite(geo.latitude) && geo.latitude >= -90 && geo.latitude <= 90
    const longitude = Number.isFinite(geo.longitude) && geo.longitude >= -180 && geo.longitude <= 180
    const identity = Number.isSafeInteger(geo.id) && geo.id > 0 && Boolean(geo.destination)
    const position = latitude && longitude
    if (!name || !position || !identity) return null
    const rating = /\s([1-5])\s*\*\s*$/.exec(name)
    const evidence = [...(geo.identitySources ?? [])]
    if (geo.coordinateEvidenceUrl) evidence.push(geo.coordinateEvidenceUrl)
    const coordinateSource = {url: geo.source, checkedOn: geo.checkedOn ?? manifest.checkedOn,
        precision: geo.precision ?? 'hotel-marker', evidence} satisfies PackageCoordinateSource
    return {id, name, stars: rating ? Number(rating[1]) : null, latitude: geo.latitude, longitude: geo.longitude,
        url: 'https://www.tez-tour.com/hotel.html?id=' + geo.id, coordinateSource, ...tezHotelMedia(id)} satisfies PackageHotel
}

for (const geo of locations.values()) {
    const hotel = knownHotel(geo)
    if (!hotel) continue
    const hotels = byDestination.get(geo.destination) ?? []
    hotels.push(hotel)
    byDestination.set(geo.destination, hotels)
}
for (const hotels of byDestination.values()) Object.freeze(hotels)

// Property identity and photographs remain available independently of a trip's fares.
export function tezKnownHotels(destinationId: string): readonly PackageHotel[] {
    return byDestination.get(destinationId) ?? empty
}
