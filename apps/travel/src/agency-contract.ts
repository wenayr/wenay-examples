import {packageRegionDefinitions} from './package-regions.ts'
import type {HotelReviewProperty} from './hotel-reviews-contract.ts'

export const agencySources = {
    tez: {name: 'TEZ TOUR Eesti', status: 'live', description: 'Действующий поиск туров и цен. Договор и комиссия оформляются с поставщиком отдельно.'},
} as const
export const agencyDestinationNames = {
    hurghada: 'Хургада', sharm: 'Шарм-эль-Шейх', rhodes: 'Родос', antalya: 'Анталья',
} as const satisfies Record<keyof typeof packageRegionDefinitions, string>
export const agencyPriceModes = {graph: 'График цен', matrix: 'Тепловая матрица'} as const
export const agencyLeadStatuses = {new: 'Новая', contacted: 'Связались', proposal: 'Предложение', closed: 'Закрыта'} as const
export type tAgencySource = keyof typeof agencySources
export type tAgencyPriceMode = keyof typeof agencyPriceModes
export type tAgencyLeadStatus = keyof typeof agencyLeadStatuses

export interface AgencySettings {
    name: string
    slug: string
    tagline: string
    contact: {email: string, phone: string, website: string}
    brandColor: string
    destinations: string[]
    sources: tAgencySource[]
    showReviews: boolean
    compactPriceMode: tAgencyPriceMode
    reviewProperties?: HotelReviewProperty[]
}

export interface AgencyProfile extends AgencySettings {
    id: string
    revision: number
    createdAt: string
    updatedAt: string
}

export type AgencyStorefront = Pick<AgencyProfile,
    'name' | 'slug' | 'tagline' | 'contact' | 'brandColor' | 'destinations' | 'sources' | 'showReviews' | 'compactPriceMode' | 'revision'>

export interface AgencyLeadInput {
    name: string
    contact: string
    message: string
    hotelId?: string
    hotelName?: string
}

export interface AgencyLead extends AgencyLeadInput {
    id: string
    status: tAgencyLeadStatus
    revision: number
    createdAt: string
    updatedAt: string
}

export interface AgencySession {
    authenticated: boolean
    storageAvailable: boolean
    agency: AgencyProfile | null
    leads: AgencyLead[]
    reviewProviderAvailable?: boolean
}

export function initialAgencySettings(): AgencySettings {
    return {
        name: '', slug: '', tagline: '', contact: {email: '', phone: '', website: ''}, brandColor: '#166b61',
        destinations: Object.keys(agencyDestinationNames), sources: ['tez'], showReviews: true, compactPriceMode: 'graph', reviewProperties: [],
    }
}
