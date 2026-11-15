import type {SupplyDestination} from '../src/supply-contract.ts'
import type {createPackages} from './packages.ts'
import {packageDestinations} from '../src/package-contract.ts'
import {dateValue, mapBox, numberParam, packageQuery} from './travel-query.ts'
import {tezHotelGallery} from './partners/tez-media.ts'
import type {AgencySettings} from '../src/agency-contract.ts'
import {AgencyError, agencyIdentity} from './agency.ts'
import {createPackageLive} from './package-live.ts'
import {resolveProviderBufferConfig, type ProviderBufferConfig} from './provider-buffer-config.ts'

const paths = ['destinations', 'packages', 'package-map-hotels', 'package-hotel-search', 'package-calendar', 'package-trends',
    'package-matrix', 'package-gallery', 'package-compare', 'package-recheck'] as const
const readPaths = paths.map(path => '/api/travel/' + path)
export const packageHttpPaths = [...readPaths, '/api/travel/package-events']

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
    resolveSettings?: (request: Request) => Promise<AgencySettings | null>
    bufferConfig?: ProviderBufferConfig
}) {
    const bufferConfig = deps.bufferConfig ?? resolveProviderBufferConfig()
    async function read(request: Request): Promise<Response | null> {
        const url = new URL(request.url)
        if (!readPaths.includes(url.pathname)) return null
        if (request.method != 'GET') return packageJson(405, {error: 'Используйте GET.'}, {Allow: 'GET'})
        const params = url.searchParams
        try {
            request.signal.throwIfAborted()
            const settings = await deps.resolveSettings?.(request)
            const destinations = settings ? deps.destinations.filter(place => settings.destinations.includes(place.id)) : deps.destinations
            if (url.pathname == '/api/travel/destinations') {
                const id = params.get('id')
                const selected = id ? destinations.filter(place => place.id == id) : destinations
                return selected.length || !id ? packageJson(200, {destinations: selected}) : packageJson(404, {error: 'Область не найдена.'})
            }
            if (settings && !settings.sources.includes('tez')) return packageJson(403, {error: 'Источник туров выключен в настройках агентства.'})
            if (url.pathname == '/api/travel/package-gallery') {
                const id = hotelId(params.get('hotelId'))
                const details = params.get('details')
                if (details != null && details != '0' && details != '1') throw new RangeError('Используйте details=1 для сведений об отеле.')
                const base = tezHotelGallery(id)
                const gallery = details == '1' ? await deps.packages?.gallery(id, request.signal, true) ?? base
                    : base ?? await deps.packages?.gallery(id, request.signal)
                return gallery ? packageJson(200, gallery) : packageJson(404, {error: 'Фотографии этого отеля пока не найдены у поставщика.'})
            }
            if (settings && !destinations.length) return packageJson(403, {error: 'Выберите направления в настройках агентства, чтобы открыть поиск.'})
            if (!deps.packages) return packageJson(503, {error: 'Пакетный поиск недоступен.'})
            const destinationId = params.get('destination') ?? destinations[0]?.id
            const requested = destinations.find(place => place.id == destinationId)
            const mapFocus = requested && packageDestinations.includes(requested.id) ? requested :
                destinations.find(place => packageDestinations.includes(place.id))
            if (url.pathname == '/api/travel/package-map-hotels') {
                if (!mapFocus) return packageJson(404, {error: 'Направление не найдено.'})
                const filter = {box: mapBox(params), minStars: numberParam(params.get('minStars'), 0, 5, 0)}
                return packageJson(200, deps.packages.area.catalog(filter, mapFocus.id, settings?.destinations))
            }
            const areaValue = params.get('areaMode')
            if (areaValue != null && areaValue != 'map' && areaValue != 'destination') throw new RangeError('Выберите область карты или направление.')
            const mapPath = ['packages', 'package-hotel-search', 'package-trends'].some(path => url.pathname.endsWith('/' + path))
            const areaMode = areaValue == 'map' || areaValue == null && params.has('west') ? 'map' : 'destination'
            const areaRequest = mapPath && areaMode == 'map'
            const destination = areaRequest ? mapFocus : requested
            if (!destination) return packageJson(404, {error: 'Направление не найдено.'})
            const {trip, filter} = packageQuery(params, destination.id, deps.today?.() ?? new Date().toISOString().slice(0, 10))
            const refresh = refreshValue(params.get('refresh'))
            const options = {signal: request.signal, refresh, allowedDestinations: settings?.destinations}
            if (url.pathname == '/api/travel/package-hotel-search') {
                const paging = {...filter, limit: numberParam(params.get('limit'), 8, 20, 1)}
                if (areaRequest) return packageJson(200, await deps.packages.area.hotels(trip, paging, params.get('q') ?? '', 'map', options))
                return packageJson(200, await deps.packages.hotels(trip, {...paging, box: null}, params.get('q') ?? '', options))
            }
            if (url.pathname == '/api/travel/packages') {
                if (areaRequest) return packageJson(200, await deps.packages.area.search(trip, filter, 'map', options))
                return packageJson(200, await deps.packages.search(trip, filter, options))
            }
            if (url.pathname == '/api/travel/package-matrix') {
                const values = params.get('nightsValues') ?? String(trip.nights)
                if (!/^\d{1,2}(,\d{1,2}){0,5}$/.test(values)) throw new RangeError('Укажите длительность в ночах через запятую.')
                return packageJson(200, await deps.packages.matrix(trip, hotelId(params.get('hotelId')),
                    values.split(',').map(Number), request.signal, refresh))
            }
            if (url.pathname == '/api/travel/package-trends') {
                const requested = params.get('hotelIds')
                const ids = requested ? requested.split(',').map(hotelId) : undefined
                if (areaRequest) return packageJson(200, await deps.packages.area.trends(trip, filter, 'map', ids, request.signal, settings?.destinations))
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
            if (error instanceof AgencyError) return packageJson(error.status, {error: error.message, code: error.code})
            if (error instanceof RangeError) return packageJson(400, {error: error.message})
            return packageJson(503, {error: 'Не удалось получить данные поставщика. Попробуйте ещё раз.'})
        }
    }
    const live = createPackageLive({
        read,
        config: bufferConfig,
        async scope(request) {
            // The identity is supplied by the trusted hosting boundary. A digest keeps it
            // out of public resource keys, stream frames and health diagnostics.
            const value = agencyIdentity(request) ?? 'public'
            const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
            return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
        },
    })
    async function handle(request: Request, onStreamClose?: () => void): Promise<Response | null> {
        const stream = await live.handle(request, onStreamClose)
        if (stream) return stream
        const response = await read(request)
        if (response) {
            response.headers.set('x-travel-update-profile', bufferConfig.profile)
            response.headers.set('x-travel-shared-check-ms', String(bufferConfig.sharedCheckMs))
            await live.source.observed(request, response)
        }
        return response
    }
    return {handle, health: live.health, resource: live.resource}
}
