import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPackages} from '../backend/packages.ts'
import type {TezObservation} from '../backend/partners/tez-inventory.ts'

test('ordinary package results carry one verified property image and the selected calendar carries its own gallery', async () => {
    const quote = {id: 'fare:media', hotelId: 'tez:1061', name: 'SAND BEACH 3 *', stars: 3, latitude: 27.257,
        longitude: 33.839, departure: '2030-01-24', total: 138_400, url: 'https://www.tez-tour.com/hotel.html?id=1061'}
    const source = {id: 'tez', name: 'TEZ', status: 'live' as const,
        updatedAt: '2026-11-14T00:00:00Z', description: 'Controlled media regression'}
    const observation = {quotes: [quote], byFareId: new Map([[quote.id, quote]]), generation: 'media-regression',
        complete: true, source} satisfies TezObservation
    const packages = createPackages({window: async () => observation, day: async () => observation})
    const trip = {destinationId: 'hurghada', first: quote.departure, last: quote.departure, nights: 7, adults: 2,
        minTotal: 0, maxTotal: 500_000}
    const filter = {firstDeparture: trip.first, lastDeparture: trip.last, minTotal: 0, maxTotal: 500_000,
        minStars: 0, offset: 0, limit: 12, box: null}
    const page = await packages.search(trip, filter)
    assert.equal(page.items[0].photo?.sourceUrl, quote.url)
    assert.equal(page.markers[0].photo?.url, page.items[0].photo?.url)
    assert.equal(page.items[0].photos, undefined)
    const calendar = await packages.calendar(trip, filter, quote.hotelId)
    assert.ok(calendar)
    assert.equal(calendar.hotel.photos?.length, 5)
    assert.ok(calendar.hotel.photos.every(photo => photo.sourceUrl == quote.url))
    assert.ok(calendar.hotel.photos.every(photo => photo.url.startsWith('https://s.tez-tour.com/hotel/1491/')))
    assert.equal(calendar.days[0].inBudget?.total, quote.total)
})
