export const hotelReviewStatuses = {
    ready: 'Отзывы гостей',
    empty: 'Источник пока не вернул отзывы',
    'not-configured': 'Источник отзывов не подключён',
    'not-mapped': 'Отель ещё не сопоставлен с источником',
    disabled: 'Отзывы отключены агентством',
    unavailable: 'Источник временно недоступен',
} as const

export interface HotelReviewProperty {
    hotelId: string
    propertyId: string
    sourceUrl: string
}

export interface HotelReview {
    id: string
    author: string
    publishedAt: string
    travelDate?: string
    rating: number | null
    maxRating: number
    title?: string
    text: string
    sourceUrl: string
    verifiedStay: boolean | null
}

export interface HotelReviews {
    hotelId: string
    status: keyof typeof hotelReviewStatuses
    summary: {rating: number, maxRating: number, count: number} | null
    reviews: HotelReview[]
    externalReferences: {name: string, url: string, identityCheckedOn: string}[]
    source: {
        provider: 'expedia-rapid'
        name: 'Expedia'
        url: string | null
        retrievedAt: string | null
        attribution: string
        order: 'source-recent'
        partial: boolean
        stale: boolean
    }
    message: string
}

export function validReviewProperty(value: HotelReviewProperty) {
    if (!/^tez:[1-9]\d{0,14}$/.test(value.hotelId) || !/^[1-9]\d{0,14}$/.test(value.propertyId)) return false
    try {
        const url = new URL(value.sourceUrl)
        const host = url.hostname == 'www.expedia.com' || url.hostname == 'expedia.com'
        const secure = url.protocol == 'https:' && !url.username && !url.password && !url.port
        return host && secure && url.pathname.endsWith('.h' + value.propertyId + '.Hotel-Information')
    } catch {
        return false
    }
}
