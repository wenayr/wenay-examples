import {searchTours, type SearchCriteria, type TourOffer} from '../src/search-tours.ts'

export const criteria: SearchCriteria = {
  origin: 'MOW', firstDeparture: '2027-01-15', lastDeparture: '2027-01-31',
  tripDays: 10, travelers: 2, currency: 'RUB',
  minTotal: 90_000_00, maxTotal: 110_000_00,
}

function quote(id: string, hotelId: string, departure: string, rubles: number): TourOffer {
  return {
    id, hotelId, departure, origin: 'MOW', tripDays: 10, travelers: 2,
    currency: 'RUB', total: rubles * 100, available: true,
  }
}

// Synthetic prices for a return flight and stay for the whole party.
export const offers = [
  quote('A15', 'demo-hotel-a', '2027-01-15', 119_000),
  quote('A19-basic', 'demo-hotel-a', '2027-01-19', 85_000),
  quote('A19-flex', 'demo-hotel-a', '2027-01-19', 98_000),
  quote('B31', 'demo-hotel-b', '2027-01-31', 110_000),
  quote('C22', 'demo-hotel-c', '2027-01-22', 123_000),
]

if (import.meta.main) {
  console.log('Демонстрационные предложения. Цены включают перелёт и проживание для двоих.')
  console.table(searchTours(offers, criteria).map(({hotelId, best}) => ({
    'Отель': hotelId, 'Вылет': best.departure, 'Тур, ₽': best.total / 100,
  })))
}
