import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {findAirports} from '../../flights/airports.ts'
import {object, ProviderQueryError, refs, requestJson, rows, text} from './common.ts'

const geoCache = new Map<string, {location: string, until: number}>()

async function coordinateLocation(query: ProviderQuery, deps: ProviderDeps) {
    if (!Number.isFinite(query.latitude) || !Number.isFinite(query.longitude)) {
        throw new ProviderQueryError('Укажите город, координаты или Xotelo location_key для поиска отелей.')
    }
    const key = query.latitude!.toFixed(2) + ',' + query.longitude!.toFixed(2)
    const previous = geoCache.get(key)
    if (previous && previous.until > deps.now().getTime()) return previous.location
    const center = 'Point(' + query.longitude + ' ' + query.latitude + ')'
    const sparql = 'SELECT ?tripadvisor ?distance ?population WHERE { ?place wdt:P3134 ?tripadvisor; wdt:P1082 ?population. SERVICE wikibase:around { ' +
        '?place wdt:P625 ?point. bd:serviceParam wikibase:center "' + center + '"^^geo:wktLiteral; ' +
        'wikibase:radius "80"; wikibase:distance ?distance. } FILTER(REGEX(STR(?tripadvisor), "^[0-9]+$")) } ORDER BY DESC(?population) ?distance LIMIT 1'
    const params = new URLSearchParams({query: sparql, format: 'json'})
    const payload = object(await requestJson(deps, 'https://query.wikidata.org/sparql?' + params, {
        headers: {Accept: 'application/sparql-results+json', 'User-Agent': 'WenayTravel/0.1 (+https://github.com/wenayr/wenay-examples)'}
    }))
    const matches = rows(object(payload.results).bindings, 'Wikidata nearby places').map(object)
    const code = text(object(matches[0]?.tripadvisor).value)
    if (!/^\d+$/.test(code)) throw new ProviderQueryError('В этом районе не найден Xotelo location_key. Уточните город или код направления.')
    const location = 'g' + code
    if (geoCache.size >= 100) geoCache.delete(geoCache.keys().next().value!)
    geoCache.set(key, {location, until: deps.now().getTime() + 86_400_000})
    return location
}

function values(entity: Record<string, unknown>, property: string) {
    const statements = object(entity.claims)[property]
    if (!Array.isArray(statements)) return []
    return statements.map(statement => object(object(object(statement).mainsnak).datavalue).value)
}

function distance(latitude: number, longitude: number, point: Record<string, unknown>) {
    const radians = Math.PI / 180
    const a = Math.sin((Number(point.latitude) - latitude) * radians / 2) ** 2
    const b = Math.cos(latitude * radians) * Math.cos(Number(point.latitude) * radians)
    const c = Math.sin((Number(point.longitude) - longitude) * radians / 2) ** 2
    return 6371 * 2 * Math.atan2(Math.sqrt(a + b * c), Math.sqrt(1 - a - b * c))
}

export async function xoteloLocation(query: ProviderQuery, deps: ProviderDeps) {
    const explicit = refs(query, 'xotelo').destinationId
    if (explicit && /^g\d+$/.test(explicit)) return explicit
    const requested = query.destination?.trim()
    if (!requested) return coordinateLocation(query, deps)
    const airport = /^[A-Z]{3}$/.test(requested) ? findAirports(requested, 1).find(row => row.iata == requested) : undefined
    const place = (airport?.city || requested).replace(/\s*\([^)]*\)/g, '').replace(/ am Main$/i, '')
    const headers = {'User-Agent': 'WenayTravel/0.1 (+https://github.com/wenayr/wenay-examples)'}
    const language = /[а-яё]/i.test(place) ? 'ru' : 'en'
    const search = new URLSearchParams({action: 'wbsearchentities', search: place, language, type: 'item', limit: '5', format: 'json'})
    const matches = object(await requestJson(deps, 'https://www.wikidata.org/w/api.php?' + search, {headers}))
    const candidates = rows(matches.search, 'Wikidata places').map(object).filter(row => {
        const name = text(row.label).toLowerCase()
        const alias = text(object(row.match).text).toLowerCase()
        return name == place.toLowerCase() || alias == place.toLowerCase()
    })
    const ids = candidates.map(row => text(row.id)).filter(id => /^Q\d+$/.test(id))
    if (!ids.length) throw new ProviderQueryError('Не удалось однозначно сопоставить город. Укажите Xotelo location_key.')
    const params = new URLSearchParams({action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'en', format: 'json'})
    const entities = object(object(await requestJson(deps, 'https://www.wikidata.org/w/api.php?' + params, {headers})).entities)
    const places = Object.values(entities).map(object).flatMap(entity => {
        const location = values(entity, 'P3134').find(value => typeof value == 'string' && /^\d+$/.test(value))
        if (typeof location != 'string') return []
        const point = object(values(entity, 'P625')[0])
        const hasCoordinates = Number.isFinite(query.latitude) && Number.isFinite(query.longitude)
        const usablePoint = Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
        if (hasCoordinates && !usablePoint) return []
        if (hasCoordinates && distance(query.latitude!, query.longitude!, point) > 80) return []
        return ['g' + location]
    })
    const unique = [...new Set(places)]
    if (unique.length != 1) return coordinateLocation(query, deps)
    return unique[0]
}

export async function xoteloHotels(query: ProviderQuery, deps: ProviderDeps) {
    const offset = query.offset ?? 0
    const limit = Math.min(query.limit ?? 10, 20)
    const keys = refs(query, 'xotelo').hotelIds
    if (keys?.length) {
        if (keys.some(key => !/^g\d+-d\d+$/.test(key))) throw new ProviderQueryError('Нужны Xotelo hotel_key вида g60763-d93481.')
        const hotels = keys.slice(offset, offset + limit).map(key => ({key, name: key, image: '', url: '', latitude: undefined as number | undefined,
            longitude: undefined as number | undefined}))
        return {hotels, total: keys.length, nextOffset: offset + limit < keys.length ? offset + limit : null}
    }
    const location = await xoteloLocation(query, deps)
    const params = new URLSearchParams({location_key: location, limit: String(limit), offset: String(offset), sort: 'best_value'})
    const payload = object(await requestJson(deps, 'https://data.xotelo.com/api/list?' + params))
    if (payload.error) throw new Error('Xotelo не подтвердил список отелей')
    const result = object(payload.result)
    const page = rows(result.list, 'Xotelo hotel list')
    const hotels = page.map(object).flatMap(hotel => {
        const key = text(hotel.key)
        if (!/^g\d+-d\d+$/.test(key)) return []
        const geo = object(hotel.geo)
        const hasCoordinates = Number.isFinite(query.latitude) && Number.isFinite(query.longitude)
        const knownPoint = Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude)
        if (hasCoordinates && !knownPoint) return []
        if (hasCoordinates && distance(query.latitude!, query.longitude!, geo) > (query.radiusKm ?? 10)) return []
        return [{key, name: text(hotel.name) || key, image: text(hotel.image), url: text(hotel.url),
            latitude: typeof geo.latitude == 'number' ? geo.latitude : undefined,
            longitude: typeof geo.longitude == 'number' ? geo.longitude : undefined}]
    })
    const total = Number.isSafeInteger(result.total_count) ? Number(result.total_count) : null
    const nextOffset = page.length == limit && (total === null || offset + limit < total) ? offset + limit : null
    return {hotels, total, nextOffset}
}
