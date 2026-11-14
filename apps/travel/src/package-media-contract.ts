import type {SupplyPhoto} from './supply-contract.ts'

export interface PackageHotelPhoto extends SupplyPhoto {
    // The exact image published by the supplier; a larger original is not assumed.
    sourceImageUrl: string
}

export interface PackageHotelGallery {
    hotelId: string
    name: string
    hotelUrl: string
    checkedOn: string | null
    photos: readonly PackageHotelPhoto[]
}
