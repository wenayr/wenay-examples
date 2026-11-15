export const hotelPageSections = {
    gallery: 'Фотографии', matrix: 'Даты и цены', information: 'Об отеле', reviews: 'Отзывы',
} as const

export type tHotelPageSection = keyof typeof hotelPageSections

export function hotelSectionForRoute(query: URLSearchParams): tHotelPageSection {
    const section = query.get('hotelSection')
    if (section && Object.hasOwn(hotelPageSections, section)) return section as tHotelPageSection
    return query.get('priceView') == 'matrix' ? 'matrix' : 'gallery'
}

export function hotelSectionOffset(section: tHotelPageSection, targetTop: number, panelTop: number, scrollTop: number, headerHeight: number) {
    if (section == 'gallery') return 0
    return Math.max(0, scrollTop + targetTop - panelTop - headerHeight - 16)
}

export function hotelCalendarRequired(priceView: 'graph' | 'matrix', fareId: string, matrixFareId?: string) {
    return priceView == 'graph' || Boolean(fareId && fareId != matrixFareId)
}
