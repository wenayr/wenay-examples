import type {SupplyDestination} from '../src/supply-contract.ts'
import type {createPackages} from './packages.ts'
import {dateValue, numberParam, packageQuery} from './travel-query.ts'
import {tezHotelGallery} from './partners/tez-media.ts'

const paths = ['destinations', 'packages', 'package-hotel-search', 'package-calendar', 'package-trends',
    'package-matrix', 'package-gallery', 'package-compare', 'package-recheck'] as const
export const packageHttpPaths = paths.map(path => '/api/travel/' + path)

export function packageJson(status: number, body: unknown, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {status, headers: {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers,
    }})
}

function hotelId(value: string | null) {
    if (!value || !/^tez:[1-9]\d{0,14}$/.test(value)) throw new RangeError('Укажите отель туроператора.')
    return value
}

function refreshValue(value: string | null) {
    if (value != null && value != '0' && value != '1') throw new RangeError('Используйте refresh=1 для обновления цен.')
    return value == '1'
}

export function createPackageHttp(deps: {
    packages?: ReturnType<typeof createPackages>
    destinations: readonly SupplyDestination[]
    today?: () => string
}) {
    async function handle(request: Request): Promise<Response | null> {
        const url = new URL(request.url)
        if (!packageHttpPaths.includes(url.pathname)) return null
        if (request.method != 'GET') return packageJson(405, {error: 'Используйте GET.'}, {Allow: 'GET'})
        const params = url.searchParams
        try {
            request.signal.throwIfAborted()
            if (url.pathname == '/api/travel/destinations') return packageJson(200, {destinations: deps.destinations})
            if (url.pathname == '/api/travel/package-gallery') {
                const gallery = tezHotelGallery(hotelId(params.get('hotelId')))
                return gallery ? packageJson(200, gallery) : packageJson(404, {error: 'Фотографии этого отеля пока не найдены у поставщика.'})
            }
            if (!deps.packages) return packageJson(503, {error: 'Пакетный поиск недоступен.'})
            const destinationId = params.get('destination') ?? deps.destinations[0]?.id
            const destination = deps.destinations.find(place => place.id == destinationId)
            if (!destination) return packageJson(404, {error: 'Направление не найдено.'})
            const {trip, filter} = packageQuery(params, destination.id, deps.today?.() ?? new Date().toISOString().slice(0, 10))
            const refresh = refreshValue(params.get('refresh'))
            const options = {signal: request.signal, refresh}
            if (url.pathname == '/api/travel/package-hotel-search') {
                const paging = {...filter, box: null, limit: numberParam(params.get('limit'), 8, 20, 1)}
                return packageJson(200, await deps.packages.hotels(trip, paging, params.get('q') ?? '', options))
            }
            if (url.pathname == '/api/travel/packages') return packageJson(200, await deps.packages.search(trip, filter, options))
            if (url.pathname == '/api/travel/package-matrix') {
                const values = params.get('nightsValues') ?? String(trip.nights)
                if (!/^\d{1,2}(,\d{1,2}){0,5}$/.test(values)) throw new RangeError('Укажите длительность в ночах через запятую.')
                return packageJson(200, await deps.packages.matrix(trip, hotelId(params.get('hotelId')),
                    values.split(',').map(Number), request.signal, refresh))
            }
            if (url.pathname == '/api/travel/package-trends') {
                const requested = params.get('hotelIds')
                const ids = requested ? requested.split(',').map(hotelId) : undefined
                return packageJson(200, await deps.packages.trends(trip, filter, ids, request.signal))
            }
            if (url.pathname == '/api/travel/package-calendar') {
                const chart = await deps.packages.calendar(trip, filter, hotelId(params.get('hotelId')), request.signal)
                return chart ? packageJson(200, chart) : packageJson(404, {error: 'Отель не найден в выбранном окне.'})
            }
            const departure = dateValue(params.get('departure'))
            if (departure < trip.first || departure > trip.last) throw new RangeError('Дата вылета должна входить в окно поиска.')
            if (url.pathname == '/api/travel/package-compare') {
                const ids = (params.get('hotelIds') ?? '').split(',').map(hotelId)
                return packageJson(200, await deps.packages.compare(trip, filter, ids, departure, request.signal))
            }
            const fareId = params.get('fareId') ?? ''
            if (!/^tez-offer:[a-f0-9]{24}$/.test(fareId)) throw new RangeError('Укажите тариф туроператора.')
            return packageJson(200, await deps.packages.recheck(trip, filter, hotelId(params.get('hotelId')), departure, fareId))
        } catch (error) {
            if (request.signal.aborted) return packageJson(499, {error: 'Запрос отменён.'})
            if (error instanceof RangeError) return packageJson(400, {error: error.message})
            return packageJson(503, {error: 'Не удалось получить данные поставщика. Попробуйте ещё раз.'})
        }
    }
    return {handle}
}
