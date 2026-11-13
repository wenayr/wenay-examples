import {placeDestinations, placeSources, refreshAndSavePlaceDestination} from './index.mjs'

const [source, destination] = process.argv.slice(2)
if (source && !placeSources.some(entry => entry.id == source)) throw new Error('Unknown source')
if (destination && !placeDestinations.some(entry => entry.id == destination)) throw new Error('Unknown destination')

// Each public service gets at most one concurrent request; a failed fetch leaves its last snapshot intact.
async function refreshSource(sourceId) {
    const regions = placeDestinations.filter(item => item.sourceIds.includes(sourceId) && (!destination || item.id == destination))
    for (const region of regions) {
        try {
            const snapshot = await refreshAndSavePlaceDestination(region.id, sourceId)
            console.log(sourceId, region.id, snapshot.records.length, snapshot.fetchedAt)
        } catch (error) {
            process.exitCode = 1
            console.error(sourceId, region.id, error.message, error.cause?.code ?? '')
            if (error.status == 429) return
        }
    }
}

await Promise.all(placeSources.filter(entry => !source || entry.id == source).map(entry => refreshSource(entry.id)))
