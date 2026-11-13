import {fetchAndPublish} from './files.mjs'
import {placeSources, placeDestinations} from './registry.mjs'
import {expandPlace, extractPlaces, placeRequest} from './providers.mjs'

export {placeSources, placeDestinations}

const userAgent = 'WenayTravel/0.1 (+https://github.com/wenayr/wenay-examples)'
export {encodePlaceSnapshot, readPlaceSnapshot, runtimeSnapshotDirectory, savePlaceSnapshot, snapshotPath, snapshotReference, snapshotRegion} from './files.mjs'

export async function refreshPlaceDestination(destinationId, sourceId, {fetchImpl = fetch, signal} = {}) {
    const region = placeDestinations.find(item => item.id == destinationId)
    if (!region?.sourceIds.includes(sourceId)) throw new RangeError('Unknown destination or source')
    const fetchedAt = new Date().toISOString()
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
    const partial = sourceId == 'osm' && raw.elements.length >= 1000
    const limited = sourceId == 'wikidata' && raw.results.bindings.length >= 350
    return {sourceId, records, fetchedAt, partial: partial || limited}
}

export async function refreshAndSavePlaceDestination(destinationId, sourceId, options) {
    return fetchAndPublish(destinationId, sourceId, () => refreshPlaceDestination(destinationId, sourceId, options), options?.signal)
}
