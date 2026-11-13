import type {IncomingMessage, ServerResponse} from 'node:http'
import type {createCatalogEvents} from './catalog-events.ts'
import type {SupplyHotel, SupplyOptions} from '../src/supply-contract.ts'
import {createPlaceCatalog, searchPhrase, type PlaceQuery, type PlaceRegion} from './catalog.ts'

interface SupplyDeps {
    catalog: ReturnType<typeof createPlaceCatalog>
    partners: (args: {
        hotel: SupplyHotel | null, destination: PlaceRegion,
        checkIn: string | null, checkOut: string | null, adults: number,
    }) => Promise<SupplyOptions>
    events?: ReturnType<typeof createCatalogEvents>
    today?: () => string
}

function numberParam(value: string | null, fallback: number, max: number, min: number) {
    if (value == null) return fallback
    if (!/^\d+$/.test(value)) throw new RangeError('Введите целое число.')
    const result = Number(value)
    if (result < min || result > max) throw new RangeError('Значение выходит за пределы диапазона.')
    return result
}

function mapBox(params: URLSearchParams): PlaceQuery['box'] {
    const values = ['west', 'south', 'east', 'north'].map(key => params.get(key))
    if (values.every(v => v == null)) return null
    if (values.some(v => v == null || !v.trim())) throw new RangeError('Укажите все границы карты.')
    const bounds = values.map(Number)
    if (!bounds.every(Number.isFinite)) throw new RangeError('Некорректные координаты карты.')
    const [west, south, east, north] = bounds
    if (west < -180 || east > 180 || west > east) throw new RangeError('Некорректный диапазон долгот.')
    if (south < -90 || north > 90 || south > north) throw new RangeError('Некорректный диапазон широт.')
    return [west, south, east, north]
}

function validateTravelDates(checkIn: string | null, checkOut: string | null, today: string) {
    if (checkIn == null && checkOut == null) return
    if (!checkIn || !checkOut) throw new RangeError('Укажите обе даты поездки.')
    for (const date of [checkIn, checkOut]) {
        const epoch = Date.parse(date + 'T00:00:00Z')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(epoch)) throw new RangeError('Некорректная дата.')
        if (new Date(epoch).toISOString().slice(0, 10) != date) throw new RangeError('Некорректная дата.')
    }
    if (checkIn < today || checkOut <= checkIn) throw new RangeError('Проверьте порядок дат и день выезда.')
    if (Date.parse(checkOut) - Date.parse(checkIn) > 30 * 86_400_000) throw new RangeError('Поиск доступен для поездок до 30 ночей.')
}

function json(response: ServerResponse, status: number, body: unknown) {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify(body))
}

export function createSupplyMiddleware(deps: SupplyDeps) {
    return async function supply(request: IncomingMessage, response: ServerResponse, next: () => void) {
        const raw = request.url ?? '/'
        if (!raw.startsWith('/api/travel/')) return next()
        if (request.method != 'GET') {
            response.setHeader('Allow', 'GET')
            return json(response, 405, {error: 'Используйте GET.'})
        }
        const url = new URL(raw, 'http://localhost/')
        const params = url.searchParams
        if (url.pathname == '/api/travel/destinations') return json(response, 200, {destinations: deps.catalog.destinations})
        const routes = ['/api/travel/catalog', '/api/travel/hotel', '/api/travel/events', '/api/travel/options']
        if (!routes.includes(url.pathname)) return json(response, 404, {error: 'Маршрут не найден.'})
        const id = params.get('destination') ?? deps.catalog.destinations[0]?.id
        const destination = deps.catalog.destinations.find(region => region.id == id)
        if (!destination) return json(response, 404, {error: 'Направление не найдено.'})
        try {
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
            const today = deps.today?.() ?? new Date().toISOString().slice(0, 10)
            validateTravelDates(checkIn, checkOut, today)
            const adults = numberParam(params.get('adults'), 2, 8, 1)
            return json(response, 200, await deps.partners({destination, hotel: hotel ?? null, checkIn, checkOut, adults}))
        } catch (error) {
            if (error instanceof RangeError) return json(response, 400, {error: error.message})
            return json(response, 503, {error: 'Не удалось получить данные. Попробуйте ещё раз.'})
        }
    }
}
