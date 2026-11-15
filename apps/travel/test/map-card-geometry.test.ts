import assert from 'node:assert/strict'
import test from 'node:test'
import {clampMapCardOffset, mapCardEdgePoint} from '../frontend/map-card-geometry.ts'

test('dragged hotel cards stay inside desktop and mobile viewport margins', () => {
    const cases = [
        {
            viewport: {width: 390, height: 844},
            box: {x: 100, y: 250, width: 190, height: 244},
            offset: {x: 900, y: -800},
            expected: {x: 92, y: -140},
        },
        {
            viewport: {width: 1440, height: 900},
            box: {x: 650, y: 350, width: 190, height: 244},
            offset: {x: -2000, y: 2000},
            expected: {x: -642, y: 290},
        },
    ]
    cases.forEach(entry => {
        const actual = clampMapCardOffset(entry)
        assert.deepEqual(actual, entry.expected)
        assert.ok(entry.box.x + actual.x >= 8)
        assert.ok(entry.box.x + actual.x + entry.box.width <= entry.viewport.width - 8)
        assert.ok(entry.box.y + actual.y + entry.box.height <= entry.viewport.height - 16)
    })
})

test('connector meets the nearest actual card edge or corner', () => {
    const anchor = {x: 300, y: 300}
    assert.deepEqual(mapCardEdgePoint({anchor, box: {x: 500, y: 220, width: 190, height: 244}}), {x: 500, y: 300})
    assert.deepEqual(mapCardEdgePoint({anchor, box: {x: 350, y: 500, width: 190, height: 244}}), {x: 350, y: 500})
    assert.deepEqual(mapCardEdgePoint({anchor: {x: 520, y: 300}, box: {x: 500, y: 220, width: 190, height: 244}}), {x: 500, y: 300})
})

test('moving a card does not move its hotel anchor or change supplied geometry', () => {
    const hotel = Object.freeze({id: 'tez:1061', anchor: Object.freeze({x: 320, y: 280})})
    const box = Object.freeze({x: 225, y: 150, width: 190, height: 244})
    const requested = Object.freeze({x: 140, y: -95})
    const actual = clampMapCardOffset({box, viewport: {width: 800, height: 600}, offset: requested})
    const moved = {...box, x: box.x + actual.x, y: box.y + actual.y}
    const endpoint = mapCardEdgePoint({anchor: hotel.anchor, box: moved})
    assert.deepEqual(endpoint, {x: 365, y: 280})
    assert.notEqual(endpoint, hotel.anchor)
    assert.deepEqual(hotel, {id: 'tez:1061', anchor: {x: 320, y: 280}})
    assert.deepEqual(box, {x: 225, y: 150, width: 190, height: 244})
    assert.deepEqual(requested, {x: 140, y: -95})
})
