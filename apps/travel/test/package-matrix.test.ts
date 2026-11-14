import assert from 'node:assert/strict'
import {test} from 'node:test'
import {setImmediate, setTimeout as pause} from 'node:timers/promises'
import {createPackageMatrix} from '../backend/package-matrix.ts'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'
import {tezSearchRetryAt} from '../backend/partners/tez-access.ts'

const trip = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-25', nights: 7,
    adults: 2, minTotal: 13_000, maxTotal: 15_000}
const checkedAt = '2030-01-01T10:00:00.000Z'

test('matrix axes preserve real nights, complete fare conditions, budget floor and separate absent, partial and failed cells', async () => {
    const calls: URLSearchParams[] = []
    let active = 0
    let maximum = 0
    const provider = createTezInventory({now: () => new Date(checkedAt), fetch: async input => {
        const params = new URL(String(input)).searchParams
        calls.push(params)
        assert.equal(params.get('hotelId'), '1061')
        assert.equal(params.has('groupByHotel'), false)
        assert.equal(params.get('priceMin'), '0')
        assert.equal(params.get('priceMax'), '1500000')
        assert.equal(params.get('after'), params.get('before'))
        active++
        maximum = Math.max(maximum, active)
        await pause(2)
        active--
        const nights = Number(params.get('nightsMin'))
        assert.equal(params.get('nightsMax'), String(nights))
        const first = params.get('after') == '24.01.2030'
        if (nights == 7 && !first) throw new Error('Supplier failed')
        let amounts: number[] = []
        if (nights == 6 && first) amounts = [100, 140, 160]
        else if (nights == 7 && first) amounts = [80]
        else if (nights == 8 && first) amounts = [200]
        const data = amounts.map(total => [params.get('after'), [], '', nights, '', ['', '', 5734],
            ['', 'SAND BEACH 3 *', '', 1061], ['HB', 'HB', 2474, 2146], [2471, 'STANDARD ROOM', 2147],
            [[2, 0, 0]], {currency: 'EUR', total}])
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', nights == 8 ? 'true' : 'false']]})
    }})
    const service = createPackageMatrix({provider: {day: provider.day}, knownHotel: () => true})
    const result = await service.read(trip, 'tez:1061', [8, 6, 7, 7])
    assert.equal(calls.length, 6)
    assert.equal(maximum, 3)
    assert.deepEqual(result.departures, [trip.first, trip.last])
    assert.deepEqual(result.rows, [{nights: 6, days: 7}, {nights: 7, days: 8}, {nights: 8, days: 9}])
    assert.deepEqual(result.cells.map(cell => [cell.nights, cell.departure, cell.status]), [
        [6, trip.first, 'in-budget'], [6, trip.last, 'empty'], [7, trip.first, 'outside-budget'],
        [7, trip.last, 'failed'], [8, trip.first, 'unknown'], [8, trip.last, 'unknown']
    ])
    const fare = result.cells[0].inBudget!
    assert.equal(result.cells[0].lowest?.total, 10_000)
    assert.equal(result.cells[0].highest?.total, 16_000)
    assert.match(fare.id, /^tez-offer:[a-f0-9]{24}$/)
    assert.deepEqual({...fare, id: null}, {id: null, departure: trip.first, total: 14_000, nights: 6, days: 7,
        adults: 2, children: 0, currency: 'EUR', priceBasis: 'party-total', room: 'STANDARD ROOM', board: 'HB',
        sourceUrl: 'https://www.tez-tour.com/hotel.html?id=1061', checkedAt})
    assert.equal(result.cells[1].complete, true)
    assert.equal(result.cells[3].checkedAt, null)
    assert.equal(result.cells[4].complete, false)
    const floor = await service.read({...trip, minTotal: 0}, 'tez:1061', [6, 7, 8])
    assert.equal(calls.length, 6)
    assert.equal(floor.cells[0].inBudget?.total, 10_000)
    assert.equal(floor.cells[0].inBudget?.nights, 6)
    assert.equal(floor.cells[0].source.status, 'cached')
    const unknownProperty = createPackageMatrix({provider: {day: provider.day}})
    assert.equal((await unknownProperty.read({...trip, first: trip.last}, 'tez:1061', [6])).cells[0].status, 'unknown')
    await assert.rejects(service.read({...trip, last: '2030-01-26'}, 'tez:1061', [6, 7, 8]), RangeError)
    await assert.rejects(service.read({...trip, last: trip.first}, 'tez:1061', [6, 7, 8, 9]), RangeError)
})

test('overlapping chunks share supplier work and cancelling one reader leaves the other intact', async t => {
    let calls = 0
    const released: (() => void)[] = []
    t.after(() => released.forEach(release => release()))
    const provider = createTezInventory({now: () => new Date(checkedAt), fetch: async () => {
        calls++
        await new Promise<void>(resolve => released.push(resolve))
        return Response.json({success: true, data: [], info: [['More results', 'false']]})
    }})
    const service = createPackageMatrix({provider: {day: provider.day}, knownHotel: () => true})
    const controller = new AbortController()
    const cancelled = service.read(trip, 'tez:1061', [7], controller.signal)
    const survivor = service.read(trip, 'tez:1061', [7])
    await setImmediate()
    const rejected = assert.rejects(cancelled, {name: 'AbortError'})
    controller.abort()
    await rejected
    released.forEach(release => release())
    const result = await survivor
    assert.equal(calls, 2)
    assert.deepEqual(result.cells.map(cell => cell.status), ['empty', 'empty'])
})

test('local quota returns an exact cooldown, keeps known fares and resumes the same cell after the injected clock advances', async () => {
    let clock = Date.parse(checkedAt)
    let calls = 0
    const fetcher = (async function supplier(input) {
        calls++
        const params = new URL(String(input)).searchParams
        const data = [[params.get('after'), [], '', Number(params.get('nightsMin')), '', ['', '', 5734],
            ['', 'SAND BEACH 3 *', '', Number(params.get('hotelId'))], ['HB', 'HB', 2474, 2146],
            [2471, 'Standard', 2147], [[2, 0, 0]], {currency: 'EUR', total: 140}]]
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', 'false']]})
    }) as typeof fetch
    const provider = createTezInventory({now: () => new Date(clock), fetch: fetcher})
    const input = {...trip, last: trip.first}
    await Promise.all(Array.from({length: 45}, (_, index) => provider.day(input, 'tez:' + (1000 + index), trip.first)))
    assert.equal(calls, 45)
    const retryAt = new Date(clock + 60_000).toISOString()
    assert.equal(tezSearchRetryAt(fetcher, clock), clock + 60_000)
    const service = createPackageMatrix({provider: {day: provider.day}, knownHotel: () => true})
    const waiting = await service.read(input, 'tez:1061', [7])
    assert.equal(calls, 45)
    assert.equal(waiting.cells[0].status, 'unknown')
    assert.equal(waiting.cells[0].retryAt, retryAt)
    assert.equal(waiting.source.retryAt, retryAt)
    assert.equal(waiting.cells[0].complete, false)
    const known = await provider.day(input, 'tez:1000', trip.first, true)
    assert.equal(known.quotes[0].total, 14_000)
    assert.equal(known.source.status, 'cached')
    assert.equal(known.source.retryAt, retryAt)
    assert.equal(known.source.updatedAt, checkedAt)
    const retained = createPackageMatrix({provider: {day: async () => known}, knownHotel: () => true})
    const retainedCell = (await retained.read(input, 'tez:1000', [7])).cells[0]
    assert.equal(retainedCell.status, 'unknown')
    assert.equal(retainedCell.inBudget?.total, 14_000)
    assert.equal(retainedCell.checkedAt, checkedAt)
    assert.equal(retainedCell.retryAt, retryAt)
    clock += 60_000
    const resumed = await service.read(input, 'tez:1061', [7])
    assert.equal(calls, 46)
    assert.equal(resumed.cells[0].status, 'in-budget')
    assert.equal(resumed.cells[0].checkedAt, new Date(clock).toISOString())
    assert.equal(resumed.cells[0].retryAt, undefined)
    assert.equal(tezSearchRetryAt(fetcher, clock), null)
})


test('one ranged observation per date separates actual supplier nights and keeps incomplete absent rows unknown', async () => {
    let calls = 0
    let complete = true
    const provider = createTezInventory({now: () => new Date(checkedAt), fetch: async input => {
        calls++
        const params = new URL(String(input)).searchParams
        assert.equal(params.get('nightsMin'), '6')
        assert.equal(params.get('nightsMax'), '8')
        assert.equal(params.get('hotelId'), '1061')
        const data = [7, 8].flatMap(nights => [100, 140].map(total => [params.get('after'), [], '', nights, '', ['', '', 5734],
            ['', 'SAND BEACH 3 *', '', 1061], ['HB'], [2471, 'Standard'], [[2, 0, 0]], {currency: 'EUR', total: total + nights}]))
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', String(!complete)]]})
    }})
    const service = createPackageMatrix({provider, knownHotel: () => true})
    const result = await service.read(trip, 'tez:1061', [6, 7, 8])
    assert.equal(calls, 2)
    assert.deepEqual(result.cells.map(cell => cell.status), ['empty', 'empty', 'in-budget', 'in-budget', 'in-budget', 'in-budget'])
    assert.equal(result.cells[2].inBudget?.total, 14_700)
    assert.equal(result.cells[2].inBudget?.nights, 7)
    assert.equal(result.cells[4].inBudget?.total, 14_800)
    assert.equal(result.cells[4].inBudget?.nights, 8)
    assert.notEqual(result.cells[2].inBudget?.id, result.cells[4].inBudget?.id)
    await service.read({...trip, minTotal: 0}, 'tez:1061', [6, 7, 8])
    assert.equal(calls, 2)
    complete = false
    const partial = await service.read({...trip, first: '2030-01-26', last: '2030-01-26'}, 'tez:1061', [6, 7, 8])
    assert.equal(calls, 3)
    assert.equal(partial.cells[0].status, 'unknown')
    assert.equal(partial.cells[0].complete, false)
    assert.equal(partial.cells[1].inBudget?.nights, 7)
})
