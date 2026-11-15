import assert from 'node:assert/strict'
import {AsyncLocalStorage} from 'node:async_hooks'
import test from 'node:test'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'
import {createPackages} from '../backend/packages.ts'
import {createTravelWorker} from '../backend/worker.ts'

const query = 'areaMode=destination&destination=hurghada&firstDeparture=2030-01-24&lastDeparture=2030-01-25&nights=7&adults=2&minTotal=0&maxTotal=500000'
function row(params: URLSearchParams, id: number, name: string, total: number) {
    return [params.get('after'), [], '', Number(params.get('nightsMin')), '', ['', '', 5734], ['', name, '', id],
        ['HB'], [2471, 'Standard'], [[2, 0, 0]], {currency: 'EUR', total}]
}
function request(path: string) { return new Request('https://travel.example/api/travel/' + path) }

test('hosted Worker fails closed before creating a memory provider when its R2 binding is absent', async () => {
    const worker = createTravelWorker({requireSharedStorage: true})
    const response = await worker.fetch(request('packages?' + query))
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('retry-after'), '10')
    const health = await (await worker.fetch(request('health'))).json()
    assert.equal(health.persistence, 'unavailable')
    assert.equal(health.expected, 'r2-shared')
})

test('anonymous map geography remains readable during a missing R2 binding and scoped geography stays closed', async () => {
    const worker = createTravelWorker({requireSharedStorage: true})
    assert.equal((await worker.fetch(request('destinations'))).status, 200)
    const url = 'package-map-hotels?destination=sharm'
    const response = await worker.fetch(request(url))
    assert.equal(response.status, 200)
    assert.ok((await response.json()).knownHotels.length > 0)
    assert.equal((await worker.fetch(request(url + '&agency=local'))).status, 503)
    const owner = new Request(request(url), {headers: {'oai-authenticated-user-id': 'verified-owner'}})
    assert.equal((await worker.fetch(owner)).status, 503)
})

test('ongoing quote work belongs to its originating request while static assets and health stay independent', async () => {
    const ownership = new AsyncLocalStorage<{waitUntil: (work: Promise<unknown>) => void}>()
    let started!: () => void
    let release!: () => void
    const reading = new Promise<void>(resolve => {started = resolve})
    const gate = new Promise<void>(resolve => {release = resolve})
    const bucket = {
        async get() {
            started()
            await gate
            throw new Error('Offline fixture')
        },
        async put() {throw new Error('Unexpected put')},
    }
    const worker = createTravelWorker({requireSharedStorage: true,
        waitUntil(work) {ownership.getStore()!.waitUntil(work)},
        assets: {'/index.html': {body: 'bWFw', type: 'text/html'}}})
    function visit(url: string, jobs: Promise<unknown>[]) {
        const context = {waitUntil(work: Promise<unknown>) {jobs.push(work)}}
        return ownership.run(context, () => worker.fetch(new Request(url), {BUCKET: bucket}, context))
    }
    const quoteJobs: Promise<unknown>[] = []
    const unrelated: Promise<unknown>[] = []
    const quote = visit(request('packages?' + query).url, quoteJobs)
    try {
        await reading
        const home = await visit('https://travel.example/', unrelated)
        assert.equal(await home.text(), 'map')
        const health = await (await visit(request('health').url, unrelated)).json()
        assert.ok(health.boundedJobs > 0)
        assert.ok(quoteJobs.length > 0)
        assert.equal(unrelated.length, 0)
    } finally { release() }
    assert.equal((await quote).status, 200)
    await Promise.all(quoteJobs)
    assert.equal((await (await visit(request('health').url, unrelated)).json()).boundedJobs, 0)
})

test('Worker search uses the shared name index, ignores viewport, refreshes real observations and preserves unknown catalog hotels', async () => {
    let calls = 0
    let total = 1384
    let fail = false
    let clock = Date.parse('2030-01-01T10:00:00Z')
    const provider = createTezInventory({now: () => new Date(clock), fetch: async input => {
        calls++
        if (fail) throw new Error('Unavailable upstream')
        const params = new URL(String(input)).searchParams
        return Response.json({success: true, departureCityId: 3746, info: [['More results', 'false']],
            data: [row(params, 1061, 'SAND BEACH 3 *', total), row(params, 99001, 'Café Dune 4 *', 2000)]})
    }})
    const worker = createTravelWorker({packages: createPackages(provider)})
    const cafe = await worker.fetch(request('package-hotel-search?' + query + '&q=CAFE&limit=8'))
    assert.equal(cafe.status, 200)
    const cafeData = await cafe.json()
    assert.deepEqual(cafeData.items.map((hotel: {hotelId: string}) => hotel.hotelId), ['tez:99001'])
    const sand = await (await worker.fetch(request('package-hotel-search?' + query + '&q=sand&west=0&east=1&south=0&north=1'))).json()
    assert.equal(sand.items[0].minTotal, 138400)
    assert.equal(calls, 1)
    const page = await (await worker.fetch(request('packages?' + query + '&limit=1'))).json()
    assert.equal(page.knownHotels.some((hotel: {id: string}) => hotel.id == 'tez:1061' || hotel.id == 'tez:99001'), false)
    clock += 1000
    total = 1412
    const fresh = await (await worker.fetch(request('package-hotel-search?' + query + '&q=sand&refresh=1'))).json()
    assert.equal(calls, 2)
    assert.equal(fresh.items[0].minTotal, 141200)
    assert.equal(fresh.source.status, 'live')
    assert.equal(fresh.source.updatedAt, new Date(clock).toISOString())
    fail = true
    clock += 1000
    const stale = await (await worker.fetch(request('package-hotel-search?' + query + '&q=sand&refresh=1'))).json()
    assert.equal(stale.source.stale, true)
    assert.equal(stale.source.updatedAt, fresh.source.updatedAt)
    assert.equal(stale.items[0].minTotal, 141200)
    const unknown = await (await worker.fetch(request('package-hotel-search?' + query + '&q=desert%20rose'))).json()
    assert.equal(unknown.items.length, 0)
    assert.equal(unknown.knownHotels[0].id, 'tez:511')
    assert.equal('minTotal' in unknown.knownHotels[0], false)
    assert.equal(unknown.knownHotels[0].photos.length, 5)
    assert.equal((await worker.fetch(request('package-hotel-search?' + query + '&refresh=yes'))).status, 400)
    assert.equal((await worker.fetch(request('flights'))).status, 501)
    const health = await (await worker.fetch(request('health'))).json()
    assert.equal(health.runtime, 'worker-esm')
    assert.ok(health.operations.includes('/api/travel/package-hotel-search'))
})

test('empty inventory keeps verified hotel metadata and failed forced matrix refresh stays unknown with the original fare time', async () => {
    let fail = false
    let clock = Date.parse('2030-01-01T10:00:00Z')
    const provider = createTezInventory({now: () => new Date(clock), fetch: async input => {
        if (fail) throw new Error('Unavailable upstream')
        const params = new URL(String(input)).searchParams
        const data = params.has('hotelId') ? [row(params, 1061, 'SAND BEACH 3 *', 1384)] : []
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', 'false']]})
    }})
    const packages = createPackages(provider)
    const worker = createTravelWorker({packages})
    const page = await (await worker.fetch(request('packages?' + query))).json()
    assert.equal(page.total, 0)
    assert.equal(page.knownHotels.length, 62)
    assert.equal(page.knownHotels.every((hotel: object) => !('minTotal' in hotel)), true)
    const matrixQuery = query.replace('lastDeparture=2030-01-25', 'lastDeparture=2030-01-24') + '&hotelId=tez:1061&nightsValues=7'
    const confirmed = await (await worker.fetch(request('package-matrix?' + matrixQuery))).json()
    assert.equal(confirmed.cells[0].status, 'in-budget')
    fail = true
    clock += 1000
    const stale = await (await worker.fetch(request('package-matrix?' + matrixQuery + '&refresh=1'))).json()
    assert.equal(stale.source.stale, true)
    assert.equal(stale.cells[0].status, 'unknown')
    assert.equal(stale.cells[0].complete, false)
    assert.equal(stale.cells[0].inBudget.id, confirmed.cells[0].inBudget.id)
    assert.equal(stale.cells[0].checkedAt, confirmed.cells[0].checkedAt)
})
