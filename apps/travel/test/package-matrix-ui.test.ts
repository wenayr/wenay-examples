import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PackageMatrix, PackageMatrixCell} from '../src/package-matrix-contract.ts'
import {matrixChunks, matrixDates, matrixFirstNights, matrixNights, matrixRangeNights, matrixRetryAt, matrixViewForRoute, refreshedMatrixSelection} from '../frontend/package-matrix.ts'

test('matrix chunks keep the visible date × duration range within six source cells', () => {
    const dates = matrixDates('2027-01-24', '2027-01-31')
    const chunks = matrixChunks(dates, [7, 10, 14])
    assert.equal(chunks.length, 4)
    assert.deepEqual(chunks[0], {firstDeparture: '2027-01-24', lastDeparture: '2027-01-25', nightsValues: '7,10,14'})
    assert.equal(chunks.at(-1)?.lastDeparture, '2027-01-31')
    assert.deepEqual(matrixNights(matrixFirstNights(1)), [1, 2, 3])
    assert.deepEqual(matrixNights(matrixFirstNights(30)), [28, 29, 30])
    const expanded = matrixChunks(dates, matrixRangeNights(5, 9))
    const expandedCells = expanded.flatMap(chunk => {
        const duration = chunk.nightsValues.split(',').map(Number)
        const departures = matrixDates(chunk.firstDeparture, chunk.lastDeparture)
        assert.ok(duration.length <= 3)
        assert.ok(duration.length * departures.length <= 6)
        return departures.flatMap(day => duration.map(nights => day + '/' + nights))
    })
    assert.equal(new Set(expandedCells).size, 40)
    assert.equal(expandedCells.length, 40)
})

const source = {id: 'test', name: 'Fixture', status: 'cached', updatedAt: '2027-01-01T00:00:00Z', description: 'Regression fixture'} as const
const fare = {
    id: 'fare7', departure: '2027-01-24', nights: 7, days: 8, adults: 2, children: 0, total: 138400, currency: 'EUR',
    priceBasis: 'party-total', room: 'Standard', board: 'HB', sourceUrl: 'https://example.test/hotel', checkedAt: source.updatedAt,
} as const
const selected = {
    departure: fare.departure, nights: 7, days: 8, status: 'in-budget', lowest: fare, inBudget: fare, highest: fare,
    complete: true, checkedAt: source.updatedAt, source,
} satisfies PackageMatrixCell

test('matrix refresh keeps the exact confirmed fare and invalidates changed or unconfirmed selection', () => {
    const fresh = {...selected, checkedAt: '2027-01-01T00:01:00Z'}
    assert.equal(refreshedMatrixSelection(selected, [fresh]), fresh)
    assert.equal(refreshedMatrixSelection(selected, [{...fresh, inBudget: {...fare, id: 'replacement'}}]), null)
    assert.equal(refreshedMatrixSelection(selected, [{...fresh, inBudget: {...fare, total: 140000}}]), null)
    assert.equal(refreshedMatrixSelection(selected, [{...fresh, status: 'unknown', inBudget: null}]), null)
    assert.equal(refreshedMatrixSelection(selected, [{...fresh, nights: 14, days: 15}]), selected)
    assert.equal(refreshedMatrixSelection(null, [fresh]), null)
    assert.equal(refreshedMatrixSelection(selected, [], ['2027-01-24/7']), null)
    assert.equal(refreshedMatrixSelection(selected, [], ['2027-01-24/14']), selected)
})

test('matrix cooldown uses the latest pause deadline and lets an expired deadline retry immediately', () => {
    const matrix = {
        hotelId: 'test:hotel', departures: [selected.departure], rows: [{nights: 7, days: 8}], adults: 2,
        currency: 'EUR', priceBasis: 'party-total',
        source: {...source, retryAt: '2027-01-01T00:01:00Z'},
        cells: [{...selected, retryAt: '2027-01-01T00:02:00Z'}],
    } satisfies PackageMatrix
    assert.equal(matrixRetryAt(matrix), '2027-01-01T00:02:00.000Z')
    const past = {...matrix, source: {...source, retryAt: '2020-01-01T00:00:00Z'}, cells: [{...selected, retryAt: undefined}]}
    assert.equal(matrixRetryAt(past), '2020-01-01T00:00:00.000Z')
    assert.equal(matrixRetryAt({...past, source: {...source, retryAt: 'invalid'}}), null)
})

test('matrix range and pages restore independently of the selected trip duration', () => {
    const query = new URLSearchParams({matrixFrom: '5', matrixTo: '14', matrixRow: '4', matrixDate: '8'})
    const expected = {firstNights: 5, lastNights: 14, durationOffset: 4, dateOffset: 8}
    assert.deepEqual(matrixViewForRoute(7, query), expected)
    assert.deepEqual(matrixViewForRoute(14, query), expected)
    assert.deepEqual(matrixViewForRoute(30, new URLSearchParams({matrixFrom: '-1', matrixTo: '99'})),
        {firstNights: 28, lastNights: 30, durationOffset: 0, dateOffset: 0})
})
