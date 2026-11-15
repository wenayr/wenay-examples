import type {SupplyPhoto} from './supply-contract.ts'

export interface PackageHotelPhoto extends SupplyPhoto {
    // The exact image published by the supplier; a larger original is not assumed.
    sourceImageUrl: string
}

// Explicit supplier facts only; beach distance and long descriptions are never inferred.
export interface PackageHotelInformation {
    hotelId: string
    sourceUrl: string
    checkedOn: string
    website?: string
    facts: readonly {label: string, value: string}[]
}

export interface PackageHotelGallery {
    hotelId: string
    name: string
    hotelUrl: string
    checkedOn: string | null
    photos: readonly PackageHotelPhoto[]
    information?: PackageHotelInformation
}
