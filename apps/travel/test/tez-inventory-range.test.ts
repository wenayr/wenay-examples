import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'
import {tezSearchRetryAt} from '../backend/partners/tez-access.ts'

const checkedAt = '2030-01-01T10:00:00.000Z'
const trip = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-24', nights: 7,
    adults: 2, minTotal: 0, maxTotal: 500_000}

function supplierRow(params: URLSearchParams, nights: number, total = 1384) {
    return [params.get('after'), [], '', nights, '', ['', '', 5734], ['', 'SAND BEACH 3 *', '', Number(params.get('hotelId'))],
        ['HB', 'HB', 2474, 2146], [2471, 'Standard', 2147], [[2, 0, 0]], {currency: 'EUR', total}]
}

test('one hotel/date range retains actual supplier nights, reuses normalized raw data and leaves exact-day requests exact', async () => {
    const calls: URLSearchParams[] = []
    const provider = createTezInventory({now: () => new Date(checkedAt), fetch: async input => {
        const params = new URL(String(input)).searchParams
        calls.push(params)
        assert.equal(params.get('hotelId'), '1061')
        assert.equal(params.get('after'), params.get('before'))
        assert.equal(params.get('groupByHotel'), null)
        assert.equal(params.get('priceMin'), '0')
        assert.equal(params.get('priceMax'), '1500000')
        const hasSeven = Number(params.get('nightsMin')) <= 7 && Number(params.get('nightsMax')) >= 7
        return Response.json({success: true, departureCityId: 3746, data: hasSeven ? [supplierRow(params, 7)] : [],
            info: [['More results', 'false']]})
    }})
    assert.ok(provider.range)
    const range = await provider.range(trip, 'tez:1061', trip.first, [7, 6])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].get('nightsMin'), '6')
    assert.equal(calls[0].get('nightsMax'), '7')
    assert.equal(range.complete, true)
    assert.equal(range.quotes.length, 1)
    assert.deepEqual(range.quotes[0].conditions, {nights: 7, adults: 2, children: 0, room: 'Standard', board: 'HB'})
    const budget = await provider.range({...trip, minTotal: 140_000}, 'tez:1061', trip.first, [6, 7, 7])
    assert.equal(calls.length, 1)
    assert.equal(budget.source.status, 'cached')
    assert.equal(budget.quotes[0].total, 138_400)
    const six = await provider.day({...trip, nights: 6}, 'tez:1061', trip.first)
    const seven = await provider.day(trip, 'tez:1061', trip.first)
    assert.equal(calls.length, 3)
    assert.equal(six.complete, true)
    assert.equal(six.quotes.length, 0)
    assert.equal(calls[1].get('nightsMax'), '6')
    assert.equal(calls[2].get('nightsMin'), '7')
    assert.equal(calls[2].get('nightsMax'), '7')
    assert.equal(seven.quotes[0].id, range.quotes[0].id)
    const sparse = await provider.range(trip, 'tez:1061', trip.first, [6, 8])
    assert.equal(sparse.quotes[0].conditions?.nights, 7)
    assert.equal(sparse.complete, true)
})

test('the 46th local supplier request carries cooldown metadata, preserves known data and resumes without negative caching', async () => {
    let clock = Date.parse(checkedAt)
    let calls = 0
    const fetcher = (async function supplier(input) {
        calls++
        const params = new URL(String(input)).searchParams
        return Response.json({success: true, departureCityId: 3746, data: [supplierRow(params, 7)], info: [['More results', 'false']]})
    }) as typeof fetch
    const provider = createTezInventory({fetch: fetcher, now: () => new Date(clock)})
    await Promise.all(Array.from({length: 45}, (_, index) => provider.day(trip, 'tez:' + (1000 + index), trip.first)))
    assert.equal(calls, 45)
    const retryAt = new Date(clock + 60_000).toISOString()
    assert.ok(provider.range)
    const waiting = await provider.range(trip, 'tez:1061', trip.first, [6, 7])
    assert.equal(calls, 45)
    assert.equal(waiting.complete, false)
    assert.equal(waiting.quotes.length, 0)
    assert.equal(waiting.source.status, 'unavailable')
    assert.equal(waiting.source.retryAt, retryAt)
    assert.equal(tezSearchRetryAt(fetcher, clock), clock + 60_000)
    const retained = await provider.day(trip, 'tez:1000', trip.first, true)
    assert.equal(retained.source.status, 'cached')
    assert.equal(retained.source.updatedAt, checkedAt)
    assert.equal(retained.source.retryAt, retryAt)
    assert.equal(retained.quotes[0].total, 138_400)
    clock += 60_000
    const resumed = await provider.range(trip, 'tez:1061', trip.first, [6, 7])
    assert.equal(calls, 46)
    assert.equal(resumed.source.status, 'live')
    assert.equal(resumed.source.updatedAt, new Date(clock).toISOString())
    assert.equal(resumed.source.retryAt, undefined)
    assert.equal(resumed.quotes[0].conditions?.nights, 7)
})
