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

test('all fares and in-budget fares have independent extrema, including additional rates on one day', () => {
    const base = offers[2]
    const prices = [80, 100, 140, 190]
    const quotes = prices.map((total, index) => ({...base, id: 'rate-' + index, total}))
    const oneDay = {...criteria, firstDeparture: base.departure, lastDeparture: base.departure, minTotal: 90, maxTotal: 150}
    const [result] = searchTours(quotes, oneDay)
    assert.equal(result.calendar.length, 1)
    assert.equal(result.calendar[0].lowest?.total, 80)
    assert.equal(result.calendar[0].inBudget?.total, 100)
    assert.deepEqual([result.minTotal, result.maxTotal], [80, 190])
    assert.deepEqual([result.best.total, result.inBudgetMaxTotal], [100, 140])

    const [exact] = searchTours(quotes, {...oneDay, minTotal: 140, maxTotal: 140})
    assert.equal(exact.best.id, 'rate-2')
    assert.equal(exact.inBudgetMaxTotal, exact.best.total)
})

test('choosing a destination excludes other destinations and legacy quotes with no known destination', () => {
    const base = offers[2]
    const quotes = [base, {...base, id: 'egypt', destinationId: 'hurghada'}, {...base, id: 'thailand', destinationId: 'phuket'}]
    const [result] = searchTours(quotes, {...criteria, destinationId: 'phuket'})
    assert.equal(result.best.id, 'thailand')
    assert.deepEqual(searchTours(quotes, {...criteria, destinationId: 'paphos'}), [])
})

test('the package range ignores unavailable and out-of-period tariffs', () => {
    const base = offers[2]
    const extra = [
        {...base, total: 1, available: false},
        {...base, total: 99_999_999, departure: '2027-02-01'},
        {...base, total: 99_999_999, departure: '2027-01-19T00:00:00Z'},
    ]
    const [result] = searchTours([base, ...extra], criteria)
    assert.equal(result.minTotal, base.total)
    assert.equal(result.maxTotal, base.total)
})
