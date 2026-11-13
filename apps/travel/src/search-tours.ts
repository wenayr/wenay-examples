/** All prices in a search use the same currency and its minor unit. */
export interface TourOffer<HotelId extends string = string> {
    id: string
    hotelId: HotelId
    origin: string
    destinationId?: string
    departure: string
    tripDays: number
    travelers: number
    currency: string
    total: number
    available: boolean
}

export interface SearchCriteria {
    origin: string
    destinationId?: string
    firstDeparture: string
    lastDeparture: string
    tripDays: number
    travelers: number
    currency: string
    minTotal: number
    maxTotal: number
}

function calendarDay(value: string): number {
    const time = Date.parse(value + 'T00:00:00Z')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time)) throw new RangeError('Expected a valid YYYY-MM-DD date')
    if (new Date(time).toISOString().slice(0, 10) != value) throw new RangeError('Expected a valid YYYY-MM-DD date')
    return time
}

function validateSearch(criteria: SearchCriteria) {
    const first = calendarDay(criteria.firstDeparture)
    const last = calendarDay(criteria.lastDeparture)
    if (first > last) throw new RangeError('Invalid departure window')

    const wholePrices = Number.isSafeInteger(criteria.minTotal) && Number.isSafeInteger(criteria.maxTotal)
    const orderedBudget = criteria.minTotal >= 0 && criteria.minTotal <= criteria.maxTotal
    if (!wholePrices || !orderedBudget) throw new RangeError('Invalid total budget')

    const party = [criteria.tripDays, criteria.travelers]
    if (!party.every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid duration or party size')
    return {first, last}
}

function matchesTrip(offer: TourOffer, criteria: SearchCriteria) {
    const route = offer.origin == criteria.origin && (criteria.destinationId == undefined || offer.destinationId == criteria.destinationId)
    const party = offer.tripDays == criteria.tripDays && offer.travelers == criteria.travelers
    const validPrice = Number.isSafeInteger(offer.total) && offer.total >= 0 && offer.currency == criteria.currency
    const bookable = validPrice && offer.available
    return route && party && bookable
}

function cheaper<T extends TourOffer>(current: T | null, candidate: T) {
    if (!current || candidate.total < current.total) return candidate
    if (candidate.total == current.total && candidate.id < current.id) return candidate
    return current
}

function collectHotel<HotelId extends string>(hotelId: HotelId, offers: TourOffer<HotelId>[], dates: readonly string[], criteria: SearchCriteria) {
    type Offer = TourOffer<HotelId>
    const byDay = new Map<string, {departure: string, lowest: Offer | null, inBudget: Offer | null}>()
    let best: Offer | null = null
    let minTotal = Infinity
    let maxTotal = -Infinity
    let inBudgetMaxTotal = -Infinity

    for (const offer of offers) {
        const day = byDay.get(offer.departure) ?? {departure: offer.departure, lowest: null, inBudget: null}
        day.lowest = cheaper(day.lowest, offer)
        byDay.set(offer.departure, day)
        minTotal = Math.min(minTotal, offer.total)
        maxTotal = Math.max(maxTotal, offer.total)
        if (offer.total < criteria.minTotal || offer.total > criteria.maxTotal) continue

        // The maximum may be a second fare on a day whose cheapest fare is well below it.
        inBudgetMaxTotal = Math.max(inBudgetMaxTotal, offer.total)
        best = cheaper(best, offer)
        day.inBudget = cheaper(day.inBudget, offer)
    }

    if (!best) return null
    const calendar = dates.map(departure => byDay.get(departure) ?? {departure, lowest: null, inBudget: null})
    return {hotelId, best, minTotal, maxTotal, inBudgetMaxTotal, calendar}
}

export function searchTours<HotelId extends string>(offers: readonly TourOffer<HotelId>[], criteria: SearchCriteria) {
    const {first, last} = validateSearch(criteria)
    const dates: string[] = []
    for (let day = first; day <= last; day += 86_400_000) {
        dates.push(new Date(day).toISOString().slice(0, 10))
    }

    // Accept only actual departure dates, including at a supplier boundary with malformed inputs.
    const validDates = new Set(dates)
    const byHotel = new Map<HotelId, TourOffer<HotelId>[]>()
    for (const offer of offers) {
        if (!matchesTrip(offer, criteria) || !validDates.has(offer.departure)) continue
        const group = byHotel.get(offer.hotelId) ?? []
        group.push(offer)
        byHotel.set(offer.hotelId, group)
    }

    const results = []
    for (const [hotelId, hotelOffers] of byHotel) {
        const hotel = collectHotel(hotelId, hotelOffers, dates, criteria)
        if (hotel) results.push(hotel)
    }
    return results.sort((a, b) => a.best.total - b.best.total || a.hotelId.localeCompare(b.hotelId))
}
