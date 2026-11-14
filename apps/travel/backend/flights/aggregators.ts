import type {FlightQuery} from '../../src/flight-contract.ts'
import {googleFlightsUrl} from './google.ts'

function kayakSearch(host: string, query: FlightQuery) {
    const path = [query.origin + '-' + query.destination, query.departure]
    if (query.returnDate) path.push(query.returnDate)
    path.push(query.adults + 'adults')
    return host + '/flights/' + path.join('/') + '?' + new URLSearchParams({sort: 'price_a', currency: 'EUR', cabin: 'e'})
}

/** Each handoff retains the route, dates and adults. Baggage still needs confirmation in the supplier's form. */
export function publicAggregatorLinks(query: FlightQuery) {
    const dates = [query.departure, query.returnDate].filter((date): date is string => !!date).map(date => date.slice(2).replaceAll('-', ''))
    const sky = 'https://www.skyscanner.net/transport/flights/' +
        [query.origin.toLowerCase(), query.destination.toLowerCase(), ...dates].join('/') + '/?'
    return [
        {label: 'Google Flights', providerId: 'google-flights', kind: 'search' as const, url: googleFlightsUrl(query)},
        {label: 'Skyscanner', providerId: 'skyscanner', kind: 'search' as const,
            url: sky + new URLSearchParams({adultsv2: String(query.adults), cabinclass: 'economy', rtn: query.returnDate ? '1' : '0', currency: 'EUR'})},
        {label: 'KAYAK', providerId: 'kayak', kind: 'search' as const, url: kayakSearch('https://www.kayak.com', query)},
        {label: 'momondo', providerId: 'momondo', kind: 'search' as const, url: kayakSearch('https://www.momondo.com', query)}
    ]
}
