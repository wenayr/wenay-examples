/** All prices in a search use the same currency and its minor unit. */
export interface TourOffer {
  id: string
  hotelId: string
  origin: string
  departure: string
  tripDays: number
  travelers: number
  currency: string
  total: number
  available: boolean
}

export interface SearchCriteria {
  origin: string
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time)
    || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new RangeError('Expected a valid YYYY-MM-DD date')
  }
  return time
}

function dailyOffer(offers: TourOffer[]): TourOffer | null {
  return offers.reduce<TourOffer | null>((best, offer) => {
    if (!best || offer.total < best.total || (offer.total === best.total && offer.id < best.id)) {
      return offer
    }
    return best
  }, null)
}

export function searchTours(offers: readonly TourOffer[], criteria: SearchCriteria) {
  const first = calendarDay(criteria.firstDeparture)
  const last = calendarDay(criteria.lastDeparture)
  if (first > last) throw new RangeError('Invalid departure window')
  if (!Number.isSafeInteger(criteria.minTotal) || !Number.isSafeInteger(criteria.maxTotal)
    || criteria.minTotal < 0 || criteria.minTotal > criteria.maxTotal) {
    throw new RangeError('Invalid total budget')
  }
  if (![criteria.tripDays, criteria.travelers].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('Invalid duration or party size')
  }

  const dates: string[] = []
  for (let day = first; day <= last; day += 86_400_000) {
    dates.push(new Date(day).toISOString().slice(0, 10))
  }
  const window = new Set(dates)
  const byHotel = new Map<string, Map<string, TourOffer[]>>()
  for (const offer of offers) {
    if (!offer.available || !window.has(offer.departure)
      || offer.origin !== criteria.origin || offer.currency !== criteria.currency
      || offer.tripDays !== criteria.tripDays || offer.travelers !== criteria.travelers
      || !Number.isSafeInteger(offer.total) || offer.total < 0) continue
    const hotel = byHotel.get(offer.hotelId) ?? new Map<string, TourOffer[]>()
    const day = hotel.get(offer.departure) ?? []
    day.push(offer)
    hotel.set(offer.departure, day)
    byHotel.set(offer.hotelId, hotel)
  }

  const results = []
  for (const [hotelId, days] of byHotel) {
    const calendar = dates.map(departure => {
      const day = days.get(departure) ?? []
      const matching = day.filter(offer => offer.total >= criteria.minTotal && offer.total <= criteria.maxTotal)
      return {departure, lowest: dailyOffer(day), inBudget: dailyOffer(matching)}
    })
    const qualifying = calendar.flatMap(day => day.inBudget ? [day.inBudget] : [])
    const best = dailyOffer(qualifying)
    if (best) results.push({hotelId, best, calendar})
  }
  return results.sort((a, b) => a.best.total - b.best.total || a.hotelId.localeCompare(b.hotelId))
}
