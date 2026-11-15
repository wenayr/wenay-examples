import type {PackageHotel, PackageMarker, PackagePage, PackageSummary} from '../src/package-contract.ts'
import type {tPackageBounds} from '../src/package-area-contract.ts'

export type tPackageHotel = PackageHotel | PackageMarker | PackageSummary

export function packageHotelId(hotel: tPackageHotel) {
    return 'id' in hotel ? hotel.id : hotel.hotelId
}

export function insideMapBounds(point: Pick<PackageHotel, 'latitude' | 'longitude'>, bounds: tPackageBounds | null) {
    if (point.latitude == null || point.longitude == null) return false
    if (!bounds) return true
    const longitude = point.longitude >= bounds[0] && point.longitude <= bounds[2]
    const latitude = point.latitude >= bounds[1] && point.latitude <= bounds[3]
    return longitude && latitude
}

export function hotelsInMapArea(catalog: readonly PackageHotel[], quotes: Pick<PackagePage, 'knownHotels' | 'markers'> | undefined,
    bounds: tPackageBounds | null) {
    const hotels = new Map<string, tPackageHotel>()
    for (const hotel of [...catalog, ...(quotes?.knownHotels ?? [])]) {
        if (insideMapBounds(hotel, bounds)) hotels.set(hotel.id, hotel)
    }
    for (const marker of quotes?.markers ?? []) {
        if (!insideMapBounds(marker, bounds)) continue
        const hotel = hotels.get(marker.hotelId)
        hotels.set(marker.hotelId, {...hotel, ...marker, photo: marker.photo ?? hotel?.photo})
    }
    return hotels
}

export function mapPriceStatus(points: readonly {id: string, priceTotal?: number}[], page: Pick<PackagePage, 'markers' | 'source'> | undefined,
    updating: boolean, error?: string) {
    const priced = points.filter(point => point.priceTotal != null)
    if (!points.length) return null
    if (!priced.length) {
        if (!page && !error && updating) return {label: 'Проверяем цены…'}
        if (error || page?.source.status == 'unavailable') return {label: 'Цены пока не подтверждены'}
        return page ? {label: 'Цены на выбранные даты не получены'} : null
    }
    const label = 'С ценой · ' + priced.length + ' из ' + points.length
    const fromBuffer = error || page?.source.stale || page?.source.retryAt
    if (!fromBuffer || !page?.source.updatedAt) return {label}
    const amounts = new Map(priced.map(point => [point.id, point.priceTotal]))
    const showsSnapshot = page.markers.some(marker => amounts.get(marker.hotelId) == marker.minTotal)
    return {label, savedAt: showsSnapshot ? page.source.updatedAt : undefined}
}
