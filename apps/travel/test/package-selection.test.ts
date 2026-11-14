import {test} from 'node:test'
import assert from 'node:assert/strict'
import {selectedPackageFare, selectedPackageSummary} from '../frontend/package-selection.ts'
import type {PackageCalendar, PackageSummary} from '../src/package-contract.ts'

const first = {id: 'first', departure: '2030-01-24', total: 138_400}
const second = {id: 'second', departure: '2030-01-31', total: 151_200}
const item = {hotelId: '1061', name: 'Sand Beach', stars: 3, latitude: 27.25, longitude: 33.83,
    url: 'https://www.teztour.ee/', minTotal: first.total, maxTotal: second.total, best: first} satisfies PackageSummary
const calendar = {hotel: {id: item.hotelId, name: item.name, stars: item.stars, latitude: item.latitude,
    longitude: item.longitude, url: item.url}, source: {id: 'tez', name: 'TEZ', status: 'live', url: item.url,
        updatedAt: null, description: 'Controlled selection regression fixture'},
    days: [first, second].map(fare => ({departure: fare.departure, lowest: fare, inBudget: fare, highest: fare,
        status: 'quoted' as const, complete: true, checkedAt: '2026-11-14T00:00:00Z'}))} satisfies PackageCalendar

test('explicitly missing selected fare is not replaced with a different cheapest fare', () => {
    assert.equal(selectedPackageFare(calendar, 'gone'), undefined)
    assert.equal(selectedPackageFare(calendar, ''), first)
})

test('chosen day uses the same fare for card date, price and saved trip input', () => {
    const fare = selectedPackageFare(calendar, second.id)
    const shown = selectedPackageSummary(item, item.hotelId, fare)
    assert.equal(shown.best, second)
    assert.equal(shown.minTotal, second.total)
    assert.equal(shown.maxTotal, second.total)
    assert.equal(selectedPackageSummary(item, 'other', fare), item)
})
