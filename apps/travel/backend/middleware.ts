import type {IncomingMessage, ServerResponse} from 'node:http'
import type {createCatalogEvents} from './catalog-events.ts'
import type {SupplyHotel, SupplyOptions} from '../src/supply-contract.ts'
import {dateValue, mapBox, numberParam, packageQuery, validateTravelDates} from './travel-query.ts'
import {serveAssistant} from './assistant-http.ts'
import {findAirports} from './flights/airports.ts'
import {readFlightQuery, type createFlights} from './flights/index.ts'
import type {createTravelAssistant} from './assistant.ts'
import type {createPackages} from './packages.ts'
import {createPlaceCatalog, searchPhrase, type PlaceRegion} from './catalog.ts'
import {serveProviders} from './providers/http.ts'
import type {createProviderRegistry} from './providers/index.ts'

interface SupplyDeps {
    catalog: ReturnType<typeof createPlaceCatalog>
    partners: (args: {
        hotel: SupplyHotel | null, destination: PlaceRegion,
        checkIn: string | null, checkOut: string | null, adults: number,
    }) => Promise<SupplyOptions>
    events?: ReturnType<typeof createCatalogEvents>
    packages?: ReturnType<typeof createPackages>
    assistant?: ReturnType<typeof createTravelAssistant>
    flights?: ReturnType<typeof createFlights>
    providers?: ReturnType<typeof createProviderRegistry>
    today?: () => string
}

function json(response: ServerResponse, status: number, body: unknown) {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify(body))
}

function readHotelId(value: string | null) {
    if (!value || !/^tez:[1-9]\d{0,14}$/.test(value)) throw new RangeError('Укажите отель туроператора.')
    return value
}

export function createSupplyMiddleware(deps: SupplyDeps) {
    return async function supply(request: IncomingMessage, response: ServerResponse, next: () => void) {
        const raw = request.url ?? '/'
        if (!raw.startsWith('/api/travel/')) return next()
        const url = new URL(raw, 'http://localhost/')
        if (url.pathname == '/api/travel/chat' || url.pathname == '/api/travel/mcp') {
            return serveAssistant({request, response, assistant: deps.assistant, mcp: url.pathname.endsWith('/mcp')})
        }
        if (['/api/travel/providers', '/api/travel/provider-search', '/api/travel/deals'].includes(url.pathname)) {
            return serveProviders({request, response, url, providers: deps.providers, today: deps.today?.() ?? new Date().toISOString().slice(0, 10)})
        }
        if (request.method != 'GET') {
            response.setHeader('Allow', 'GET')
            return json(response, 405, {error: 'Используйте GET.'})
        }
        const params = url.searchParams
        if (url.pathname == '/api/travel/destinations') return json(response, 200, {destinations: deps.catalog.destinations})
        if (url.pathname == '/api/travel/airports') {
            const phrase = params.get('q') ?? ''
            try {
                if (phrase.length > 120) throw new RangeError('Слишком длинный поисковый запрос.')
                return json(response, 200, {items: findAirports(phrase, numberParam(params.get('limit'), 12, 30, 1))})
            } catch (error) {
                if (error instanceof RangeError) return json(response, 400, {error: error.message})
                return json(response, 503, {error: 'Не удалось прочитать справочник аэропортов.'})
            }
        }
        if (url.pathname == '/api/travel/flights') {
            if (!deps.flights) return json(response, 503, {error: 'Поиск авиабилетов недоступен.'})
            try {
                const query = readFlightQuery(params, deps.today?.() ?? new Date().toISOString().slice(0, 10))
                return json(response, 200, await deps.flights.search(query))
            } catch (error) {
                if (error instanceof RangeError) return json(response, 400, {error: error.message})
                return json(response, 503, {error: 'Не удалось получить рейсы.'})
            }
        }
        const routes = ['/api/travel/catalog', '/api/travel/hotel', '/api/travel/events', '/api/travel/options',
            '/api/travel/packages', '/api/travel/package-calendar', '/api/travel/package-compare', '/api/travel/package-recheck']
        if (!routes.includes(url.pathname)) return json(response, 404, {error: 'Маршрут не найден.'})
        const id = params.get('destination') ?? deps.catalog.destinations[0]?.id
        const destination = deps.catalog.destinations.find(region => region.id == id)
        if (!destination) return json(response, 404, {error: 'Направление не найдено.'})
        try {
            const today = deps.today?.() ?? new Date().toISOString().slice(0, 10)
            if (url.pathname.startsWith('/api/travel/package')) {
                if (!deps.packages) return json(response, 503, {error: 'Пакетный поиск недоступен.'})
                const {trip, filter} = packageQuery(params, destination.id, today)
                if (url.pathname == '/api/travel/packages') return json(response, 200, await deps.packages.search(trip, filter))
                const controller = new AbortController()
                const cancel = () => controller.abort()
                response.once('close', cancel)
                try {
                    if (url.pathname == '/api/travel/package-calendar') {
                        const chart = await deps.packages.calendar(trip, filter, readHotelId(params.get('hotelId')), controller.signal)
                        if (!chart) return json(response, 404, {error: 'Предложение для этого отеля больше не найдено в выбранном окне.'})
                        return json(response, 200, chart)
                    }
                    const departure = dateValue(params.get('departure'))
                    if (departure < trip.first || departure > trip.last) throw new RangeError('Дата вылета должна входить в окно поиска.')
                    if (url.pathname == '/api/travel/package-compare') {
                        const ids = (params.get('hotelIds') ?? '').split(',')
                        if (ids.length > 3 || new Set(ids).size != ids.length) throw new RangeError('Выберите до трёх разных отелей.')
                        return json(response, 200, await deps.packages.compare(trip, filter, ids.map(readHotelId), departure, controller.signal))
                    }
                    const fareId = params.get('fareId') ?? ''
                    if (!/^tez-offer:[a-f0-9]{24}$/.test(fareId)) throw new RangeError('Укажите тариф туроператора.')
                    return json(response, 200, await deps.packages.recheck(trip, filter, readHotelId(params.get('hotelId')), departure, fareId))
                } finally {
                    response.off('close', cancel)
                }
            }
            if (url.pathname == '/api/travel/events') {
                if (!deps.events) return json(response, 503, {error: 'Подписка недоступна.'})
                return deps.events.subscribe(request, response, destination.id, params.get('since'))
            }
            if (url.pathname == '/api/travel/hotel') {
                const key = params.get('hotelId')
                if (!key || key.length > 200) throw new RangeError('Укажите идентификатор отеля.')
                const hotel = deps.catalog.find(destination, key) ?? null
                return json(response, 200, {hotel, revision: deps.events?.revision(destination.id)})
            }
            if (url.pathname == '/api/travel/catalog') {
                const source = params.get('source') || null
                if (source && !destination.sourceIds.includes(source)) throw new RangeError('Источник для этого направления недоступен.')
                const phrase = params.get('q') ?? ''
                if (phrase.length > 120) throw new RangeError('Слишком длинный поисковый запрос.')
                const query = {
                    q: searchPhrase(phrase), source, box: mapBox(params), destination,
                    offset: numberParam(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0),
                    limit: numberParam(params.get('limit'), 24, 100, 1),
                }
                const page = deps.catalog.list(query)
                return json(response, 200, {...page, revision: deps.events?.revision(destination.id)})
            }
            const hotelId = params.get('hotelId')
            const hotel = hotelId ? deps.catalog.find(destination, hotelId) : null
            if (hotelId && !hotel) return json(response, 404, {error: 'Отель не найден в этом направлении.'})
            const checkIn = params.get('checkIn')
            const checkOut = params.get('checkOut')
            validateTravelDates(checkIn, checkOut, today)
            const adults = numberParam(params.get('adults'), 2, 8, 1)
            return json(response, 200, await deps.partners({destination, hotel: hotel ?? null, checkIn, checkOut, adults}))
        } catch (error) {
            if (error instanceof RangeError) return json(response, 400, {error: error.message})
            return json(response, 503, {error: 'Не удалось получить данные. Попробуйте ещё раз.'})
        }
    }
}
