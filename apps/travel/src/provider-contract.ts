import type {MarketNotice} from './market-contract.ts'

export const providerKinds = ['flights', 'hotels', 'packages', 'deals'] as const
export type tProviderKind = typeof providerKinds[number]
export type tProviderStatus = 'ready' | 'live' | 'cached' | 'sandbox' | 'requires-access' | 'unavailable' | 'unsupported-query' | 'handoff'

export interface ProviderQuery {
    kind: tProviderKind
    origin?: string
    destination?: string
    departure?: string
    returnDate?: string | null
    checkIn?: string
    checkOut?: string
    adults: number
    adultAges?: number[]
    rooms?: number
    nights?: number
    checkedBag?: boolean
    currency?: string
    latitude?: number
    longitude?: number
    radiusKm?: number
    nationality?: string
    bookerCountry?: string
    country?: string
    providerRefs?: Record<string, {hotelIds?: string[], destinationId?: string}>
    providers?: string[]
    limit?: number
    offset?: number
}

export interface ProviderDefinition {
    id: string
    name: string
    website: string
    docsUrl: string
    kinds: readonly tProviderKind[]
    description: string
    requiredEnv: readonly string[]
    optionalEnv?: readonly string[]
    activation: string
    queryFields: readonly string[]
    access?: 'public' | 'partner' | 'retired'
    onboarding?: 'self-service' | 'partner-contract' | 'paused' | 'closed'
    environment?: 'production' | 'sandbox' | 'both'
}

export interface ProviderDeal {
    kind: 'supplier-sale' | 'observed-saving'
    description: string
    evidenceUrl: string
    expiresAt: string | null
    referenceAmount?: number
}

export interface ProviderOffer {
    id: string
    providerId: string
    kind: tProviderKind
    title: string
    price: {amount: number, currency: string, basis: 'party' | 'person' | 'room-night', type?: 'retail' | 'net' | 'unknown'}
    accuracy: 'live-offer' | 'published-from' | 'cached-indicative'
    sourceUrl: string
    bookingUrl?: string | null
    checkedAt: string
    expiresAt: string | null
    departure?: string
    returnDate?: string | null
    checkIn?: string
    checkOut?: string
    adults?: number
    origin?: string
    nights?: number
    destination?: {name: string, country: string, countryCode?: string}
    hotel?: {id: string, name: string, latitude?: number, longitude?: number, stars?: number | null}
    flight?: {origin: string, destination: string, carrier: string | null, stops: number | null, durationMinutes: number | null}
    media?: {url: string, sourceUrl: string, credit?: string, license?: string}[]
    includes: {checkedBags: number | null, taxes: boolean | null, board?: string | null, refundable?: boolean | null}
    conditions: string | null
    comparisonKey: string | null
    deal?: ProviderDeal | null
}

export interface ProviderResult {
    providerId: string
    status: tProviderStatus
    offers: ProviderOffer[]
    checkedAt: string | null
    description: string
    sourceUrl?: string
    environment?: 'production' | 'sandbox'
    total?: number | null
    nextOffset?: number | null
    partial?: boolean
}

export interface ProviderDeps {
    fetch: typeof fetch
    now: () => Date
    env: Record<string, string | undefined>
}

export interface ProviderAdapter {
    search: (query: ProviderQuery, deps: ProviderDeps) => Promise<ProviderResult>
}

export interface ProviderRegistration {
    definition: ProviderDefinition
    load: () => Promise<ProviderAdapter>
}

export interface ProviderAvailability extends ProviderDefinition {
    status: tProviderStatus
    configured: boolean
    enabled: boolean
    missingEnv: string[]
    activeEnvironment: 'production' | 'sandbox'
    lastResult?: Omit<ProviderResult, 'offers'> & {offerCount: number}
}

export interface ProviderSearch {
    query: ProviderQuery
    offers: ProviderOffer[]
    results: ProviderResult[]
    groups: {key: string, offers: ProviderOffer[]}[]
    checkedAt: string
    notices?: MarketNotice[]
}
