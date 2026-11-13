import type {SearchCriteria, TourOffer} from '../src/search-tours.ts'

interface HotelInfo {
  name: string
  area: string
  latitude: number
  longitude: number
}

export const hotels = {
  palm: {name: 'Palm Bay', area: 'Эль-Мамша', latitude: 27.1614, longitude: 33.8267},
  marina: {name: 'Marina House', area: 'Марина', latitude: 27.2254, longitude: 33.8397},
  dune: {name: 'Dune Beach', area: 'Южное побережье', latitude: 27.0911, longitude: 33.8405},
  coral: {name: 'Coral Garden', area: 'Саккала', latitude: 27.1995, longitude: 33.8438},
} as const satisfies Record<string, HotelInfo>

export type HotelId = keyof typeof hotels

// Each row is one hotel's package prices in whole RUB, indexed by departure.
type JanuaryDay = '15'|'16'|'17'|'18'|'19'|'20'|'21'|'22'|'23'|'24'|'25'|'26'|'27'|'28'|'29'|'30'|'31'
type DailyPrices = Partial<Record<JanuaryDay, readonly number[]>>

const januaryRates = {
  palm: {'15':[119000], '16':[113000], '17':[108000], '18':[102000], '19':[85000,98000], '20':[100000], '21':[105000], '22':[109000], '24':[114000], '26':[110000], '28':[106000], '29':[112000], '30':[121000], '31':[126000]},
  marina: {'16':[118000], '17':[115000], '19':[120000], '20':[118000], '21':[114000], '22':[112000], '23':[109000], '24':[104000], '25':[106000], '26':[109000], '28':[112000], '30':[111000], '31':[110000]},
  dune: {'15':[108000], '16':[106000], '18':[110000], '19':[115000], '20':[109000], '21':[104000], '23':[101000], '24':[105000], '25':[107000], '27':[110000], '28':[113000], '30':[108000], '31':[109000]},
  coral: {'15':[147000], '17':[141000], '19':[136000], '21':[131000], '22':[123000], '24':[130000], '26':[120000], '28':[134000], '29':[132000], '31':[143000]},
} as const satisfies Record<HotelId, DailyPrices>

export const defaultSearch = {
  origin: 'MOW', firstDeparture: '2027-01-15', lastDeparture: '2027-01-31',
  tripDays: 10, travelers: 2, currency: 'RUB', minTotal: 90_000 * 100, maxTotal: 110_000 * 100,
} satisfies SearchCriteria

function buildOffers(hotelId: HotelId, rates: DailyPrices): TourOffer<HotelId>[] {
  return Object.entries(rates).flatMap(([day, prices]) => prices.map((price, index) => ({
    id: hotelId + '-' + day + '-' + index, hotelId, origin: defaultSearch.origin,
    departure: '2027-01-' + day, tripDays: 10, travelers: 2, currency: 'RUB',
    total: price * 100, available: true,
  } satisfies TourOffer<HotelId>)))
}

// Use source identifiers at construction. Live supplier IDs will be validated at their boundary.
export const demoOffers = (Object.keys(hotels) as HotelId[]).flatMap(id => buildOffers(id, januaryRates[id]))
