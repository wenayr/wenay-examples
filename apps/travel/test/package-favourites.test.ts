import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPackageFavourites, restorePackageFavourites, setPackageFavourite} from '../frontend/package-favourites.ts'

test('favourite levels belong to a supplier property and survive a different fare or trip', () => {
    const first = setPackageFavourite(restorePackageFavourites(null), 'tez:1061', 1)
    const second = setPackageFavourite(first, 'other:1061', 3)
    const preferred = setPackageFavourite(second, 'tez:1061', 2)
    assert.deepEqual(preferred.levels, {'tez:1061': 2, 'other:1061': 3})
    assert.deepEqual(restorePackageFavourites(JSON.parse(JSON.stringify(preferred))), preferred)
    assert.deepEqual(setPackageFavourite(preferred, 'tez:1061', 0).levels, {'other:1061': 3})
    assert.deepEqual(restorePackageFavourites({version: 1, levels: {'tez:1061': '3', 'unsafe': 1}}).levels, {})
    assert.equal(setPackageFavourite(preferred, 'osm:way:123456', 1).levels['osm:way:123456'], 1)
})

test('queued favourite edits persist the final level and leave the existing trip key intact', async () => {
    const legacy = {items: [{id: 'saved-trip'}]}
    const data = new Map<string, object>([['wenay.travel.trip.v1', legacy]])
    const storage = {
        async get<T extends object>(key: string) {
            await Promise.resolve()
            return (data.get(key) ?? null) as T | null
        },
        async set(key: string, value: object) {
            await Promise.resolve()
            data.set(key, structuredClone(value))
            return true
        },
    }
    const first = createPackageFavourites({storage})
    await Promise.all([first.setLevel('tez:1061', 1), first.setLevel('tez:1061', 2), first.setLevel('tez:1061', 3)])
    assert.equal(first.node.get().levels['tez:1061'], 3)
    const reloaded = createPackageFavourites({storage})
    await reloaded.refresh()
    assert.equal(reloaded.node.get().levels['tez:1061'], 3)
    assert.equal(data.get('wenay.travel.trip.v1'), legacy)
})

test('favourites remain editable in memory when browser persistence becomes unavailable', async () => {
    const storage = {
        async get<T extends object>() { return null as T | null },
        async set() { return false },
    }
    const favourites = createPackageFavourites({storage})
    await favourites.setLevel('tez:1061', 1)
    await favourites.setLevel('tez:1061', 3)
    await favourites.refresh()
    assert.equal(favourites.node.get().levels['tez:1061'], 3)
    assert.equal(favourites.node.get().temporary, true)
})
