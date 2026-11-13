import assert from 'node:assert/strict'
import test from 'node:test'
import {criteria, offers} from '../demo/january.ts'
import {searchTours} from '../src/search-tours.ts'

test('the map includes a hotel if any bookable departure qualifies, including the last one', () => {
  const hotels = searchTours(offers, criteria)
  assert.deepEqual(hotels.map(h => [h.hotelId, h.best.id]), [
    ['demo-hotel-a', 'A19-flex'], ['demo-hotel-b', 'B31'],
  ])
  const calendar = hotels[0].calendar
  assert.equal(calendar.length, 17)
  assert.equal(calendar[0].lowest?.id, 'A15')
  assert.equal(calendar[0].inBudget, null)
  assert.deepEqual(calendar[1], {departure: '2027-01-16', lowest: null, inBudget: null})
  assert.equal(calendar[4].lowest?.id, 'A19-basic')
  assert.equal(calendar[4].inBudget?.id, 'A19-flex')
})

test('wrong origin, currency, duration, group, date and unavailable quotes cannot qualify', () => {
  const changes = [
    {origin: 'KZN'}, {currency: 'EUR'}, {tripDays: 9}, {travelers: 1},
    {departure: '2027-02-01'}, {available: false}, {total: NaN},
  ]
  const unsuitable = changes.map(change => ({...offers[2], ...change}))
  assert.deepEqual(searchTours(unsuitable, criteria), [])
})

test('both budget boundaries qualify, even for an exact-price search', () => {
  const singlePrice = {...criteria, minTotal: criteria.maxTotal}
  assert.deepEqual(searchTours(offers, singlePrice).map(h => h.best.id), ['B31'])
})

test('impossible dates, inverted windows and invalid budgets are rejected', () => {
  for (const change of [
    {firstDeparture: '2027-02-30'}, {firstDeparture: '2027-02-01'}, {maxTotal: -1},
  ]) {
    assert.throws(() => searchTours(offers, {...criteria, ...change}), RangeError)
  }
})
