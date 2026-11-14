import {createHash} from 'node:crypto'
import type {ProviderAdapter, ProviderDeps, ProviderOffer, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'
import {findAirports} from '../../flights/airports.ts'
import {record, text} from '../aviation/common.ts'

export const directAirlines = {
    'direct-ana': {name: 'ANA', iata: 'NH', tenant: 'anax', market: 'JP', base: 'https://www.ana.co.jp/en-jp/'},
    'direct-vietnam': {name: 'Vietnam Airlines', iata: 'VN', tenant: 'vn', market: 'VN', base: 'https://www.vietnamairlines.com/en-vn/'},
    'direct-korean': {name: 'Korean Air', iata: 'KE', tenant: 'ke', market: 'KR', base: 'https://www.koreanair.com/flights/en/'},
} as const
export type tDirectAirline = keyof typeof directAirlines
const currencies = new Set(Intl.supportedValuesOf('currency').filter(currency => currency != 'XTS' && currency != 'XXX'))

const metropolitanCities: Record<string, string> = {
    HND: 'Tokyo', NRT: 'Tokyo', ITM: 'Osaka', KIX: 'Osaka', UKB: 'Osaka', ICN: 'Seoul', GMP: 'Seoul',
    CDG: 'Paris', ORY: 'Paris', LHR: 'London', LGW: 'London', STN: 'London', LTN: 'London', LCY: 'London',
    FRA: 'Frankfurt', MUC: 'Munich', BER: 'Berlin', FCO: 'Rome', CIA: 'Rome', MXP: 'Milan', LIN: 'Milan',
    BGY: 'Milan', VCE: 'Venice', BCN: 'Barcelona', WAW: 'Warsaw', WMI: 'Warsaw', PEK: 'Beijing', PKX: 'Beijing',
    PVG: 'Shanghai', SHA: 'Shanghai', SVO: 'Moscow', DME: 'Moscow', VKO: 'Moscow',
}

function citySlug(code: string) {
    const airport = findAirports(code, 1).find(item => item.iata == code)
    if (!airport?.city) return null
    const city = metropolitanCities[code] ?? airport.city
    return city.replace(/\s*\([^)]*\)/g, '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function directFareUrl(id: tDirectAirline, query: ProviderQuery) {
    const origin = citySlug(query.origin ?? '')
    const destination = citySlug(query.destination ?? '')
    if (!origin || !destination || query.origin == query.destination) return null
    return directAirlines[id].base + 'flights-from-' + origin + '-to-' + destination
}

function date(value: unknown) {
    if (typeof value != 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) == value ? value : null
}

function matchingFare(fare: Record<string, unknown>, query: ProviderQuery, today: string) {
    if (fare.__typename != 'Fare' || fare.originAirportCode != query.origin || fare.destinationAirportCode != query.destination) return false
    const departure = date(fare.departureDate)
    if (!departure || departure < today) return false
    if (query.departure && departure != query.departure) return false
    const roundTrip = fare.flightType == 'ROUND_TRIP'
    if (!roundTrip && fare.flightType != 'ONE_WAY') return false
    const returning = date(fare.returnDate)
    if (roundTrip && (!returning || returning < departure)) return false
    if (query.returnDate === null && roundTrip) return false
    if (typeof query.returnDate == 'string' && (!roundTrip || returning != query.returnDate)) return false
    return true
}

function airlineFares(value: unknown, result: Record<string, unknown>[] = []) {
    if (!value || typeof value != 'object') return result
    if (record(value).__typename == 'Fare') result.push(record(value))
    for (const part of Object.values(value)) airlineFares(part, result)
    return result
}

function priceAmount(value: unknown) {
    if (typeof value != 'number' && typeof value != 'string') return null
    if (typeof value == 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return null
    const amount = Number(value)
    return Number.isFinite(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER ? amount : null
}

function fareOffer(id: tDirectAirline, fare: Record<string, unknown>, sourceUrl: string, deps: ProviderDeps): ProviderOffer | null {
    const price = priceAmount(fare.totalPrice)
    const currency = text(fare.currencyCode)
    if (price === null || !currencies.has(currency)) return null
    const airline = directAirlines[id]
    const returnDate = fare.flightType == 'ROUND_TRIP' ? text(fare.returnDate) : null
    const publishedClass = (text(fare.farenetTravelClass) || text(fare.travelClass)).toUpperCase()
    const normalizedClass = publishedClass == 'ECO' ? 'ECONOMY' : publishedClass
    const identity = [fare.originAirportCode, fare.destinationAirportCode, fare.departureDate, returnDate, currency, price, normalizedClass]
    const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)
    const lastSeen = record(fare.priceLastSeen)
    const age = [text(lastSeen.value), text(lastSeen.unit)].filter(Boolean).join(' ')
    const condition = 'Опубликованная цена за одного взрослого. ' + (returnDate ? 'Перелёт туда и обратно. ' : 'Перелёт в одну сторону. ') +
        'Рынок публикации ' + airline.market + '. Применимость к стране покупателя, гражданству и средствам оплаты проверяется у перевозчика. ' +
        'Наличие на всю группу, багаж, сборы и итоговую сумму нужно проверить у перевозчика. '
    return {id: id + ':' + hash, providerId: id, kind: 'flights', title: airline.name + ' · ' + fare.originAirportCode + ' → ' + fare.destinationAirportCode,
        price: {amount: price, currency, basis: 'person', type: 'retail'}, accuracy: 'published-from', sourceUrl, bookingUrl: sourceUrl,
        checkedAt: deps.now().toISOString(), expiresAt: null, departure: text(fare.departureDate), returnDate, adults: 1,
        origin: text(fare.originAirportCode), flight: {origin: text(fare.originAirportCode), destination: text(fare.destinationAirportCode),
            carrier: airline.iata, stops: null, durationMinutes: null},
        includes: {checkedBags: null, taxes: null, refundable: null}, comparisonKey: null,
        conditions: condition + (text(fare.formattedTravelClass) || text(fare.travelClass)) + (age ? '. Источник видел цену ' + age + ' назад.' : '.')}
}

export function readDirectFares(id: tDirectAirline, html: string, query: ProviderQuery, deps: ProviderDeps, sourceUrl: string): ProviderResult {
    const json = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1]
    if (!json) throw new Error('Не найдено структурированное предложение перевозчика.')
    const page = record(record(record(JSON.parse(json)).props).pageProps)
    if (page.tenant != directAirlines[id].tenant) throw new Error('Страница не подтвердила перевозчика.')
    const today = deps.now().toISOString().slice(0, 10)
    const fares = airlineFares(page.apolloState).filter(fare => matchingFare(fare, query, today))
    const byId = new Map<string, ProviderOffer>()
    for (const fare of fares) {
        const offer = fareOffer(id, fare, sourceUrl, deps)
        if (offer && (!byId.has(offer.id) || record(fare.priceLastSeen).value)) byId.set(offer.id, offer)
    }
    const offers = [...byId.values()].sort((a, b) => a.price.currency.localeCompare(b.price.currency) || a.price.amount - b.price.amount)
    return {providerId: id, status: 'live', offers, checkedAt: deps.now().toISOString(), sourceUrl, partial: true,
        description: offers.length ? 'Собственные опубликованные цены перевозчика за одного взрослого на указанные в карточках даты.' :
            'Страница перевозчика не опубликовала подходящий тариф на выбранные аэропорты и даты. Это не подтверждает отсутствие рейса.'}
}

export function directFareAdapter(id: tDirectAirline): ProviderAdapter {
    async function search(query: ProviderQuery, deps: ProviderDeps): Promise<ProviderResult> {
        const sourceUrl = directFareUrl(id, query)
        if (query.kind != 'flights' || !sourceUrl) return {providerId: id, status: 'unsupported-query', offers: [], checkedAt: null,
            sourceUrl: directAirlines[id].base, description: 'Нужны два выбранных аэропорта с названиями городов.'}
        try {
            const response = await deps.fetch(sourceUrl, {redirect: 'error', signal: AbortSignal.timeout(15_000), headers: {Accept: 'text/html'}})
            if (!response.ok) throw new Error('Страница перевозчика временно недоступна.')
            const html = await response.text()
            if (html.length > 5_000_000) throw new Error('Страница превысила допустимый размер.')
            return readDirectFares(id, html, query, deps, sourceUrl)
        } catch {
            return {providerId: id, status: 'unavailable', offers: [], checkedAt: null, sourceUrl,
                description: 'Перевозчик не подтвердил опубликованные тарифы. Другие источники продолжают поиск.'}
        }
    }
    return {search}
}
