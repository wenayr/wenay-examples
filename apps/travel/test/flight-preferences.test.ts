import assert from 'node:assert/strict'
import test from 'node:test'
import {
    defaultComparison, flightQueryKey, flightSelectionStorageKey, loadComparison, readFlightSelections,
    restoreComparison, saveComparison, toggleFlightSelection,
} from '../frontend/flights/comparison.ts'
import type {FlightQuery, RouteQuote} from '../src/flight-contract.ts'

const query = {
    origin: 'AUS', destination: 'MEX', departure: '2030-03-15', returnDate: '2030-03-22', adults: 2, checkedBag: false,
} satisfies FlightQuery

test('comparison restores only known preferences from browser storage', () => {
    assert.deepEqual(restoreComparison({sort: '__proto__', provider: {}, carrier: '', maxStops: -1}), defaultComparison())
    const saved = restoreComparison({sort: 'duration', provider: 'google', carrier: 'United', maxStops: 1})
    assert.deepEqual(saved, {sort: 'duration', provider: 'google', carrier: 'United', maxStops: 1})
})

test('comparison writes preserve distinct queries and do not carry filters into another trip', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const stored = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
    }})
    try {
        const first = {...defaultComparison(), provider: 'google'}
        const changed = {...query, checkedBag: true}
        const second = {...defaultComparison(), carrier: 'United'}
        await Promise.all([saveComparison(query, first), saveComparison(changed, second)])
        assert.deepEqual(await loadComparison(query), first)
        assert.deepEqual(await loadComparison(changed), second)
        assert.deepEqual(await loadComparison({...query, adults: 1}), defaultComparison())
        assert.notEqual(flightQueryKey(query), flightQueryKey({...query, returnDate: null}))
        const quote = {
            id: 'first', total: 10000, currency: 'EUR', checkedAt: '2029-01-01T12:00:00Z',
            sourceUrl: 'https://www.google.com/travel/flights', carrier: 'United', description: 'Round trip for both passengers',
        } satisfies RouteQuote
        await toggleFlightSelection(query, quote)
        await toggleFlightSelection(query, {...quote, id: 'second'})
        await toggleFlightSelection(query, {...quote, id: 'third'})
        assert.equal((await toggleFlightSelection(query, {...quote, id: 'fourth'})).length, 3)
        assert.equal((await toggleFlightSelection(changed, quote)).length, 4)
        assert.equal((await toggleFlightSelection(query, quote)).length, 3)
        assert.equal((await readFlightSelections())[0].quote.checkedAt, '2029-01-01T12:00:00Z')
        stored.set(flightSelectionStorageKey, JSON.stringify([{query, quote: {...quote, sourceUrl: 'javascript:alert(1)'}}]))
        assert.deepEqual(await readFlightSelections(), [])
        Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem() { throw new Error('Quota exceeded') },
        }})
        await toggleFlightSelection(query, quote)
        assert.deepEqual(await readFlightSelections(), [{query, quote}])
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
        else Reflect.deleteProperty(globalThis, 'localStorage')
    }
})
