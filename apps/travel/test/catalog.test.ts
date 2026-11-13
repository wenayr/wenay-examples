import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultSearch, demoOffers, destinations, hotels} from '../demo/catalog.ts'
import {searchTours} from '../src/search-tours.ts'

test('each destination returns its own bookable hotel contours and EUR quotes for a party departing from Tallinn', () => {
    assert.equal(defaultSearch.origin, 'TLL')
    assert.equal(defaultSearch.currency, 'EUR')
    assert.equal(new Set(demoOffers.map(offer => offer.id)).size, demoOffers.length)
    for (const destinationId of Object.keys(destinations)) {
        const results = searchTours(demoOffers, {...defaultSearch, destinationId})
        assert.ok(results.length >= 2)
        for (const {hotelId, best, calendar} of results) {
            const hotel = hotels[hotelId]
            assert.equal(hotel.destinationId, destinationId)
            assert.equal(best.travelers, 2)
            assert.equal(best.tripDays, 10)
            assert.equal(best.currency, 'EUR')
            assert.ok(hotel.outline.length >= 3)
            assert.ok(calendar.some(day => day.lowest == null))
        }
    }
})
