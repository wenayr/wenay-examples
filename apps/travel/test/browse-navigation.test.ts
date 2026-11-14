import assert from 'node:assert/strict'
import test from 'node:test'
import {browseFields, browseForRoute, travelHash, travelRoute} from '../frontend/navigation.ts'

test('a shared catalogue search restores its page, map area, view and selected property', () => {
    const saved = {offset: 24, view: 'map' as const, selection: 'osm:123', bounds: [-9.1, 53.1, -8.9, 53.4] as const}
    const link = travelHash('catalog', 'galway', {
        checkIn: '2030-01-15', checkOut: '2030-01-25', adults: 3, search: 'hotel', ...browseFields(saved),
    })
    const route = travelRoute(link)
    assert.equal(route.page, 'catalog')
    assert.equal(route.destination, 'galway')
    assert.equal(route.query.get('adults'), '3')
    assert.deepEqual(browseForRoute(route, 12), saved)
})

test('invalid URL map areas and pagination do not become catalogue requests', () => {
    const reversed = travelRoute('#packages/hurghada?offset=-12&view=other&west=40&south=25&east=30&north=28')
    assert.deepEqual(browseForRoute(reversed, 12), {offset: 0, view: 'list', selection: '', bounds: null})
    const incomplete = travelRoute('#catalog/dublin?offset=NaN&west=-7&south=52&east=-6')
    assert.equal(browseForRoute(incomplete, 12).bounds, null)
    assert.equal(browseForRoute(incomplete, 12).offset, 0)
    const page = travelRoute('#catalog/dublin?offset=25&hotelId=property-1')
    assert.equal(browseForRoute(page, 12).offset, 24)
    assert.equal(browseForRoute(page, 12).selection, 'property-1')
})
