import type {ProviderAvailability, tProviderKind} from './provider-contract.ts'

export const marketCountries = {
    EE: {name: 'Эстония', currency: 'EUR', region: 'Европа'},
    LV: {name: 'Латвия', currency: 'EUR', region: 'Европа'},
    LT: {name: 'Литва', currency: 'EUR', region: 'Европа'},
    PL: {name: 'Польша', currency: 'PLN', region: 'Европа'},
    DE: {name: 'Германия', currency: 'EUR', region: 'Европа'},
    FR: {name: 'Франция', currency: 'EUR', region: 'Европа'},
    GB: {name: 'Великобритания', currency: 'GBP', region: 'Европа'},
    IT: {name: 'Италия', currency: 'EUR', region: 'Европа'},
    ES: {name: 'Испания', currency: 'EUR', region: 'Европа'},
    UA: {name: 'Украина', currency: 'UAH', region: 'Европа'},
    RU: {name: 'Россия', currency: 'RUB', region: 'Европа и Азия'},
    KZ: {name: 'Казахстан', currency: 'KZT', region: 'Центральная Азия'},
    UZ: {name: 'Узбекистан', currency: 'UZS', region: 'Центральная Азия'},
    CN: {name: 'Китай', currency: 'CNY', region: 'Восточная Азия'},
    JP: {name: 'Япония', currency: 'JPY', region: 'Восточная Азия'},
    KR: {name: 'Южная Корея', currency: 'KRW', region: 'Восточная Азия'},
    IN: {name: 'Индия', currency: 'INR', region: 'Южная Азия'},
    TH: {name: 'Таиланд', currency: 'THB', region: 'Юго-Восточная Азия'},
    VN: {name: 'Вьетнам', currency: 'VND', region: 'Юго-Восточная Азия'},
    ID: {name: 'Индонезия', currency: 'IDR', region: 'Юго-Восточная Азия'},
} as const

export type tMarketCountry = keyof typeof marketCountries
export interface MarketEvidence {title: string, url: string, checkedAt: string}
export interface MarketPartner {
    id: string
    name: string
    kind: 'airline' | 'tour-operator' | 'agency' | 'dmc' | 'wholesaler'
    relationship: 'based' | 'serves-market'
    website: string
    partnershipUrl: string
    description: string
    iata?: string
    country?: string
    providerIds?: string[]
    connection: 'price-adapter' | 'partner-api' | 'partner-onboarding' | 'official-site' | 'paused'
    evidence: MarketEvidence[]
}
export interface MarketNotice {
    kind: 'airspace' | 'commercial' | 'operations'
    title: string
    description: string
    evidence: MarketEvidence[]
}
export interface MarketRecord {
    summary: string
    airports: string[]
    airlines: MarketPartner[]
    tourism: MarketPartner[]
    notices: MarketNotice[]
}
export interface MarketProvider {
    providerId: string
    name: string
    kinds: readonly tProviderKind[]
    status: ProviderAvailability['status']
    configured: boolean
    enabled: boolean
    coverage: 'query-verified' | 'documented' | 'request-check' | 'unavailable'
    coverageDescription: string
    evidence: MarketEvidence[]
    docsUrl: string
    activation: string
    onboarding?: ProviderAvailability['onboarding']
}
export interface CountryMarket extends MarketRecord {
    code: tMarketCountry
    name: string
    currency: string
    region: string
    hubs: {iata: string, city: string, name: string}[]
    cities: readonly {name: string, query: string, latitude: number, longitude: number}[]
    aviationStatus: 'closed' | 'restricted' | 'request-check'
    commercialStatus: 'review-required' | 'request-check'
    providers: MarketProvider[]
}
export interface MarketCatalog {
    items: CountryMarket[]
    checkedAt: string
    selection: string
    summary: {countries: number, airlines: number, tourismPartners: number, priceProviders: number}
}
