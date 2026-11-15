import assert from 'node:assert/strict'
import test from 'node:test'
import type {PackageHotel, PackageMarker} from '../src/package-contract.ts'
import {mapHotelReference, restoreSelectedMapHotel, selectedMapHotelReference} from '../frontend/package-map-selection.ts'

const hotel = {
    id: 'tez:1061', destinationId: 'hurghada', name: 'SAND BEACH 3 *', stars: 3,
    latitude: 27.25, longitude: 33.82, url: 'https://www.tez-tour.com/hotel.html?id=1061',
} satisfies PackageHotel

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
