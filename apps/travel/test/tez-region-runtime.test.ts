import assert from 'node:assert/strict'
import test from 'node:test'
import {createTezRegions} from '../backend/partners/tez-regions.ts'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'
import {createTezProperties} from '../backend/partners/tez-properties.ts'
import {createPackages} from '../backend/packages.ts'
import {createTravelWorker} from '../backend/worker.ts'
import type {PackageHotel} from '../src/package-contract.ts'
import type {TezObservation} from '../backend/partners/tez-inventory.ts'

const trip = 'destination=antalya&areaMode=map&west=30.53&south=36.80&east=30.99&north=36.97'
    + '&firstDeparture=2030-06-01&lastDeparture=2030-06-02&nights=7&adults=2'

test('lazy country references use exact Tallinn tour IDs and preserve unknown metadata after a tariff cooldown', async () => {
    const paths: string[] = []
    let clock = Date.parse('2030-01-01T10:00:00Z')
    const sourceFetch: typeof fetch = async function sourceFetch(input, options) {
        assert.equal(options?.redirect, 'manual')
        const url = new URL(String(input))
        paths.push(url.pathname)
        if (url.pathname.endsWith('/regions')) return Response.json({success: true, tours: [
            {name: 'ANTALYA', tourId: [1285], fromCityId: [3746]},
        ]})
        if (url.pathname.endsWith('/hotels')) return Response.json({success: true, hotels: [
            {tourId: 1285, hotelId: 323670, name: 'ADALYA ELITE LARA 5 *'},
            {tourId: 1285, hotelId: 3015393, name: 'BAIA LARA 5 *'},
            {tourId: 12691, hotelId: 9003205, name: 'SIDE HOTEL 5 *'},
        ]})
        if (url.pathname.endsWith('/getResult')) return Response.json({message: 'Too many requests. Try later'},
            {status: 429, headers: {'retry-after': '90'}})
        if (url.pathname == '/hotel.html') {
            const id = Number(url.searchParams.get('id'))
            if (id != 323670) return new Response('No published coordinates', {status: 503})
            return new Response('<h1>ADALYA ELITE LARA 5 *</h1><script>HOTEL_ID=323670;SITE_HOTEL_ID=50003459;'
                + 'GEO_LOCATION_LATITUDE=36.856625;GEO_LOCATION_LONGITUDE=30.895462;</script>')
        }
        return Response.json({success: true, mainSiteGallery: {folder: 'hotel/50003459', name: '01__13__8470.jpg'}})
    }
    const deps = {fetch: sourceFetch, now: () => new Date(clock)}
    const regions = createTezRegions(deps)
    const catalog = {...createTezProperties(deps), known: regions.hotels}
    const provider = createTezInventory({...deps, resolveRegion: regions.resolve, catalog})
    const worker = createTravelWorker({packages: createPackages(provider)})
    const focus = await (await worker.fetch(new Request('https://travel.example/api/travel/destinations?id=antalya'))).json()
    assert.equal(focus.destinations[0].id, 'antalya')
    assert.equal(paths.length, 0)
    const result = await (await worker.fetch(new Request('https://travel.example/api/travel/packages?' + trip))).json()
    assert.equal(result.area.destinations[0].id, 'antalya')
    assert.equal(result.area.coverage, 'partial')
    assert.equal(result.items.length, 0)
    assert.equal(result.knownHotels.length, 2)
    assert.equal(result.source.retryAt, '2030-01-01T10:01:30.000Z')
    const adalya = result.knownHotels.find((hotel: {id: string}) => hotel.id == 'tez:323670')
    assert.equal(adalya.destinationId, 'antalya')
    assert.equal(adalya.latitude, 36.856625)
    assert.equal(adalya.longitude, 30.895462)
    assert.equal(adalya.photo.url, 'https://s.tez-tour.com/hotel/50003459/01__13__8470_middle.jpg')
    const unknown = await (await worker.fetch(new Request('https://travel.example/api/travel/package-hotel-search?' + trip + '&q=baia'))).json()
    assert.equal(unknown.knownHotels[0].latitude, null)
    assert.equal(unknown.knownHotels[0].destinationId, 'antalya')
    assert.equal(paths.filter(path => path.endsWith('/getResult')).length, 1)
    assert.equal(paths.filter(path => path.endsWith('/regions')).length, 1)
    assert.equal(paths.filter(path => path.endsWith('/hotels')).length, 1)
    const gallery = await (await worker.fetch(new Request('https://travel.example/api/travel/package-gallery?hotelId=tez:323670'))).json()
    assert.equal(gallery.hotelId, 'tez:323670')
    const matrixQuery = trip + '&hotelId=tez:323670&nightsValues=7'
    const matrix = await (await worker.fetch(new Request('https://travel.example/api/travel/package-matrix?' + matrixQuery))).json()
    assert.ok(matrix.cells.every((cell: {status: string}) => cell.status == 'unknown'))
    assert.equal(paths.filter(path => path.endsWith('/getResult')).length, 1)
    clock += 91_000
    await worker.fetch(new Request('https://travel.example/api/travel/packages?' + trip + '&refresh=1'))
    assert.equal(paths.filter(path => path.endsWith('/getResult')).length, 2)
})

test('supplier Retry-After preserves earlier fares and pauses different regional requests too', async () => {
    let clock = Date.parse('2030-01-01T10:00:00Z')
    let blocked = false
    let calls = 0
    const provider = createTezInventory({now: () => new Date(clock), fetch: async function sourceFetch() {
        calls++
        if (blocked) return new Response('', {status: 429, headers: {'retry-after': '120'}})
        return Response.json({success: true, departureCityId: 3746, info: [['More results', 'false']], data: [
            ['24.01.2030', [], '', 7, '', ['', '', 5734], ['', 'SAND BEACH 3 *', '', 1061], ['HB'],
                [2471, 'Standard'], [[2, 0, 0]], {currency: 'EUR', total: 1384}],
        ]})
    }})
    const context = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-24', nights: 7,
        adults: 2, minTotal: 0, maxTotal: 500_000}
    const first = await provider.window(context)
    blocked = true
    clock += 1000
    const stale = await provider.window(context, undefined, true)
    assert.equal(stale.source.stale, true)
    assert.equal(stale.source.updatedAt, first.source.updatedAt)
    assert.equal(stale.quotes[0].total, first.quotes[0].total)
    assert.equal(stale.source.retryAt, '2030-01-01T10:02:01.000Z')
    const other = await provider.window({...context, destinationId: 'sharm'})
    assert.equal(other.source.retryAt, stale.source.retryAt)
    assert.equal(calls, 2)
})

test('additional metadata batches rebuild the area index even while the price generation stays unchanged', async () => {
    let batches = 0
    const known: PackageHotel[] = [
        {id: 'tez:323670', name: 'ADALYA ELITE LARA 5 *', stars: 5, latitude: null, longitude: null, url: 'https://www.tez-tour.com/hotel.html?id=323670'},
        {id: 'tez:3015393', name: 'BAIA LARA 5 *', stars: 5, latitude: null, longitude: null, url: 'https://www.tez-tour.com/hotel.html?id=3015393'},
    ]
    const observation: TezObservation = {quotes: [], byFareId: new Map(), generation: 'unchanged', complete: false,
        source: {id: 'tez', name: 'TEZ', status: 'unavailable', updatedAt: null, description: 'A recorded pause'}}
    const catalog = {
        read: () => null,
        known: async () => known,
        gallery: async () => null,
        enrich: async function enrich(destinationId: string, hotels: readonly PackageHotel[]) {
            batches++
            return hotels.map((hotel, index) => index < batches
                ? {...hotel, destinationId, latitude: 36.856625, longitude: 30.895462}
                : {...hotel, destinationId})
        },
    }
    const packages = createPackages({window: async () => observation, day: async () => observation, catalog})
    const worker = createTravelWorker({packages})
    const first = await (await worker.fetch(new Request('https://travel.example/api/travel/packages?' + trip))).json()
    assert.equal(first.knownHotels.filter((hotel: PackageHotel) => hotel.latitude != null).length, 1)
    const second = await (await worker.fetch(new Request('https://travel.example/api/travel/packages?' + trip))).json()
    assert.equal(second.knownHotels.filter((hotel: PackageHotel) => hotel.latitude != null).length, 2)
    assert.equal(second.knownHotels.length, 2)
    const projection = await (await worker.fetch(new Request('https://travel.example/api/travel/package-map-hotels?'
        + 'destination=antalya&west=30.89&south=36.85&east=30.90&north=36.86'))).json()
    assert.deepEqual(projection.knownHotels.map((hotel: PackageHotel) => hotel.id).sort(), known.map(hotel => hotel.id).sort())
    assert.equal(batches, 2)
})
