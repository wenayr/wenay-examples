import assert from 'node:assert/strict'
import test from 'node:test'
import type {PackageHotel, PackageMarker} from '../src/package-contract.ts'
import {mapHotelReference, restoreSelectedMapHotel, selectedMapHotelReference} from '../frontend/package-map-selection.ts'
import {hotelsInMapArea, mapPriceStatus} from '../frontend/package-hotel.ts'

const hotel = {
    id: 'tez:1061', destinationId: 'hurghada', name: 'SAND BEACH 3 *', stars: 3,
    latitude: 27.25, longitude: 33.82, url: 'https://www.tez-tour.com/hotel.html?id=1061',
} satisfies PackageHotel

test('the current viewport can show and open catalog hotels before a fare, then hydrate only their quoted fields', () => {
    const box = [34.244, 27.904, 34.439, 28.043] as const
    const photo = {url: 'https://example.test/photo', sourceUrl: 'https://example.test/hotel', credit: '', license: '', licenseUrl: ''}
    const sharm = {...hotel, id: 'tez:sharm-hotel', name: 'Sharm hotel', destinationId: 'sharm', latitude: 27.956, longitude: 34.389, photo}
    const marker = {hotelId: sharm.id, name: sharm.name, stars: sharm.stars, latitude: sharm.latitude,
        longitude: sharm.longitude, minTotal: 125000, maxTotal: 132000}
    assert.deepEqual([...hotelsInMapArea([hotel], undefined, box)], [])
    const catalog = [hotel, sharm, {...hotel, id: 'unmapped', latitude: null, longitude: null}]
    assert.deepEqual([...hotelsInMapArea(catalog, undefined, box).values()], [sharm])
    assert.deepEqual([...hotelsInMapArea(catalog, {markers: [], knownHotels: []}, box).values()], [sharm])
    const priced = hotelsInMapArea(catalog, {markers: [marker], knownHotels: [sharm]}, box)
    assert.deepEqual([...priced.keys()], [sharm.id])
    assert.deepEqual(priced.get(sharm.id), {...sharm, ...marker})
    assert.equal(hotelsInMapArea(catalog, {markers: [marker]}, [33.6, 27, 34, 27.5]).has(sharm.id), false)
})

test('map status counts actual visible prices even when a refresh fails or just the selected hotel returns a fare', () => {
    const updatedAt = '2030-01-01T00:00:00Z'
    const source = {id: 'tez', name: 'TEZ', status: 'live', updatedAt, description: ''} as const
    const marker = {hotelId: hotel.id, name: hotel.name, latitude: hotel.latitude, longitude: hotel.longitude,
        stars: hotel.stars, minTotal: 135600, maxTotal: 135600}
    const page = {source, markers: [marker]}
    const points = [{id: hotel.id, priceTotal: 135600}, {id: 'other'}]
    assert.deepEqual(mapPriceStatus(points, page, false), {label: 'С ценой · 1 из 2'})
    assert.deepEqual(mapPriceStatus(points, page, false, 'HTTP 503'), {label: 'С ценой · 1 из 2', savedAt: updatedAt})
    assert.deepEqual(mapPriceStatus(points, {...page, source: {...source, stale: true}}, false), {label: 'С ценой · 1 из 2', savedAt: updatedAt})
    const fromMatrix = [{id: 'matrix-only', priceTotal: 110000}, {id: 'other'}]
    const unavailable = {markers: [], source: {...source, status: 'unavailable' as const, updatedAt: null}}
    assert.deepEqual(mapPriceStatus(fromMatrix, unavailable, false), {label: 'С ценой · 1 из 2'})
    assert.equal(mapPriceStatus(fromMatrix, page, false, 'HTTP 503')?.savedAt, undefined)
    assert.equal(mapPriceStatus([{id: 'unknown'}], unavailable, false)?.label, 'Цены пока не подтверждены')
    assert.equal(mapPriceStatus([], unavailable, false), null)
})

test('selected hotel survives a reload as metadata without cached money or fares', () => {
    const offered = {...hotel, minTotal: 93800, maxTotal: 100000, fareId: 'expired-fare', best: {id: 'expired-fare', total: 93800}}
    const reference = mapHotelReference(offered)
    const stored = JSON.parse(JSON.stringify({version: 1, ...reference, minTotal: 93800, fareId: 'expired-fare'}))
    assert.deepEqual(reference, hotel)
    assert.deepEqual(restoreSelectedMapHotel(stored), hotel)
})

test('stored map selection accepts unknown coordinates but rejects invalid points and versions', () => {
    const payload = {version: 1, ...hotel}
    assert.deepEqual(restoreSelectedMapHotel({...payload, latitude: null, longitude: null}), {...hotel, latitude: null, longitude: null})
    const invalid = [
        {...payload, latitude: NaN}, {...payload, latitude: 91}, {...payload, longitude: Infinity},
        {...payload, longitude: -181}, {...payload, latitude: null}, {...payload, version: 2},
        {...payload, id: ''}, {...payload, url: 'javascript:alert(1)'}, null,
    ]
    invalid.forEach(value => assert.equal(restoreSelectedMapHotel(value), null))
})

test('viewport fallback keeps only the selected identity and preserves its known location', () => {
    const previous = mapHotelReference(hotel)
    const marker = {
        hotelId: hotel.id, destinationId: hotel.destinationId, name: hotel.name, stars: hotel.stars,
        latitude: hotel.latitude, longitude: hotel.longitude, minTotal: 93800, maxTotal: 100000,
    } satisfies PackageMarker
    const other = {...hotel, id: 'tez:other', name: 'Another hotel', latitude: 28, longitude: 34}
    assert.deepEqual(selectedMapHotelReference(previous, hotel.id), previous)
    assert.deepEqual(selectedMapHotelReference(previous, hotel.id, other), previous)
    assert.equal(selectedMapHotelReference(previous, other.id, hotel), null)
    assert.deepEqual(selectedMapHotelReference(previous, other.id, other), other)
    assert.deepEqual(selectedMapHotelReference(previous, hotel.id, {...hotel, latitude: null, longitude: null}), hotel)
    assert.equal(selectedMapHotelReference(previous, hotel.id, marker), previous)
    const markerReference = mapHotelReference(marker)
    assert.deepEqual(restoreSelectedMapHotel({version: 1, ...markerReference}), {...hotel, url: ''})
    assert.equal(selectedMapHotelReference(previous, null, hotel), null)
})
