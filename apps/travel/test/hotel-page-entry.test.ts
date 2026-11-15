import assert from 'node:assert/strict'
import {test} from 'node:test'
import {hotelCalendarRequired, hotelSectionForRoute, hotelSectionOffset} from '../frontend/hotel-page-entry.ts'
import {travelHash, travelRoute} from '../frontend/navigation.ts'

test('hotel entry is explicit, supports legacy matrix links and rejects unknown sections', () => {
    assert.equal(hotelSectionForRoute(new URLSearchParams()), 'gallery')
    assert.equal(hotelSectionForRoute(new URLSearchParams('priceView=matrix')), 'matrix')
    assert.equal(hotelSectionForRoute(new URLSearchParams('hotelSection=gallery&priceView=matrix')), 'gallery')
    assert.equal(hotelSectionForRoute(new URLSearchParams('hotelSection=reviews')), 'reviews')
    assert.equal(hotelSectionForRoute(new URLSearchParams('hotelSection=__proto__')), 'gallery')
})

test('section links preserve the hotel, selected fare and the full matrix axes', () => {
    const hash = travelHash('packages', 'hurghada', {hotelId: 'tez:511', hotelSection: 'matrix',
        fareId: 'tez-offer:confirmed', firstDeparture: '2026-12-01', lastDeparture: '2026-12-20', matrixFrom: 4, matrixTo: 11})
    const route = travelRoute(hash)
    assert.equal(route.destination, 'hurghada')
    assert.equal(route.query.get('hotelId'), 'tez:511')
    assert.equal(route.query.get('fareId'), 'tez-offer:confirmed')
    assert.equal(route.query.get('matrixFrom'), '4')
    assert.equal(route.query.get('matrixTo'), '11')
    assert.equal(hotelSectionForRoute(route.query), 'matrix')
})

test('entry offset belongs to the panel and accounts for the sticky header without window scrolling', () => {
    assert.equal(hotelSectionOffset('gallery', 600, 80, 200, 60), 0)
    assert.equal(hotelSectionOffset('matrix', 600, 80, 200, 60), 644)
    assert.equal(hotelSectionOffset('reviews', 100, 80, 0, 60), 0)
    assert.equal(hotelSectionOffset('reviews', 200, 80, 600, 60), 644)
})

test('matrix view confirms an explicit fare without loading a redundant calendar for ordinary hotel entry', () => {
    assert.equal(hotelCalendarRequired('matrix', ''), false)
    assert.equal(hotelCalendarRequired('matrix', 'chosen-fare'), true)
    assert.equal(hotelCalendarRequired('matrix', 'chosen-fare', 'chosen-fare'), false)
    assert.equal(hotelCalendarRequired('matrix', 'chosen-fare', 'another-fare'), true)
    assert.equal(hotelCalendarRequired('graph', ''), true)
})
