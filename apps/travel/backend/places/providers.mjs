import {placeSources} from './registry.mjs'

export const failteUrl = 'https://failteireland.azure-api.net/opendata-api/v2/accommodation/csv'

function safeWebsite(value) {
    try {
        const url = new URL(value)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
        return url.href
    } catch {
        return null
    }
}

function inside(region, latitude, longitude) {
    const [west, south, east, north] = region.bbox
    const validLatitude = Number.isFinite(latitude) && latitude >= south && latitude <= north
    const validLongitude = Number.isFinite(longitude) && longitude >= west && longitude <= east
    return validLatitude && validLongitude
}

function cleanName(value) {
    return typeof value == 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

export function placeRequest(region, sourceId) {
    const [west, south, east, north] = region.bbox
    if (sourceId == 'failte') return new URL(failteUrl)
    if (sourceId == 'osm') {
        const query = '[out:json][timeout:24];nwr[tourism~"^(hotel|hostel|motel|guest_house|resort|apartment)$"][name]'
            + '(' + [south, west, north, east].join(',') + ');out center 1000;'
        const url = new URL('https://overpass-api.de/api/interpreter')
        url.searchParams.set('data', query)
        return url
    }
    const query = [
        'SELECT ?hotel ?hotelLabel ?coord (SAMPLE(?web) AS ?website) WHERE {',
        'SERVICE wikibase:box { ?hotel wdt:P625 ?coord.',
        'bd:serviceParam wikibase:cornerWest "Point(' + west + ' ' + south + ')"^^geo:wktLiteral;',
        'wikibase:cornerEast "Point(' + east + ' ' + north + ')"^^geo:wktLiteral. }',
        '?hotel wdt:P31/wdt:P279* wd:Q27686.',
        'FILTER NOT EXISTS { ?hotel wdt:P576 ?closed. }',
        'FILTER NOT EXISTS { ?hotel wdt:P3999 ?closingDate. FILTER (?closingDate < NOW()) }',
        'OPTIONAL { ?hotel wdt:P856 ?web. }',
        'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ru,et,fr,de". }',
        '} GROUP BY ?hotel ?hotelLabel ?coord ORDER BY ?hotel LIMIT 350',
    ].join('\n')
    const url = new URL('https://query.wikidata.org/sparql')
    url.searchParams.set('query', query)
    url.searchParams.set('format', 'json')
    return url
}

const accommodationTypes = {
    hotel: 'Отель', hostel: 'Хостел', motel: 'Мотель', apartment: 'Апартаменты', guest_house: 'Гостевой дом', resort: 'Курортный отель',
}

// Only a file actually linked on this OSM feature is eligible for the importer's rights check.
function explicitCommonsFile(value) {
    if (typeof value != 'string') return null
    let title = value.trim()
    if (!title.startsWith('File:')) {
        try {
            const url = new URL(title)
            if (url.hostname != 'commons.wikimedia.org' || !['https:', 'http:'].includes(url.protocol)
                || !url.pathname.startsWith('/wiki/File:')) return null
            title = decodeURIComponent(url.pathname.slice('/wiki/'.length))
        } catch {
            return null
        }
    }
    return /^File:[^|;<>\n\r]+\.(jpe?g|png|webp)$/i.test(title) ? title.replaceAll('_', ' ') : null
}

function normalizeOsm(raw, region) {
    if (raw.remark || !Array.isArray(raw.elements)) throw new Error('Incomplete Overpass response')
    const result = []
    for (const entry of raw.elements) {
        const tags = entry.tags ?? {}
        const name = cleanName(tags['name:en'] || tags.name)
        const point = entry.center ?? entry
        const category = accommodationTypes[tags.tourism]
        if (!name || !category || !inside(region, point.lat, point.lon)) continue
        if (!['node', 'relation', 'way'].includes(entry.type) || !Number.isSafeInteger(entry.id)) continue
        const propertyId = entry.type + ':' + entry.id
        result.push({
            propertyId, name, latitude: point.lat, longitude: point.lon, category,
            locality: cleanName(tags['addr:city']) || region.name, website: safeWebsite(tags.website || tags['contact:website']),
            wikidataId: /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : null,
            commonsFile: explicitCommonsFile(tags.wikimedia_commons) ?? explicitCommonsFile(tags.image),
        })
    }
    return result
}

function normalizeWikidata(raw, region) {
    const rows = raw.results?.bindings
    if (!Array.isArray(rows)) throw new Error('Invalid Wikidata response')
    const items = new Map()
    for (const row of rows) {
        const propertyId = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(row.hotel?.value)?.[1]
        const point = /^Point\(([-.\d]+) ([-.\d]+)\)$/i.exec(row.coord?.value ?? '')
        const name = cleanName(row.hotelLabel?.value)
        const hasLabel = name && name != propertyId
        if (!hasLabel || !propertyId || !point) continue
        const longitude = Number(point[1])
        const latitude = Number(point[2])
        if (!inside(region, latitude, longitude) || items.has(propertyId)) continue
        items.set(propertyId, {
            propertyId, name, latitude, longitude, category: 'Размещение', locality: region.name,
            website: safeWebsite(row.website?.value), wikidataId: propertyId,
        })
    }
    return [...items.values()]
}

function csvRows(text) {
    const rows = []
    let row = []
    let field = ''
    let inQuotes = false
    const input = text.replace(/^\uFEFF/, '')
    for (let i = 0; i < input.length; i++) {
        const char = input[i]
        if (char == '"') {
            if (inQuotes && input[i + 1] == '"') {
                field += '"'
                i++
            } else inQuotes = !inQuotes
        } else if (!inQuotes && char == ',') {
            row.push(field)
            field = ''
        } else if (!inQuotes && char == '\n') {
            row.push(field.replace(/\r$/, ''))
            rows.push(row)
            row = []
            field = ''
        } else field += char
    }
    if (inQuotes) throw new Error('Truncated CSV')
    if (row.length || field) rows.push([...row, field.replace(/\r$/, '')])
    return rows
}

const failteTypes = {
    'Hotel': 'Отель', 'Guest House': 'Гостевой дом', 'Holiday Hostel': 'Хостел', 'Youth Hostel': 'Хостел',
    'Holiday Apartment': 'Апартаменты', 'Individual Self Catering Apartment': 'Апартаменты', 'B&Bs': 'Гостевой дом',
}

function normalizeFailte(raw, region) {
    const [columns, ...rows] = csvRows(raw)
    const required = ['Sector', 'Property Reg Number', 'Account Name', 'Address City/Town', 'Latitude', 'Longitude']
    if (!required.every(column => columns?.includes(column))) throw new Error('Invalid Fáilte Ireland register')
    const [sector, id, hotel, town, lat, lon] = required.map(column => columns.indexOf(column))
    const result = []
    for (const row of rows) {
        const latitude = Number(row[lat])
        const longitude = Number(row[lon])
        const name = cleanName(row[hotel])
        const category = failteTypes[row[sector]]
        const identified = name && row[id] && category
        if (!identified || !inside(region, latitude, longitude)) continue
        result.push({
            propertyId: row[id], name, latitude, longitude, category, locality: cleanName(row[town]) || region.name,
            website: null, wikidataId: null,
        })
    }
    return result
}

export function extractPlaces(raw, region, sourceId) {
    if (sourceId == 'osm') return normalizeOsm(raw, region)
    if (sourceId == 'wikidata') return normalizeWikidata(raw, region)
    return normalizeFailte(raw, region)
}

export function expandPlace(record, region, sourceId) {
    const {propertyId, ...data} = record
    const source = placeSources.find(entry => entry.id == sourceId)
    let sourceUrl = source.url
    if (sourceId == 'osm') sourceUrl += '/' + propertyId.replace(':', '/')
    if (sourceId == 'wikidata') sourceUrl += '/wiki/' + propertyId
    return {
        ...data, id: sourceId + ':' + propertyId, destinationId: region.id,
        sourceId, sourceName: source.name, sourceUrl, registrationId: sourceId == 'failte' ? propertyId : null, photo: null, price: null,
    }
}
