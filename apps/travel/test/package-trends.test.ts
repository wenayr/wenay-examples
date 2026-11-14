import test from 'node:test'
import assert from 'node:assert/strict'
import {setTimeout as pause} from 'node:timers/promises'
import {createPackageTrends} from '../backend/package-trends.ts'
import type {TezObservation, TezQuote, TezWindow} from '../backend/partners/tez-inventory.ts'

const trip: TezWindow = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-26', nights: 7,
    adults: 2, minTotal: 0, maxTotal: 500_000}
const now = () => new Date('2030-01-01T10:00:00Z')
const checkedAt = '2030-01-01T09:59:55Z'

function quote(hotelId: string, departure: string, total: number): TezQuote {
    return {id: hotelId + ':' + departure + ':' + total, hotelId, name: hotelId, stars: 4,
        latitude: 27.2, longitude: 33.8, departure, total, url: 'https://www.tez-tour.com/hotel.html?id=' + hotelId.slice(4)}
}

function observation(quotes: TezQuote[], status: TezObservation['source']['status'] = 'live'): TezObservation {
    return {quotes, byFareId: new Map(quotes.map(offer => [offer.id, offer])), generation: JSON.stringify(quotes), complete: false,
        source: {id: 'tez', name: 'TEZ TOUR Eesti', status, updatedAt: status == 'unavailable' ? null : checkedAt, description: 'Regional result'}}
}

test('Regional trends make one call per day for 5 or 60 hotels, reuse pages and preserve budget-specific daily minima', async () => {
    const calls: TezWindow[] = []
    let running = 0
    let maximum = 0
    const ids = Array.from({length: 60}, (_, index) => 'tez:' + (1000 + index))
    async function window(input: TezWindow) {
        calls.push({...input})
        assert.equal(input.first, input.last)
        assert.equal(Object.hasOwn(input, 'hotelIds'), false)
        assert.equal(Object.hasOwn(input, 'box'), false)
        running++
        maximum = Math.max(maximum, running)
        await pause(5)
        running--
        const position = Number(input.first.slice(-2)) - 24
        const rows = ids.flatMap(id => [quote(id, input.first, 10_000 + position * 1_000), quote(id, input.first, 25_000 + position * 1_000)])
        return observation(rows)
    }
    const provider = {window, day: async () => {throw new Error('Per-hotel calendar must not be called')}}
    const service = createPackageTrends({provider, now})
    const first = await service.read(trip, ids.slice(0, 5))
    assert.equal(calls.length, 3)
    assert.equal(maximum, 3)
    assert.equal(first.items.length, 5)
    assert.deepEqual(first.items[0].days.map(day => day.total), [10_000, 11_000, 12_000])
    assert.equal(first.items[0].minTotal, 10_000)
    assert.equal(first.items[0].maxTotal, 12_000)
    const viewport = await service.read(trip, ids)
    assert.equal(calls.length, 3)
    assert.equal(viewport.items.length, 60)
    assert.equal(viewport.source.status, 'cached')
    assert.equal(viewport.items[0].days[0].checkedAt, checkedAt)
    const floor = await service.read({...trip, minTotal: 20_000}, ids)
    assert.equal(calls.length, 6)
    assert.deepEqual(floor.items[0].days.map(day => day.total), [25_000, 26_000, 27_000])
    const none = await service.read(trip, [])
    assert.equal(none.items.length, 0)
    assert.equal(calls.length, 6)
    await assert.rejects(service.read(trip, [...ids, ...ids, ...ids, ...ids]), RangeError)
})

test('A missing regional row is not-returned, a failed day is unknown, and only observed minima set the range', async () => {
    async function window(input: TezWindow) {
        if (input.first == '2030-01-25') throw new Error('Upstream timeout')
        if (input.first == '2030-01-26') return observation([])
        return observation([quote('tez:1000', input.first, 14_000), quote('tez:1000', input.first, 48_000)])
    }
    const provider = {window, day: async () => {throw new Error('Unexpected day lookup')}}
    const service = createPackageTrends({provider, now})
    const result = await service.read(trip, ['tez:1000', 'tez:2000'])
    assert.deepEqual(result.items[0].days.map(day => day.status), ['quoted', 'unknown', 'not-returned'])
    assert.deepEqual(result.items[0].days.map(day => day.checkedAt), [checkedAt, null, checkedAt])
    assert.deepEqual(result.items[1].days.map(day => day.status), ['not-returned', 'unknown', 'not-returned'])
    assert.equal(result.items[0].minTotal, 14_000)
    assert.equal(result.items[0].maxTotal, 14_000)
    assert.equal(result.items[1].minTotal, null)
    assert.equal(result.items[1].maxTotal, null)
    assert.match(result.source.description, /2 из 3/)
})

test('Cancelling one caller preserves shared daily requests for another and does not repeat the regional work', async () => {
    let calls = 0
    async function window(input: TezWindow) {
        calls++
        await pause(10)
        return observation([quote('tez:1000', input.first, 15_000)])
    }
    const provider = {window, day: async () => {throw new Error('Unexpected day lookup')}}
    const service = createPackageTrends({provider, now})
    const controller = new AbortController()
    const cancelled = service.read({...trip, last: '2030-01-28'}, ['tez:1000'], controller.signal)
    const survivor = service.read({...trip, last: '2030-01-28'}, ['tez:1000', 'tez:2000'])
    const rejection = assert.rejects(cancelled, {name: 'AbortError'})
    controller.abort()
    await rejection
    const result = await survivor
    assert.equal(calls, 5)
    assert.equal(result.items[0].days.length, 5)
    assert.ok(result.items[0].days.every(day => day.status == 'quoted'))
})

test('Cancelling the only caller skips queued dates and permits a later fresh request', async () => {
    let calls = 0
    async function window(input: TezWindow) {
        calls++
        await pause(10)
        return observation([quote('tez:1000', input.first, 15_000)])
    }
    const provider = {window, day: async () => {throw new Error('Unexpected day lookup')}}
    const service = createPackageTrends({provider, now})
    const controller = new AbortController()
    const pending = service.read({...trip, last: '2030-01-30'}, ['tez:1000'], controller.signal)
    const rejection = assert.rejects(pending, {name: 'AbortError'})
    controller.abort()
    await rejection
    await pause(25)
    assert.equal(calls, 3)
    const fresh = await service.read({...trip, last: '2030-01-30'}, ['tez:1000'])
    assert.equal(fresh.items[0].days.length, 7)
    assert.ok(fresh.items[0].days.every(day => day.status == 'quoted'))
})
