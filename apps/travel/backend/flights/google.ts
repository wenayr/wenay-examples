import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {promisify} from 'node:util'
import type {FlightQuery, RouteQuote} from '../../src/flight-contract.ts'

export function googleFlightsUrl(q: FlightQuery) {
    const returnText = q.returnDate ? ' returning ' + q.returnDate : ' one way'
    const passengerText = q.adults + (q.adults == 1 ? ' adult' : ' adults')
    const text = 'Flights from ' + q.origin + ' to ' + q.destination + ' on ' + q.departure +
        returnText + ' for ' + passengerText
    return 'https://www.google.com/travel/flights?' + new URLSearchParams({q: text, curr: 'EUR', hl: 'en'})
}

const command = promisify(execFile)

/** Fetch a single public HTML document. No redirects, cookie jar, browser emulation or access tokens. */
export async function fetchGooglePage(query: FlightQuery) {
    const {stdout} = await command('curl', ['-fsS', '--max-time', '12', '--proto', '=https', '--max-filesize', '8388608',
        '--write-out', '\n%{http_code}', '--', googleFlightsUrl(query)], {timeout: 13_000, maxBuffer: 8 * 1024 * 1024 + 16})
    if (!stdout.endsWith('\n200')) throw new Error('Страница маршрута недоступна')
    return stdout.slice(0, -4)
}

const dateLabel = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'})

function matchesSearch(html: string, query: FlightQuery) {
    const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
    function dayMatches(field: string, date: string) {
        const label = dateLabel.format(new Date(date))
        return inputs.some(tag => tag.includes('aria-label="' + field + '"') && tag.includes('value="' + label + '"')) &&
            html.includes('"' + date + '"')
    }
    const adults = /<[^<>]*aria-label="Number of adult passengers"[^<>]*>/i.exec(html)?.[0]
    return adults?.includes('aria-valuenow="' + query.adults + '"') && dayMatches('Departure', query.departure) &&
        (!query.returnDate || dayMatches('Return', query.returnDate))
}

function localTime(value: string | undefined) {
    const match = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(value?.trim() ?? '')
    if (!match) return null
    const valid = Number(match[1]) <= 12 && Number(match[1]) >= 1 && Number(match[2]) <= 59
    if (!valid) return null
    const hour = Number(match[1]) % 12 + (match[3].toUpperCase() == 'PM' ? 12 : 0)
    return String(hour).padStart(2, '0') + ':' + match[2]
}

function flightDetails(label: string, departureDate: string) {
    const stop = /(?:^|\s)(\d+) stops? flight/i.exec(label)
    let stops = stop ? Number(stop[1]) : null
    if (/Nonstop flight/i.test(label)) stops = 0
    const duration = /Total duration ([^.]+)\./i.exec(label)?.[1]?.trim() ?? null
    const hours = /(?<hours>\d+) hr/.exec(duration ?? '')?.groups?.hours
    const minutes = /(?<minutes>\d+) min/.exec(duration ?? '')?.groups?.minutes
    const durationMinutes = hours || minutes ? Number(hours ?? 0) * 60 + Number(minutes ?? 0) : null
    const departure = localTime(/Leaves .+? at (.+?) on /i.exec(label)?.[1])
    const arrival = localTime(/arrives at .+? at (.+?) on /i.exec(label)?.[1])
    const arrivalDay = /arrives at .+? at .+? on ([^.]+)\./i.exec(label)?.[1]
    let arrivalSuffix = ''
    if (arrivalDay) {
        const date = new Date(arrivalDay + ', ' + departureDate.slice(0, 4) + ' 00:00:00 GMT')
        if (Number.isFinite(date.getTime())) {
            if (date.getTime() < Date.parse(departureDate)) date.setUTCFullYear(date.getUTCFullYear() + 1)
            if (date.toISOString().slice(0, 10) != departureDate) {
                arrivalSuffix = ' (' + new Intl.DateTimeFormat('ru', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(date) + ')'
            }
        }
    }
    const outbound = departure && arrival ? departure + ' → ' + arrival + arrivalSuffix : null
    const cabinBag = label.includes('does not include overhead bin access') ? 'excluded' as const : 'unknown' as const
    return {stops, duration, durationMinutes, outbound, checkedBags: null, cabinBag}
}

/** Public search cards show an outbound option and a route total, without selecting the return flight or fare conditions. */
export function readGoogleQuotes(html: string, query: FlightQuery, checkedAt: string): RouteQuote[] {
    if (query.checkedBag || !matchesSearch(html, query)) return []
    const unique = new Map<string, RouteQuote>()
    for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const card = match[1]
        const label = /aria-label="From ([\d,.]+) euros?( round trip total)?\.([^"]+)"/i.exec(card)
        if (!label || Boolean(query.returnDate) !== Boolean(label[2])) continue
        const airports = [...card.matchAll(/>([A-Z]{3})</g)].slice(0, 2).map(code => code[1])
        if (airports[0] != query.origin || airports[1] != query.destination) continue
        const total = Math.round(Number(label[1].replaceAll(',', '')) * 100)
        if (!Number.isSafeInteger(total) || total <= 0) continue
        const carrier = /flight with ([^.<>&]{1,90})\./i.exec(label[3])?.[1]?.trim() ?? null
        const details = flightDetails(label[3], query.departure)
        const signature = JSON.stringify([query, carrier, details, total])
        const id = 'google-' + createHash('sha256').update(signature).digest('hex').slice(0, 20)
        const cabin = details.cabinBag == 'excluded' ? ' Место для ручной клади на верхней полке не включено.' : ''
        const returnChoice = query.returnDate ? ' Обратный рейс и его условия выбираются у поставщика.' : ''
        unique.set(id, {id, total, currency: 'EUR', checkedAt, sourceUrl: googleFlightsUrl(query), carrier,
            providerId: 'google-flights', providerName: 'Google Flights', details,
            description: 'Опубликованный ориентир за всех пассажиров на заданные даты. Багаж и окончательные условия проверяются у продавца.' +
                returnChoice + cabin})
    }
    return [...unique.values()].sort((a, b) => a.total - b.total || (a.id ?? '').localeCompare(b.id ?? '')).slice(0, 30)
}

/** Compatibility for consumers which display a single minimum. */
export function readGoogleQuote(html: string, query: FlightQuery, checkedAt: string): RouteQuote | null {
    return readGoogleQuotes(html, query, checkedAt)[0] ?? null
}
