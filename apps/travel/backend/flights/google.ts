import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {FlightQuery, RouteQuote} from '../../src/flight-contract.ts'

export function googleFlightsUrl(q: FlightQuery) {
    const text = 'Flights from ' + q.origin + ' to ' + q.destination + ' on ' + q.departure +
        (q.returnDate ? ' returning ' + q.returnDate : ' one way') + ' for ' + q.adults + (q.adults === 1 ? ' adult' : ' adults')
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

/** Parse visible totals and passenger/date controls only. Airport codes in each card identify the actual leg. */
export function readGoogleQuote(html: string, query: FlightQuery, checkedAt: string): RouteQuote | null {
    if (query.checkedBag) return null
    const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
    function dayMatches(field: string, date: string) {
        const label = dateLabel.format(new Date(date))
        return inputs.some(tag => tag.includes('aria-label="' + field + '"') && tag.includes('value="' + label + '"')) &&
            html.includes('"' + date + '"')
    }
    const adults = /<[^<>]*aria-label="Number of adult passengers"[^<>]*>/i.exec(html)?.[0]
    if (!adults?.includes('aria-valuenow="' + query.adults + '"') || !dayMatches('Departure', query.departure) ||
        (query.returnDate && !dayMatches('Return', query.returnDate))) return null
    let best: RouteQuote | null = null
    for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const card = match[1]
        const label = /aria-label="From ([\d,.]+) euros?( round trip total)?\.([^"]+)"/i.exec(card)
        if (!label || Boolean(query.returnDate) !== Boolean(label[2])) continue
        const airports = [...card.matchAll(/>([A-Z]{3})</g)].slice(0, 2).map(code => code[1])
        if (airports[0] != query.origin || airports[1] != query.destination) continue
        const total = Math.round(Number(label[1].replaceAll(',', '')) * 100)
        if (!Number.isSafeInteger(total) || total <= 0 || (best && best.total <= total)) continue
        const carrier = /flight with ([^.<>&]{1,90})\./i.exec(label[3])?.[1]?.trim() ?? null
        const cabin = label[3].includes('does not include overhead bin access') ? ' Место для ручной клади на верхней полке не включено.' : ''
        best = {total, currency: 'EUR', checkedAt, sourceUrl: googleFlightsUrl(query), carrier,
            description: 'Минимум среди показанных вариантов по заданным датам и аэропортам. Окончательные цену и условия уточняет продавец.' + cabin}
    }
    return best
}
