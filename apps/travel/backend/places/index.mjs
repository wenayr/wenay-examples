import {readFileSync} from 'node:fs'
import {placeSources, placeDestinations} from './registry.mjs'
import {expandPlace, extractPlaces, placeRequest} from './providers.mjs'

export {placeSources, placeDestinations}

const userAgent = 'WenayTravel/0.1 (+https://github.com/wenayr/wenay-examples)'
const snapshotColumns = ['propertyId', 'name', 'latitude', 'longitude', 'category', 'locality', 'website', 'wikidataId']

function regionFor(destinationId, sourceId) {
    const region = placeDestinations.find(item => item.id == destinationId)
    if (!region?.sourceIds.includes(sourceId)) throw new RangeError('Unknown destination or source')
    return region
}

export function snapshotPath(destinationId, sourceId) {
    regionFor(destinationId, sourceId)
    return new URL('./snapshots/' + destinationId + '-' + sourceId + '.json', import.meta.url)
}

export function encodePlaceSnapshot(snapshot) {
    const prefix = snapshot.sourceId + ':'
    const rows = snapshot.records.map(record => {
        const compact = {...record, propertyId: record.id.slice(prefix.length)}
        return snapshotColumns.map(key => compact[key])
    })
    return JSON.stringify({version: 1, fetchedAt: snapshot.fetchedAt, rows}) + '\n'
}

export function readPlaceSnapshot(destinationId, sourceId) {
    const region = regionFor(destinationId, sourceId)
    const path = snapshotPath(destinationId, sourceId)
    let raw
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
        if (error.code == 'ENOENT') return {sourceId, records: [], fetchedAt: null}
        throw error
    }
    if (raw.version != 1 || !Array.isArray(raw.rows)) throw new Error('Unknown place snapshot format')
    const records = raw.rows.map(row => {
        const fields = Object.fromEntries(snapshotColumns.map((key, i) => [key, row[i]]))
        return expandPlace(fields, region, sourceId)
    })
    return {sourceId, records, fetchedAt: raw.fetchedAt}
}

export async function refreshPlaceDestination(destinationId, sourceId, {fetchImpl = fetch, signal} = {}) {
    const region = regionFor(destinationId, sourceId)
    const timer = AbortSignal.timeout(35_000)
    const requestSignal = signal ? AbortSignal.any([timer, signal]) : timer
    const accept = sourceId == 'failte' ? 'text/csv, */*;q=0.5' : 'application/json, application/sparql-results+json'
    const response = await fetchImpl(placeRequest(region, sourceId), {headers: {'user-agent': userAgent, accept}, signal: requestSignal})
    if (!response.ok) {
        const error = new Error(sourceId + ' returned HTTP ' + response.status)
        throw Object.assign(error, {status: response.status})
    }
    const raw = sourceId == 'failte' ? await response.text() : await response.json()
    const records = extractPlaces(raw, region, sourceId).map(item => expandPlace(item, region, sourceId))
    return {sourceId, records, fetchedAt: new Date().toISOString()}
}
