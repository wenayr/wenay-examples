import type {AirlineLink, FlightQuery} from '../../src/flight-contract.ts'
import {balticUrl} from './airbaltic.ts'
import {ryanairUrl} from './ryanair.ts'
import {findAirports} from './airports.ts'
import {marketAirlineDirectory} from '../markets/index.ts'

// A carrier's home country is descriptive. Ranking requires an actual price for the requested trip.
const originalAirlineDirectory = {
    ryanair: {name: 'Ryanair', iata: 'FR', country: 'IE', website: 'https://www.ryanair.com/ie/en'},
    aerlingus: {name: 'Aer Lingus', iata: 'EI', country: 'IE', website: 'https://www.aerlingus.com/'},
    egyptair: {name: 'EGYPTAIR', iata: 'MS', country: 'EG', website: 'https://www.egyptair.com/en/Pages/Default.aspx'},
    aircairo: {name: 'Air Cairo', iata: 'SM', country: 'EG', website: 'https://aircairo.com/'},
    nileair: {name: 'Nile Air', iata: 'NP', country: 'EG', website: 'https://www.nileair.com/'},
    thaiairways: {name: 'Thai Airways', iata: 'TG', country: 'TH', website: 'https://www.thaiairways.com/'},
    bangkokairways: {name: 'Bangkok Airways', iata: 'PG', country: 'TH', website: 'https://www.bangkokair.com/'},
    thaiairasia: {name: 'Thai AirAsia', iata: 'FD', country: 'TH', website: 'https://www.airasia.com/'},
    thailionair: {name: 'Thai Lion Air', iata: 'SL', country: 'TH', website: 'https://www.lionairthai.com/'},
    thaivietjet: {name: 'Thai Vietjet', iata: 'VZ', country: 'TH', website: 'https://th.vietjetair.com/'},
    vietnamairlines: {name: 'Vietnam Airlines', iata: 'VN', country: 'VN', website: 'https://www.vietnamairlines.com/go/en'},
    vietjet: {name: 'Vietjet Air', iata: 'VJ', country: 'VN', website: 'https://www.vietjetair.com/en'},
    bamboo: {name: 'Bamboo Airways', iata: 'QH', country: 'VN', website: 'https://www.bambooairways.com/'},
    lufthansa: {name: 'Lufthansa', iata: 'LH', country: 'DE', website: 'https://www.lufthansa.com/'},
    condor: {name: 'Condor', iata: 'DE', country: 'DE', website: 'https://www.condor.com/'},
    eurowings: {name: 'Eurowings', iata: 'EW', country: 'DE', website: 'https://www.eurowings.com/'},
    airbaltic: {name: 'airBaltic', iata: 'BT', country: 'LV', website: 'https://www.airbaltic.com/en/book-flight'},
    easyjet: {name: 'easyJet', iata: 'U2', country: 'GB', website: 'https://www.easyjet.com/'},
    britishairways: {name: 'British Airways', iata: 'BA', country: 'GB', website: 'https://www.britishairways.com/'},
    wizzair: {name: 'Wizz Air', iata: 'W6', country: 'HU', website: 'https://wizzair.com/'},
    turkish: {name: 'Turkish Airlines', iata: 'TK', country: 'TR', website: 'https://www.turkishairlines.com/'},
    pegasus: {name: 'Pegasus', iata: 'PC', country: 'TR', website: 'https://www.flypgs.com/en'},
    emirates: {name: 'Emirates', iata: 'EK', country: 'AE', website: 'https://www.emirates.com/'},
    etihad: {name: 'Etihad Airways', iata: 'EY', country: 'AE', website: 'https://www.etihad.com/'},
    qatar: {name: 'Qatar Airways', iata: 'QR', country: 'QA', website: 'https://www.qatarairways.com/'},
    singapore: {name: 'Singapore Airlines', iata: 'SQ', country: 'SG', website: 'https://www.singaporeair.com/'},
    scoot: {name: 'Scoot', iata: 'TR', country: 'SG', website: 'https://www.flyscoot.com/'},
    jal: {name: 'Japan Airlines', iata: 'JL', country: 'JP', website: 'https://www.jal.com/'},
    ana: {name: 'ANA', iata: 'NH', country: 'JP', website: 'https://www.ana.co.jp/en/'},
    united: {name: 'United Airlines', iata: 'UA', country: 'US', website: 'https://www.united.com/'},
    delta: {name: 'Delta Air Lines', iata: 'DL', country: 'US', website: 'https://www.delta.com/'},
    american: {name: 'American Airlines', iata: 'AA', country: 'US', website: 'https://www.aa.com/'},
    aeromexico: {name: 'Aeromexico', iata: 'AM', country: 'MX', website: 'https://www.aeromexico.com/'},
    latam: {name: 'LATAM Airlines', iata: 'LA', country: 'CL', website: 'https://www.latamairlines.com/'},
    ethiopian: {name: 'Ethiopian Airlines', iata: 'ET', country: 'ET', website: 'https://www.ethiopianairlines.com/'},
    qantas: {name: 'Qantas', iata: 'QF', country: 'AU', website: 'https://www.qantas.com/'},
} as const satisfies Record<string, {name: string, iata: string, country: string, website: string}>

export const airlineDirectory = {...originalAirlineDirectory, ...marketAirlineDirectory}

const bookingQueries: Partial<Record<keyof typeof airlineDirectory, (query: FlightQuery) => string>> = {
    ryanair: ryanairUrl,
    airbaltic: balticUrl,
}

export function directAirlineLinks(query: FlightQuery): AirlineLink[] {
    const countries = new Set([query.origin, query.destination].flatMap(code => findAirports(code, 1).map(airport => airport.country)))
    const english = new Intl.DisplayNames('en', {type: 'region'})
    const russian = new Intl.DisplayNames('ru', {type: 'region'})
    const directory = Object.entries(airlineDirectory).sort((a, b) => {
        const first = Number(countries.has(english.of(a[1].country) ?? ''))
        const second = Number(countries.has(english.of(b[1].country) ?? ''))
        return second - first || a[1].name.localeCompare(b[1].name)
    })
    return directory.map(([id, carrier]) => {
        const build = bookingQueries[id as keyof typeof airlineDirectory]
        return {id, name: carrier.name, iata: carrier.iata, country: russian.of(carrier.country) ?? carrier.country,
            url: build ? build(query) : carrier.website,
            queryApplied: build ? 'full' : 'none',
            description: build ? 'Аэропорты, даты и взрослые переданы. Багаж и окончательная цена проверяются у перевозчика.' :
                'Официальный сайт перевозчика. Маршрут, даты и пассажиров нужно выбрать на его сайте.'}
    })
}

function citySlug(city: string) {
    return city.replace(/\s*\([^)]*\)/g, '').replace(/ am Main$/i, '').normalize('NFKD').replace(/\p{M}/gu, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function carrierRouteUrl(id: string, query: FlightQuery, originCity: string, destinationCity: string) {
    const cities = 'flights-from-' + citySlug(originCity) + '-to-' + citySlug(destinationCity)
    const routes = {
        aerlingus: 'https://www.aerlingus.com/en-ie/' + cities,
        thaiairways: 'https://www.thaiairways.com/flights/en/' + cities,
        vietnamairlines: 'https://www.vietnamairlines.com/en-vn/' + cities,
        aircairo: 'https://aircairo.com/en-gl/offer-info/' + query.origin.toLowerCase() + '-' + query.destination.toLowerCase() + '-o',
    } as const
    return routes[id as keyof typeof routes]
}

export function carrierRouteMatches(html: string, query: FlightQuery, originCity: string, destinationCity: string) {
    // Read an explicit fare pair or the page title, never general navigation containing unrelated airport names.
    const pairs = new RegExp('"originAirportCode"\\s*:\\s*"' + query.origin + '"[^{}]{0,120}"destinationAirportCode"\\s*:\\s*"' + query.destination + '"')
    const decoded = html.replaceAll('\\"', '"')
    if (pairs.test(decoded)) return true
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].toLowerCase() ?? ''
    const origin = citySlug(originCity).replaceAll('-', ' ')
    const destination = citySlug(destinationCity).replaceAll('-', ' ')
    if (!origin || !destination) return false
    const first = title.indexOf(origin)
    return first >= 0 && title.indexOf(destination, first + origin.length) > first
}

export async function resolveAirlineLinks(deps: {fetch: typeof fetch}, query: FlightQuery) {
    const links = directAirlineLinks(query)
    const origin = findAirports(query.origin, 1).find(airport => airport.iata == query.origin)
    const destination = findAirports(query.destination, 1).find(airport => airport.iata == query.destination)
    if (!origin?.city || !destination?.city) return links
    const countries = new Set([origin.country, destination.country])
    const english = new Intl.DisplayNames('en', {type: 'region'})
    async function resolve(link: AirlineLink) {
        const entry = airlineDirectory[link.id as keyof typeof airlineDirectory]
        const relevant = countries.has(english.of(entry.country) ?? '')
        const url = relevant ? carrierRouteUrl(link.id, query, origin!.city, destination!.city) : undefined
        if (!url) return link
        try {
            const response = await deps.fetch(url, {signal: AbortSignal.timeout(8_000), redirect: 'error'})
            if (!response.ok || new URL(response.url || url).hostname != new URL(url).hostname) return link
            if (!carrierRouteMatches(await response.text(), query, origin!.city, destination!.city)) return link
            return {...link, url, queryApplied: 'route' as const,
                description: 'Официальная страница выбранной пары городов. Проверьте аэропорты, даты, пассажиров и багаж при поиске у перевозчика.'}
        } catch { return link }
    }
    return Promise.all(links.map(resolve))
}
