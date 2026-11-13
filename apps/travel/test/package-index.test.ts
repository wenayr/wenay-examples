import assert from 'node:assert/strict'
import test from 'node:test'
import {createOfferIndex, type PackageQuery} from '../backend/package-index.ts'

test('a second fare can qualify for the map while the calendar retains the cheapest observed fare and empty dates', () => {
    const departure = '2027-01-19'
    const hotel = {id: 'bay', name: 'Palm Bay', stars: 4, latitude: 27.2, longitude: 33.8, url: 'https://example.com/bay'}
    const outside = {...hotel, id: 'outside', longitude: 34.1}
    const offers = [149000, 188000, 210000, 213000].map(total => ({id: String(total), hotelId: hotel.id, departure, total}))
    const index = createOfferIndex({hotels: [hotel, outside], offers: [...offers, {...offers[1], hotelId: outside.id}]})
    const query = {
        firstDeparture: departure, lastDeparture: '2027-01-20', minTotal: 188000, maxTotal: 210000,
        box: [33.7, 27.1, 33.9, 27.3], minStars: 4, offset: 0, limit: 1
    } satisfies PackageQuery

    const {items, markers, nextOffset, total} = index.search(query)
    assert.deepEqual(items.map(item => [item.hotelId, item.best.total, item.maxTotal]), [['bay', 188000, 210000]])
    assert.deepEqual(markers.map(marker => [marker.hotelId, marker.minTotal, marker.maxTotal]), [['bay', 188000, 210000]])
    assert.equal(nextOffset, null)
    assert.equal(total, 1)
    const [quoted, empty] = index.calendar(query, hotel.id)
    assert.deepEqual([quoted.lowest?.total, quoted.inBudget?.total, quoted.highest?.total], [149000, 188000, 213000])
    assert.deepEqual(empty, {departure: '2027-01-20', lowest: null, inBudget: null, highest: null})
})
