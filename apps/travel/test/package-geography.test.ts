import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {createOfferIndex, type PackageQuery} from '../backend/package-index.ts'
import {createPackages} from '../backend/packages.ts'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'

test('Hurghada supplier properties retain at least fifty individually sourced hotel positions', () => {
    type Location = {destination: string, id: number, latitude: number, longitude: number, source: string, checkedOn: string}
    const manifest = JSON.parse(readFileSync(new URL('../backend/partners/tez-locations.json', import.meta.url), 'utf8')) as {locations: Location[]}
    const overrides = JSON.parse(readFileSync(new URL('../backend/partners/tez-location-overrides.json', import.meta.url), 'utf8')) as {locations: Location[]}
    const combined = new Map([...manifest.locations, ...overrides.locations].map(hotel => [hotel.destination + ':' + hotel.id, hotel] as const))
    const hotels = [...combined.values()].filter(hotel => hotel.destination == 'hurghada')
    assert.ok(hotels.length >= 50)
    assert.equal(new Set(hotels.map(hotel => hotel.id)).size, hotels.length)
    const positions = new Set<string>()
    for (const hotel of hotels) {
        assert.ok(Number.isSafeInteger(hotel.id) && hotel.id > 0)
        assert.ok(hotel.latitude > 26 && hotel.latitude < 28)
        assert.ok(hotel.longitude > 33 && hotel.longitude < 35)
        assert.equal(new URL(hotel.source).protocol, 'https:')
        assert.match(hotel.checkedOn, /^\d{4}-\d{2}-\d{2}$/)
        positions.add(hotel.latitude + '/' + hotel.longitude)
    }
    assert.ok(positions.size >= 50)
})

test('geography counts cover all matches before pagination and the marker cap', () => {
    const departure = '2030-01-24'
    const hotels = Array.from({length: 202}, function propertyFixture(_, i) {
        const latitude = i == 201 ? null : 27 + i / 1000
        const longitude = i == 201 ? null : 33.8 + i / 1000
        return {id: 'h' + i, name: 'Hotel ' + i, stars: 4, latitude, longitude, url: ''}
    })
    const offers = hotels.map((hotel, i) => ({id: 'f' + i, hotelId: hotel.id, departure, total: 140000 + i}))
    const index = createOfferIndex({hotels, offers})
    const query = {firstDeparture: departure, lastDeparture: departure, minTotal: 0, maxTotal: 500000,
        box: null, minStars: 0, offset: 0, limit: 1} satisfies PackageQuery
    const result = index.search(query)
    assert.equal(result.total, 202)
    assert.equal(result.items.length, 1)
    assert.equal(result.markers.length, 200)
    assert.equal(result.markersTruncated, true)
    assert.deepEqual(result.geo, {mapped: 201, unresolved: 1, bounds: [33.8, 27, 34, 27.2]})
    const narrowed = index.search({...query, minTotal: 140100, maxTotal: 140201, box: [33.9, 27.1, 34, 27.2]})
    assert.equal(narrowed.total, 101)
    assert.deepEqual(narrowed.geo, {mapped: 101, unresolved: 0, bounds: [33.9, 27.1, 34, 27.2]})
    assert.equal(narrowed.markers[0].minTotal, 140100)
})

test('viewport coverage preserves the complete destination count and coordinate evidence', async () => {
    const trip = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-24', adults: 2, nights: 7,
        minTotal: 0, maxTotal: 500000}
    const provider = createTezInventory({now: () => new Date('2030-01-01'), fetch: async () => Response.json({
        success: true, departureCityId: 3746, data: [1061, 609, 10594885, 999999999].map((id, i) => [
            '24.01.2030', [], '', 7, '', ['', '', 5734], ['', 'HOTEL ' + id + ' 4 *', '', id],
            ['HB'], [], [[2, 0, 0]], {currency: 'EUR', total: 1400 + i}
        ])
    })})
    const service = createPackages(provider)
    const filter = {firstDeparture: trip.first, lastDeparture: trip.last, minTotal: 0, maxTotal: 500000,
        box: [33.82, 27.25, 33.83, 27.27], minStars: 0, offset: 0, limit: 1} satisfies PackageQuery
    const result = await service.search(trip, filter)
    assert.equal(result.total, 1)
    assert.equal(result.geo.mapped, 1)
    assert.deepEqual([result.direction.total, result.direction.mapped, result.direction.unresolved], [4, 3, 1])
    assert.equal(result.items[0].hotelId, 'tez:1061')
    assert.equal(result.items[0].coordinateSource?.url, 'https://www.tez-tour.com/hotel.html?id=1061')
    assert.equal(result.items[0].coordinateSource?.precision, 'hotel-marker')
    const unbounded = await service.search(trip, {...filter, box: null, limit: 10})
    const corrected = unbounded.items.find(hotel => hotel.hotelId == 'tez:10594885')!
    assert.deepEqual([corrected.latitude, corrected.longitude], [27.3048772, 33.7273514])
    assert.equal(corrected.coordinateSource?.url, 'https://www.openstreetmap.org/node/13947730532')
    assert.ok(corrected.coordinateSource?.evidence?.includes('https://yourtable.sunrise-resorts.com/'))
})
