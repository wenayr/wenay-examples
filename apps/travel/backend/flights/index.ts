import type {FlightDay, FlightOffer, FlightQuery, FlightSearch, RouteQuote} from '../../src/flight-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {fetchGooglePage, googleFlightsUrl, readGoogleQuotes} from './google.ts'
import {dateValue, numberParam} from '../travel-query.ts'
import {readBalticCalendar, balticUrl} from './airbaltic.ts'
import {readDuffelOffers, duffelRequest} from './duffel.ts'
import {publicAggregatorLinks} from './aggregators.ts'
import {ryanairCalendar, ryanairUrl} from './ryanair.ts'
import {compareFlightOffers} from './comparison.ts'
import {directAirlineLinks, resolveAirlineLinks} from './carriers.ts'
import {travelRestriction} from '../markets/policy.ts'

export function readFlightQuery(params: URLSearchParams, today: string): FlightQuery {
    const origin = (params.get('origin') ?? '').trim().toUpperCase()
    const destination = (params.get('destination') ?? '').trim().toUpperCase()
    const validAirports = /^[A-Z]{3}$/.test(origin) && /^[A-Z]{3}$/.test(destination) && origin != destination
    if (!validAirports) throw new RangeError('Укажите два разных трёхбуквенных кода IATA.')
    const departure = dateValue(params.get('departure'))
    const returnDate = params.get('returnDate') ? dateValue(params.get('returnDate')) : null
    if (departure < today || (returnDate && returnDate < departure)) throw new RangeError('Проверьте дату вылета и обратного рейса.')
    if (params.has('currency') && params.get('currency') !== 'EUR') throw new RangeError('Стоимость отображается в EUR.')
    const checked = params.get('checkedBag') ?? 'false'
    if (!['true', 'false'].includes(checked)) throw new RangeError('Укажите наличие зарегистрированного багажа.')
    return {origin, destination, departure, returnDate, adults: numberParam(params.get('adults'), 1, 9, 1), checkedBag: checked == 'true'}
}

const baltic = {id: 'airbaltic', name: 'airBaltic', url: 'https://www.airbaltic.com/en/book-flight'}
const google = {id: 'google-flights', name: 'Google Flights'}
const duffel = {id: 'duffel', name: 'Duffel', url: 'https://duffel.com/flights/search'}

function publicLinks(query: FlightQuery) {
    return [...publicAggregatorLinks(query),
        {label: 'Календарь и покупка на airBaltic', url: balticUrl(query), providerId: 'airbaltic', kind: 'carrier' as const},
        {label: 'Поиск на Ryanair', url: ryanairUrl(query), providerId: 'ryanair', kind: 'carrier' as const}]
}

function aggregatorHandoffs(query: FlightQuery): SupplySource[] {
    return publicAggregatorLinks(query).filter(link => link.providerId != 'google-flights').map(link => ({
        id: link.providerId, name: link.label, url: link.url, status: 'handoff', updatedAt: null,
        description: 'Поиск с выбранными аэропортами, датами и пассажирами. Цена, багаж и условия проверяются на сайте агрегатора.'
    }))
}

export function createFlights(deps: {fetch: typeof fetch, now: () => Date, duffelToken?: string, googlePage?: typeof fetchGooglePage}) {
    const cache = new Map<string, {result: FlightSearch, until: number}>()
    const pending = new Map<string, Promise<FlightSearch>>()
    async function calendar(query: FlightQuery): Promise<{rows: FlightDay[], source: SupplySource}> {
        if (query.checkedBag) return {rows: [], source: {...baltic, status: 'handoff', updatedAt: null,
            description: 'Календарь перевозчика показывает минимумы без гарантии багажа. Условия видны при выборе тарифа.'}}
        try {
            const calendarQuery = {...query, adults: 1, returnDate: null}
            const url = balticUrl(calendarQuery)
            const response = await deps.fetch(url, {signal: AbortSignal.timeout(12_000), redirect: 'error'})
            if (!response.ok) throw new Error('Страница недоступна')
            const rows = readBalticCalendar(await response.text(), {...calendarQuery, returnDate: query.returnDate}, deps.now().toISOString().slice(0, 10))
            return {rows, source: {...baltic, url, status: 'live', updatedAt: deps.now().toISOString(),
                description: 'Опубликованные минимумы в евро за одного пассажира в одну сторону. Условия и наличие проверяются у перевозчика.'}}
        } catch {
            return {rows: [], source: {...baltic, status: 'unavailable', updatedAt: null,
                description: 'Не удалось прочитать календарь этого маршрута. Доступен переход к перевозчику.'}}
        }
    }
    async function routeQuotes(query: FlightQuery): Promise<{quotes: RouteQuote[], source: SupplySource}> {
        const url = googleFlightsUrl(query)
        if (query.checkedBag) return {quotes: [], source: {...google, url, status: 'handoff', updatedAt: null,
            description: 'Включённый багаж нужно проверить у продавца.'}}
        try {
            const page = await (deps.googlePage ?? fetchGooglePage)(query)
            const time = deps.now().toISOString()
            const quotes = readGoogleQuotes(page, query, time)
            if (quotes.length) return {quotes, source: {...google, url, status: 'live', updatedAt: time,
                description: 'Опубликованные варианты разных авиакомпаний за всех пассажиров на выбранном маршруте. Обратный рейс и багаж уточняет продавец.'}}
        } catch { /* Retain the exact route handoff when the public page cannot confirm a price. */ }
        return {quotes: [], source: {...google, url, status: 'handoff', updatedAt: null,
            description: 'Подтверждённой суммы на этот запрос нет. Проверьте выдачу у поставщика.'}}
    }
    async function fares(query: FlightQuery): Promise<{rows: FlightOffer[], source: SupplySource}> {
        if (!deps.duffelToken || deps.duffelToken.startsWith('duffel_test_')) return {rows: [], source: {...duffel, status: 'requires-access', updatedAt: null,
            description: 'Для актуальных предложений авиакомпаний через Duffel нужен серверный доступ в Live Mode.'}}
        try {
            const response = await deps.fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=8000',
                {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
                    headers: {Authorization: 'Bearer ' + deps.duffelToken, 'Duffel-Version': 'v2',
                        Accept: 'application/json', 'Content-Type': 'application/json'},
                    body: JSON.stringify(duffelRequest(query))})
            if (response.status == 401 || response.status == 403) return {rows: [], source: {...duffel, status: 'requires-access', updatedAt: null,
                description: 'Duffel не подтвердил доступ агентства к поиску.'}}
            if (!response.ok) throw new Error('Поиск недоступен')
            const rows = readDuffelOffers(await response.json(), query, deps.now())
            return {rows, source: {...duffel, status: 'live', updatedAt: deps.now().toISOString(),
                description: 'До 30 действующих предложений в EUR за всех указанных пассажиров, экономический класс. Тариф имеет срок действия.'}}
        } catch {
            return {rows: [], source: {...duffel, status: 'unavailable', updatedAt: null,
                description: 'Duffel не смог подтвердить предложения по этому запросу.'}}
        }
    }
    async function search(query: FlightQuery): Promise<FlightSearch> {
        const restriction = travelRestriction({kind: 'flights', ...query})
        if (restriction) {
            return {query, routeQuote: null, routeQuotes: [], offers: [], calendar: [], calendars: [], links: [], carrierLinks: [],
                sources: [{id: 'route-review', name: restriction.title, url: restriction.evidence[0].url, status: 'unavailable',
                    updatedAt: restriction.evidence[0].checkedAt, description: restriction.description}]}
        }
        const now = deps.now().getTime()
        const key = JSON.stringify([query.origin, query.destination, query.departure, query.returnDate, query.adults, query.checkedBag])
        const cached = cache.get(key)
        if (cached && cached.until > now && cached.result.offers.every(o => Date.parse(o.expiresAt) > now)) {
            function cachedSource(source: SupplySource): SupplySource {
                return source.status == 'live' ? {...source, status: 'cached'} : source
            }
            return {...cached.result, sources: cached.result.sources.map(cachedSource),
                calendars: cached.result.calendars?.map(calendar => ({...calendar, source: cachedSource(calendar.source)}))}
        }
        const fetching = pending.get(key)
        if (fetching) return fetching
        if (pending.size >= 6) return {query, routeQuote: null, routeQuotes: [], offers: [], calendar: [], calendars: [],
            comparison: compareFlightOffers([], deps.now()), links: publicLinks(query), carrierLinks: directAirlineLinks(query),
            sources: [google, baltic, duffel].map(s => ({...s, status: 'unavailable', updatedAt: null,
                description: 'Идёт несколько поисков. Повторите позже.'}))}
        const requests = [fares(query), calendar(query), routeQuotes(query), ryanairCalendar(deps, query), resolveAirlineLinks(deps, query)] as const
        const work = Promise.all(requests).then(([fares, dates, reference, irish, carrierLinks]) => {
            const calendars = [{providerId: 'airbaltic', providerName: 'airBaltic', ...dates, basis: 'one-adult-one-way' as const},
                {providerId: 'ryanair', providerName: 'Ryanair', ...irish, basis: 'one-adult-one-way' as const}]
            const result = {query, routeQuote: reference.quotes[0] ?? null, routeQuotes: reference.quotes, offers: fares.rows,
                calendar: dates.rows, calendars, comparison: compareFlightOffers(fares.rows, deps.now()),
                sources: [dates.source, irish.source, reference.source, fares.source, ...aggregatorHandoffs(query)],
                links: publicLinks(query), carrierLinks} satisfies FlightSearch
            const ttl = result.sources.some(s => s.status == 'unavailable') ? 10_000 : 60_000
            if (cache.size >= 100) cache.delete(cache.keys().next().value!)
            cache.set(key, {result, until: deps.now().getTime() + ttl})
            return result
        })
        pending.set(key, work)
        try { return await work } finally { pending.delete(key) }
    }
    return {search}
}
