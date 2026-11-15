import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import {compactPricePreview} from '../frontend/compact-price-preview.ts'

const departure = '2027-01-15'
const checkedAt = '2026-11-15T09:00:00Z'
const source = {id: 'fixture', name: 'Fixture', status: 'cached', updatedAt: checkedAt, description: 'Contract fixture'} as const
const fare = {
    id: 'real-fare', departure, nights: 7, days: 8, adults: 2, children: 0, total: 125000,
    currency: 'EUR', priceBasis: 'party-total', room: null, board: null, sourceUrl: 'https://example.test/hotel', checkedAt,
} as const
const quoted = {
    departure, nights: 7, days: 8, status: 'in-budget', lowest: fare, inBudget: fare, highest: fare,
    complete: true, checkedAt, source,
} satisfies PackageMatrixCell

test('small graph preserves actual daily prices and does not turn missing dates into zero prices', () => {
    const preview = compactPricePreview({nights: 7, trend: [
        {departure, total: 125000, status: 'quoted', checkedAt},
        {departure: '2027-01-16', total: null, status: 'unknown', checkedAt: null},
        {departure: '2027-01-17', total: 145000, status: 'quoted', checkedAt},
    ]})
    assert.equal(preview.mode, 'graph')
    assert.equal(preview.min, 125000)
    assert.equal(preview.max, 145000)
    assert.equal(preview.cells[1].total, null)
    assert.equal(preview.cells[1].heat, null)
    assert.equal(preview.cells[1].status, 'unknown')
    assert.deepEqual(preview.cells.map(cell => cell.heat), [0, null, 1])
})

test('small matrix indexes real dates and durations with explicit unknown and stale cells', () => {
    const preview = compactPricePreview({mode: 'matrix', nights: 7, matrix: {
        departures: [departure, '2027-01-16', '2027-01-17'], nights: [6, 7, 8], cells: [quoted],
        staleCellKeys: [departure + '/7'], pending: true,
    }})
    assert.equal(preview.mode, 'matrix')
    assert.deepEqual(preview.durations, [6, 7, 8])
    assert.equal(preview.cells.length, 9)
    assert.equal(preview.cells[0].status, 'unknown')
    assert.equal(preview.cells[3].total, fare.total)
    assert.equal(preview.cells[3].status, 'stale')
    assert.equal(preview.cells[3].nights, 7)
    assert.equal(preview.cells[3].departure, departure)
    assert.equal(preview.cells.filter(cell => cell.total != null).length, 1)
    assert.match(preview.label, /6–8 ночей/)
    assert.match(preview.label, /обновляется/)
})

test('unselected hotel uses one factual duration row and never invents extra durations or reviews', () => {
    const preview = compactPricePreview({mode: 'matrix', nights: 10, trend: [{departure, total: 225000, status: 'quoted', checkedAt}]})
    assert.deepEqual(preview.durations, [10])
    assert.equal(preview.cells.length, 1)
    assert.equal(preview.cells[0].total, 225000)
    const empty = compactPricePreview({mode: 'matrix', nights: 10})
    assert.equal(empty.min, null)
    assert.equal(empty.cells.length, 0)
    assert.match(empty.label, /подтверждённых цен пока нет/)
})

test('a retained real quote ages visibly instead of becoming a fresh current price', () => {
    const preview = compactPricePreview({nights: 7, now: Date.parse(checkedAt) + 120_001,
        trend: [{departure, total: fare.total, status: 'quoted', checkedAt}]})
    assert.equal(preview.cells[0].total, fare.total)
    assert.equal(preview.cells[0].status, 'stale')
    assert.match(preview.label, /требует обновления/)
})

test('a failed or pending matrix check without a price never claims a stale previous price', () => {
    const unknown = {...quoted, status: 'unknown' as const, lowest: null, inBudget: null, highest: null, checkedAt: null,
        source: {...source, stale: true}}
    const failed = {...unknown, departure: '2027-01-16', status: 'failed' as const}
    const preview = compactPricePreview({mode: 'matrix', nights: 7, matrix: {
        departures: [departure, failed.departure, '2027-01-17'], nights: [7], cells: [unknown, failed],
        staleCellKeys: [departure + '/7', failed.departure + '/7', '2027-01-17/7'],
    }})
    assert.deepEqual(preview.cells.map(cell => cell.status), ['unknown', 'failed', 'unknown'])
    assert.equal(preview.cells.every(cell => cell.total == null && cell.checkedAt == null), true)
    assert.doesNotMatch(preview.label, /требует обновления/)
})

test('matrix reuses an exact known trend only for its matching duration and preserves its original timestamp', () => {
    const preview = compactPricePreview({mode: 'matrix', nights: 7, now: Date.parse(checkedAt) + 120_001,
        trend: [{departure, total: fare.total, status: 'quoted', checkedAt}],
        matrix: {departures: [departure], nights: [6, 7, 8], cells: [], staleCellKeys: [departure + '/7']},
    })
    assert.deepEqual(preview.cells.map(cell => cell.total), [null, fare.total, null])
    assert.deepEqual(preview.cells.map(cell => cell.status), ['unknown', 'stale', 'unknown'])
    assert.equal(preview.cells[1].cached, true)
    assert.equal(preview.cells[1].checkedAt, checkedAt)
    assert.match(preview.label, /сохранённого графика/)
})

test('a newer authoritative empty matrix cell wins over an older trend while a failed check can reuse that trend', () => {
    const newer = '2026-11-15T09:01:00Z'
    const empty = {...quoted, status: 'empty' as const, lowest: null, inBudget: null, highest: null, checkedAt: newer}
    const failed = {...empty, departure: '2027-01-16', status: 'failed' as const, complete: false}
    const preview = compactPricePreview({mode: 'matrix', nights: 7, now: Date.parse(newer), trend: [
        {departure, total: fare.total, status: 'quoted', checkedAt},
        {departure: failed.departure, total: fare.total, status: 'quoted', checkedAt},
    ], matrix: {departures: [departure, failed.departure], nights: [7], cells: [empty, failed], staleCellKeys: [departure + '/7']}})
    assert.equal(preview.cells[0].status, 'unknown')
    assert.equal(preview.cells[0].total, null)
    assert.equal(preview.cells[1].status, 'quoted')
    assert.equal(preview.cells[1].total, fare.total)
    assert.equal(preview.cells[1].checkedAt, checkedAt)
})

test('the complete twenty-date by eight-duration miniature preserves both axes and exact factual price positions', () => {
    const departures = Array.from({length: 20}, (_, index) => '2026-12-' + String(index + 1).padStart(2, '0'))
    const nights = Array.from({length: 8}, (_, index) => index + 4)
    const decemberFare = {...fare, departure: departures[10], total: 202700}
    const decemberQuote = {...quoted, departure: decemberFare.departure, lowest: decemberFare, inBudget: decemberFare, highest: decemberFare}
    const empty = {...quoted, departure: departures[1], nights: 4, days: 5, status: 'empty' as const,
        lowest: null, inBudget: null, highest: null}
    const preview = compactPricePreview({mode: 'matrix', nights: 7, now: Date.parse(checkedAt) + 1_000,
        trend: [{departure: departures[2], total: 224600, status: 'quoted', checkedAt}],
        matrix: {departures, nights, cells: [decemberQuote, empty]},
    })
    assert.equal(preview.cells.length, 160)
    assert.deepEqual(preview.departures, departures)
    assert.deepEqual(preview.durations.map(night => night + 1), [5, 6, 7, 8, 9, 10, 11, 12])
    assert.deepEqual(preview.cells.map(cell => cell.departure + '/' + cell.nights),
        nights.flatMap(night => departures.map(day => day + '/' + night)))
    assert.equal(preview.cells[70].total, 202700)
    assert.equal(preview.cells[62].total, 224600)
    assert.equal(preview.cells[62].cached, true)
    assert.equal(preview.cells[1].status, 'empty')
    assert.equal(preview.cells.filter(cell => cell.status == 'unknown').length, 157)
    assert.match(preview.label, /5–12 дней/)
    assert.match(preview.label, /4–11 ночей/)
})

test('a full miniature with no source results keeps all 160 cells unknown without inventing prices', () => {
    const departures = Array.from({length: 20}, (_, index) => '2026-12-' + String(index + 1).padStart(2, '0'))
    const nights = Array.from({length: 8}, (_, index) => index + 4)
    const preview = compactPricePreview({mode: 'matrix', nights: 7, matrix: {departures, nights, cells: []}})
    assert.equal(preview.cells.length, 160)
    assert.equal(preview.min, null)
    assert.equal(preview.max, null)
    assert.equal(preview.cells.every(cell => cell.status == 'unknown' && cell.total == null && cell.heat == null), true)
})
