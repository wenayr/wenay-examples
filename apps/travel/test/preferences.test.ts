import test from 'node:test'
import assert from 'node:assert/strict'
import {createPreferences, initialSelection, restoreSelection} from '../frontend/preferences.ts'
import {destinations, demoOffers} from '../demo/catalog.ts'
import {searchTours} from '../src/search-tours.ts'

test('restores the selected departure for another destination', () => {
    const {search} = initialSelection()
    search.destinationId = 'phuket'
    search.firstDeparture = '2027-01-19'
    const [hotel] = searchTours(demoOffers, search)
    const different = hotel.calendar.find(day => day.inBudget && day.inBudget.id != hotel.best.id)?.inBudget
    assert.ok(different)
    const state = {search, hotelId: hotel.hotelId, offerId: different.id}
    assert.deepEqual(restoreSelection({version: 1, ...state}), state)
})

test('bad dates, amounts and stale room references fall back to valid catalogue values', () => {
    const fresh = initialSelection()
    const search = {...fresh.search, firstDeparture: '2027-01-32', maxTotal: -1}
    const state = restoreSelection({version: 1, search, hotelId: 'removed', offerId: 'expired'})
    assert.deepEqual(state, fresh)
    assert.deepEqual(restoreSelection({version: 2}), fresh)
    assert.deepEqual(restoreSelection({version: '1'}), fresh)
    const destination = Object.keys(destinations)[0]
    assert.deepEqual(restoreSelection({version: 1, search: {destinationId: '__proto__'}}).search.destinationId, destination)
})

test('recovers when storage is unavailable or a quota is exhausted', async () => {
    function fail(): never { throw new Error('Storage disabled') }
    const preferences = createPreferences({get: fail, set: fail, delete: fail})
    assert.deepEqual(await preferences.load(), initialSelection())
    assert.equal(await preferences.save(initialSelection()), false)
    assert.equal(await preferences.clear(), false)
})
