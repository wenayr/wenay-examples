// Real snapshot codec, lazy destination views, filters and incremental invalidation; no upstream requests.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPlaceCatalog} from '../backend/catalog.ts'
import {encodePlaceSnapshot, placeDestinations, readPlaceSnapshot, savePlaceSnapshot, type PlaceDestination} from '../backend/places/index.mjs'

const count = Number(process.argv[2] ?? 750_000)
if (!Number.isSafeInteger(count) || count < 64) throw new RangeError('Укажите не менее 64 записей')
const temporary = mkdtempSync(join(tmpdir(), 'wenay-travel-bench-'))
process.env.TRAVEL_SNAPSHOT_DIR = temporary
const source = {id: 'wikidata', name: 'Wikidata'}
const regions = placeDestinations.map(region => ({...region, sourceIds: [source.id]}))
const observed = new Date(Math.max(Date.now(), Date.UTC(2027, 0, 1))).toISOString()

function syntheticRecord(id: number, region: PlaceDestination) {
    const wikidataId = 'Q' + (10000000 + id)
    return {
        id: 'wikidata:' + wikidataId, name: 'Synthetic Hotel ' + id, sourceId: source.id, sourceName: source.name,
        destinationId: region.id, category: 'Hotel', locality: region.name, website: null,
        latitude: region.latitude, longitude: region.longitude, registrationId: null, wikidataId,
        sourceUrl: 'https://www.wikidata.org/wiki/' + wikidataId, photo: null, price: null,
    } as const
}

function time<T>(operation: () => T) {
    const start = performance.now()
    const result = operation()
    return {result, ms: Number((performance.now() - start).toFixed(2))}
}

function run() {
    let bytes = 0
    for (const [i, region] of regions.entries()) {
        const start = Math.floor(i * count / regions.length)
        const end = Math.floor((i + 1) * count / regions.length)
        const records = Array.from({length: end - start}, (_, index) => syntheticRecord(start + index, region))
        const encoded = encodePlaceSnapshot({sourceId: source.id, records, fetchedAt: observed})
        const checksum = createHash('sha256').update(encoded).digest('hex')
        const generation = Date.parse(observed) + '-' + checksum
        writeFileSync(join(temporary, region.id + '-' + source.id + '.' + generation + '.json'), encoded)
        bytes += Buffer.byteLength(encoded)
    }
    globalThis.gc?.()
    const residentStart = process.memoryUsage().rss
    const changes: string[] = []
    const catalog = createPlaceCatalog({
        destinations: regions, sources: [source], readSnapshot: readPlaceSnapshot,
        photo: () => null, onChange: id => changes.push(id),
    })
    const region = regions[0]
    const query = {destination: region, q: '', source: null, box: null, offset: 0, limit: 24}
    const cold = time(() => catalog.list(query))
    const warm = time(() => {
        for (let i = 0; i < 1000; i++) catalog.list({...query, offset: i % cold.result.total})
    })
    const selected = cold.result.items[5]
    const search = time(() => catalog.list({...query, q: selected.name.toLowerCase()}))
    const byId = time(() => {
        for (let i = 0; i < 1000; i++) assert.equal(catalog.find(region, selected.id)?.id, selected.id)
    })
    const other = time(() => regions.slice(1).reduce((sum, destination) => sum + catalog.list({...query, destination}).total, 0))
    assert.equal(other.result + cold.result.total, count)
    const sourceData = readPlaceSnapshot(region.id, source.id)
    const filtered = sourceData.records.filter(row => row.id != selected.id)
    const update = time(() => {
        savePlaceSnapshot(region.id, {...sourceData, records: filtered, fetchedAt: new Date(Date.parse(observed) + 1).toISOString()})
        catalog.reloadSnapshot(region.id, source.id)
        assert.equal(catalog.find(region, selected.id), undefined)
    })
    const repeat = time(() => catalog.reloadSnapshot(region.id, source.id))
    assert.deepEqual(changes, [region.id])
    globalThis.gc?.()
    const mib = (bytes: number) => Number((bytes / 1048576).toFixed(1))
    console.log(JSON.stringify({
        records: count, regions: regions.length, filesMiB: mib(bytes), firstRegionRows: cold.result.total,
        firstRegionMs: cold.ms, warmPages1000Ms: warm.ms, firstFilteredMs: search.ms, filteredCount: search.result.total,
        byId1000Ms: byId.ms, remainingRegionsMs: other.ms,
        removalPersistReloadReindexMs: update.ms, identicalReloadMs: repeat.ms,
        rssBeforeReaderMiB: mib(residentStart), rssAfterAllRegionsMiB: mib(process.memoryUsage().rss),
        peakProcessMiB: mib(process.resourceUsage().maxRSS * 1024),
    }, null, 2))
    catalog.shutdown()
}

try {
    run()
} finally {
    rmSync(temporary, {recursive: true, force: true})
}
