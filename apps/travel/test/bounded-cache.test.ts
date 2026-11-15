import assert from 'node:assert/strict'
import test from 'node:test'
import {createBoundedCache} from '../backend/bounded-cache.ts'

test('weighted cache evicts the least recently used index and rejects an oversized entry without discarding its neighbours', () => {
    const cache = createBoundedCache<number>({maxEntries: 3, maxBytes: 1_200})
    cache.control.set({key: 'first', value: 1, bytes: 400})
    cache.control.set({key: 'second', value: 2, bytes: 400})
    assert.equal(cache.view.get('first'), 1)
    cache.control.set({key: 'third', value: 3, bytes: 400})
    assert.equal(cache.view.get('second'), undefined)
    cache.control.set({key: 'oversized', value: 4, bytes: 2_000})
    assert.equal(cache.view.get('first'), 1)
    assert.equal(cache.view.get('third'), 3)
    assert.equal(cache.view.get('oversized'), undefined)
    assert.ok(cache.health.snapshot().bytes <= 1_200)
})
