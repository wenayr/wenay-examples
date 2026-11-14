import type {PackageHotel, PackageMarker, PackageSummary} from '../src/package-contract.ts'

export type tPackageHotel = PackageHotel | PackageMarker | PackageSummary

export function packageHotelId(hotel: tPackageHotel) {
    return 'id' in hotel ? hotel.id : hotel.hotelId
}
