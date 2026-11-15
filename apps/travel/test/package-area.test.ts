import assert from 'node:assert/strict'
import test from 'node:test'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'
import {createPackages} from '../backend/packages.ts'
import {createTravelWorker} from '../backend/worker.ts'

const base = 'destination=hurghada&areaMode=map&firstDeparture=2030-01-24&lastDeparture=2030-01-25&nights=7&adults=2&minTotal=0&maxTotal=500000'
const boxes = {
    hurghada: '&west=33.70&south=27.03&east=33.97&north=27.35',
    sharm: '&west=34.25&south=27.79&east=34.46&north=28.07',
    rhodes: '&west=28.09&south=36.31&east=28.25&north=36.48',
} as const
const rows = {
    5734: {id: 1061, name: 'SAND BEACH 3 *', total: 1384},
    5735: {id: 105791, name: 'TURQUOISE BEACH HOTEL 3 *', total: 1100},
    9003981: {id: 25123, name: 'RHODES TEST HOTEL 4 *', total: 1600},
} as const

function fixture() {
    const calls: number[] = []
    let clock = Date.parse('2030-01-01T10:00:00Z')
    let failingRegion = 0
    const provider = createTezInventory({now: () => new Date(clock), fetch: async function fetchSource(input) {
        const params = new URL(String(input)).searchParams
        const region = Number(params.get('tourId'))
        calls.push(region)
        if (region == failingRegion) throw new Error('Controlled source failure')
        const hotel = rows[region as keyof typeof rows]
        const data = hotel ? [[params.get('after'), [], '', Number(params.get('nightsMin')), '', ['', '', region],
            ['', hotel.name, '', hotel.id], ['HB'], [2471, 'Standard'], [[2, 0, 0]], {currency: 'EUR', total: hotel.total}]] : []
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', 'false']]})
    }})
    const worker = createTravelWorker({packages: createPackages(provider)})
    async function read(path: string, extra = '') {
        const response = await worker.fetch(new Request('https://travel.example/api/travel/' + path + '?' + base + extra))
        return {status: response.status, data: await response.json()}
    }
    return {read, calls, fail(region: number) {failingRegion = region}, advance() {clock += 1000}}
}

test('viewport selects Sharm independently from the old Hurghada destination and preserves source region', async () => {
    const app = fixture()
    const first = await app.read('packages', boxes.hurghada)
    assert.equal(first.status, 200)
    assert.deepEqual(first.data.area.destinations.map((region: {id: string}) => region.id), ['hurghada'])
    const sharm = await app.read('packages', boxes.sharm)
    assert.deepEqual(sharm.data.area.destinations.map((region: {id: string}) => region.id), ['sharm'])
    assert.equal(sharm.data.items[0].destinationId, 'sharm')
    assert.equal(sharm.data.items[0].hotelId, 'tez:105791')
    assert.equal(sharm.data.markers[0].destinationId, 'sharm')
    const search = await app.read('package-hotel-search', boxes.sharm + '&q=turquoise')
    assert.equal(search.data.items[0].destinationId, 'sharm')
    assert.equal(search.data.knownHotels.some((hotel: {id: string}) => hotel.id == 'tez:105791'), false)
    await app.read('packages', boxes.sharm.replace('east=34.46', 'east=34.45'))
    assert.deepEqual(app.calls, [5734, 5735])
})

test('unsupported viewport avoids source calls and does not claim that hotels do not exist', async () => {
    const app = fixture()
    const result = await app.read('packages', '&west=139&south=35&east=140&north=36')
    assert.equal(result.status, 200)
    assert.equal(result.data.area.coverage, 'unsupported')
    assert.match(result.data.area.description, /не означает, что здесь нет отелей/)
    assert.deepEqual(app.calls, [])
    assert.deepEqual(result.data.items, [])
})

test('region envelopes include verified hotels outside the old city rectangle', async () => {
    const app = fixture()
    const result = await app.read('packages', '&west=33.706&south=27.315&east=33.709&north=27.318')
    assert.equal(result.data.area.destinations[0].id, 'hurghada')
    assert.ok(result.data.knownHotels.some((hotel: {id: string}) => hotel.id == 'tez:210779'))
    assert.deepEqual(app.calls, [5734])
})

test('merged area keeps failed-refresh fares stale and hotel search remains scoped to the map', async () => {
    const app = fixture()
    const wide = '&west=28&south=26&east=35&north=37'
    const first = await app.read('packages', wide)
    const regions = new Set(first.data.area.destinations.map((region: {id: string}) => region.id))
    assert.ok(regions.has('hurghada') && regions.has('sharm') && regions.has('rhodes'))
    assert.equal(new Set(first.data.items.map((hotel: {hotelId: string}) => hotel.hotelId)).size, first.data.items.length)
    const onlySharm = await app.read('package-hotel-search', boxes.sharm + '&q=sand')
    assert.equal(onlySharm.data.items.length, 0)
    const original = first.data.items.find((hotel: {hotelId: string}) => hotel.hotelId == 'tez:105791')
    app.fail(5735)
    app.advance()
    const updated = await app.read('packages', wide + '&refresh=1')
    assert.equal(updated.data.area.coverage, 'partial')
    assert.equal(updated.data.source.stale, true)
    assert.equal(updated.data.source.updatedAt, first.data.source.updatedAt)
    assert.equal(updated.data.items.find((hotel: {hotelId: string}) => hotel.hotelId == 'tez:105791').minTotal, original.minTotal)
})
