// Данные о размещении, актуальные тарифы и переходы к посредникам приходят разными типами.
export interface SupplyDestination {
    id: string
    name: string
    country: string
    latitude: number
    longitude: number
}

export interface SupplyPhoto {
    fileVersion?: string
    url: string
    sourceUrl: string
    credit: string
    license: string
    licenseUrl: string
}

export interface SupplyHotel {
    id: string
    name: string
    latitude: number
    longitude: number
    locality: string | null
    category: string | null
    sourceId: string
    commonsFile?: string | null
    wikidataId?: string | null
    sourceName: string
    sourceUrl: string
    website: string | null
    photo: SupplyPhoto | null
    price: null
}

export interface SupplySource {
    id: string
    name: string
    url?: string
    license?: string
    licenseUrl?: string
    attribution?: string
    status: 'live' | 'cached' | 'unavailable' | 'handoff' | 'requires-access'
    updatedAt: string | null
    retryAt?: string
    description: string
}

export interface SupplyCatalogPage {
    revision?: string
    destination: SupplyDestination
    sources: SupplySource[]
    items: SupplyHotel[]
    total: number
    nextOffset: number | null
}

export interface SupplyLink {
    id: string
    label: string
    url: string
    kind: 'search' | 'affiliate'
    scope: 'hotel' | 'destination'
}

export interface SupplyOffer {
    id: string
    label: string
    price: {total: number, currency: string}
    url: string
    providerId: string
    scope: 'hotel' | 'package'
    checkedAt: string
}

export interface SupplyOptions {
    links: SupplyLink[]
    offers: SupplyOffer[]
    sources: SupplySource[]
}
