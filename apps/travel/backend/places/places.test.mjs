import assert from 'node:assert/strict'
import test from 'node:test'
import {placeDestinations, readPlaceSnapshot, refreshPlaceDestination, snapshotPath} from './index.mjs'
import {extractPlaces, placeRequest} from './providers.mjs'

const hurghada = placeDestinations.find(region => region.id == 'hurghada')
const dublin = placeDestinations.find(region => region.id == 'dublin')

test('coordinates and tag types filter a mixed Overpass result', () => {
    const tags = {name: 'Hotel Test', tourism: 'hotel', website: 'javascript:void(0)'}
    const element = {type: 'way', id: 12, center: {lat: 27.2, lon: 33.8}, tags}
    const outside = {...element, center: {lat: 53.3, lon: -6.2}}
    const records = extractPlaces({elements: [element, outside]}, hurghada, 'osm')
    assert.equal(records.length, 1)
    assert.equal(records[0].website, null)
    assert.equal(records[0].propertyId, 'way:12')
    assert.throws(() => extractPlaces({remark: 'runtime error', elements: []}, hurghada, 'osm'))
})

test('Wikidata removes duplicate item coordinates, ID-only labels and non-local places', () => {
    function wikidataRow(name, point) {
        return {hotel: {value: 'http://www.wikidata.org/entity/Q123'}, hotelLabel: {value: name}, coord: {value: point}}
    }
    const row = wikidataRow('Resort Test', 'Point(33.80 27.2)')
    const rows = [wikidataRow('Q123', 'Point(33.82 27.1)'), wikidataRow('Wrong region', 'Point(-6.21 53.3)'), row, row]
    const records = extractPlaces({results: {bindings: rows}}, hurghada, 'wikidata')
    assert.equal(records.length, 1)
    assert.equal(records[0].name, 'Resort Test')
})

test('Irish register reads quotes, commas, CRLF and skips wrong regions', () => {
    const csv = '\uFEFF"Sector","Property Reg Number","Account Name","Address City/Town","Latitude","Longitude"\r\n'
        + '"Hotel","X","Hotel, ""Green""","Dublin","53.33","-6.24"\r\n'
        + '"Hotel","Y","Other","Cork","51.89","-8.47"\r\n'
    const records = extractPlaces(csv, dublin, 'failte')
    assert.deepEqual(records.map(property => property.name), ['Hotel, "Green"'])
    assert.throws(() => extractPlaces('bad schema', dublin, 'failte'))
})

test('only a fixed registered region can be requested and opened on disk', () => {
    assert.throws(() => snapshotPath('../x', 'osm'))
    assert.throws(() => readPlaceSnapshot('hurghada', 'failte'))
    const parsedQuery = placeRequest(hurghada, 'osm').searchParams.get('data')
    assert.ok(parsedQuery.includes('27.03,33.72,27.35,33.97'))
})

test('feed errors propagate and a genuinely empty response retains its observation time', async () => {
    await assert.rejects(refreshPlaceDestination('dublin', 'osm', {fetchImpl: async () => new Response(null, {status: 429})}), /429/)
    const snapshot = await refreshPlaceDestination('dublin', 'osm', {fetchImpl: async () => Response.json({elements: []})})
    assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)))
    assert.equal(snapshot.records.length, 0)
})

test('committed reference records have stable source identity, provenance and no commercial rate', () => {
    const samples = [...readPlaceSnapshot('hurghada', 'wikidata').records, ...readPlaceSnapshot('dublin', 'failte').records]
    assert.ok(samples.length > 100)
    for (const row of samples) {
        assert.ok(row.id.startsWith(row.sourceId + ':'))
        assert.equal(row.price, null)
        assert.equal(row.photo, null)
        assert.ok(row.sourceUrl.startsWith('https://'))
    }
})
