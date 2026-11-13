import test from 'node:test'
import assert from 'node:assert/strict'
import {createPartnerOptions} from './index.ts'
import type {SupplyHotel} from '../../src/supply-contract.ts'

const clock = () => new Date('2026-11-13T09:00:00Z')
const destination = {id: 'hurghada', name: 'Хургада', country: 'Египет', latitude: 27.18, longitude: 33.84}
const trip = {destination, checkIn: '2027-01-24', checkOut: '2027-01-31', adults: 2}
const property: SupplyHotel = {
    id: 'osm:node/123', name: 'Test & Co', locality: null, latitude: 27.1, longitude: 33.8,
    category: null, sourceId: 'osm', sourceName: 'OpenStreetMap', sourceUrl: 'https://www.openstreetmap.org/node/123',
    website: 'https://example.test/', photo: null, price: null,
}

function tariff(region = 5734, total = '1384.20') {
    // Minimal test fixture matching the public format; this is not a bookable price.
    return ['24.01.2027', [], 'Sun', 7, '31.01', ['HRG', 'HRG', region],
        ['', 'Test Hotel', '', 112], ['HB'], [], [[2, 0, 0]], {currency: 'EUR', total}]
}

test('package search uses Tallinn, exact nights, availability filters and the whole group price', async () => {
    let calls = 0
    async function read(url: RequestInfo | URL) {
        calls++
        const params = new URL(String(url)).searchParams
        assert.equal(params.get('cityId'), '3746')
        assert.equal(params.get('tourId'), '5734')
        assert.equal(params.get('before'), '24.01.2027')
        assert.equal(params.get('nightsMax'), '7')
        assert.equal(params.get('accommodationId'), '2')
        const data = [tariff(), tariff(5735), tariff(5734, ''), tariff(5734, '1400')]
        return Response.json({success: true, data, departureCityId: 3746})
    }
    const options = createPartnerOptions({fetch: read, now: clock})
    const [one, two] = await Promise.all([options(trip), options(trip)])
    assert.equal(calls, 1)
    assert.equal(one.offers.length, 1)
    assert.equal(two.sources[0].status, 'live')
    assert.equal(one.offers[0].price.total, 138420)
    assert.equal(one.offers[0].url, 'https://www.tez-tour.com/hotel.html?id=112')
    assert.equal((await options(trip)).sources[0].status, 'cached')
    assert.equal(calls, 1)
})

test('a named geography listing supplies search links without borrowing prices from another property', async () => {
    const options = createPartnerOptions({fetch: async () => {throw new Error('Unexpected call')}, now: clock, bookingAid: '1234'})
    const response = await options({...trip, hotel: property})
    assert.equal(response.offers.length, 0)
    assert.equal(response.links.length, 4)
    const booking = response.links.find(link => link.id == 'booking')!
    const url = new URL(booking.url)
    assert.equal(booking.kind, 'affiliate')
    assert.match(url.searchParams.get('ss')!, /Test & Co/)
    assert.equal(url.searchParams.get('checkin'), '2027-01-24')
    assert.equal(url.searchParams.get('group_adults'), '2')
    assert.equal(url.searchParams.get('aid'), '1234')
    const nova = response.links.find(link => link.id == 'novatours')!
    assert.equal(nova.scope, 'destination')
    assert.equal(response.links.find(link => link.id == 'official')?.url, property.website)
})

test('without a partner account search links carry no affiliate claim and unsafe supplier links are omitted', async () => {
    const options = createPartnerOptions({fetch, now: clock})
    const response = await options({...trip, hotel: {...property, website: 'javascript:alert(0)'}})
    const booking = response.links.find(link => link.id == 'booking')!
    assert.equal(booking.kind, 'search')
    assert.equal(new URL(booking.url).searchParams.has('aid'), false)
    assert.equal(response.links.some(link => link.id == 'official'), false)
})

test('supplier failure keeps handoffs usable and never produces invented prices', async () => {
    const options = createPartnerOptions({fetch: async () => new Response('Service unavailable', {status: 503}), now: clock})
    const failed = await options(trip)
    assert.equal(failed.sources[0].status, 'unavailable')
    assert.equal(failed.offers.length, 0)
    assert.ok(failed.links.length >= 2)
    const threeAdults = await options({...trip, adults: 3})
    assert.equal(threeAdults.offers.length, 0)
    assert.equal(threeAdults.sources.some(source => source.id == 'tez' && source.status == 'live'), false)
    await assert.rejects(options({...trip, checkIn: '2027-02-30'}), /даты/)
    await assert.rejects(options({...trip, checkOut: undefined}), /даты/)
})

test('a successful empty supplier response omits departureCityId and results in zero live quotes', async () => {
    const options = createPartnerOptions({fetch: async () => Response.json({success: true, data: []}), now: clock})
    const result = await options(trip)
    assert.equal(result.offers.length, 0)
    assert.equal(result.sources[0].status, 'live')
})

test('датированное окно фильтрует минимум, выбранный день возвращает разные тарифы одного отеля по ID', async () => {
    const {createTezInventory} = await import('./tez-inventory.ts')
    const request = {destinationId: 'hurghada', first: '2027-01-15', last: '2027-01-31', nights: 7, adults: 2, minTotal: 140000, maxTotal: 145000}
    const fares = ['1384', '1412'].map((value, i) => {
        const row = tariff(5734, value)
        row[6] = ['', 'SAND BEACH 3 *', '', 1061]
        row[8] = [2471 + i]
        return row
    })
    const calls: URL[] = []
    const inventory = createTezInventory({now: clock, fetch: async url => {
        const supplier = new URL(String(url))
        calls.push(supplier)
        const data = supplier.searchParams.has('hotelId') ? fares : fares.slice(1)
        return Response.json({success: true, departureCityId: 3746, data, info: [['More results', 'false']]})
    }})
    const window = await inventory.window(request)
    assert.equal(calls[0].searchParams.get('priceMin'), '1400')
    assert.equal(window.quotes[0].latitude, 27.26083928002099)
    assert.equal(window.quotes[0].total, 141200)
    assert.equal(window.quotes[0].stars, 3)
    assert.equal(window.complete, false)
    const day = await inventory.day(request, 'tez:1061', '2027-01-24')
    assert.equal(calls[1].searchParams.get('hotelId'), '1061')
    assert.equal(calls[1].searchParams.get('groupByHotel'), null)
    assert.deepEqual(day.quotes.map(quote => quote.total), [138400, 141200])
    assert.equal(new Set(day.quotes.map(quote => quote.id)).size, 2)
    assert.equal(day.complete, true)
    const cached = await inventory.day({...request, minTotal: 0}, 'tez:1061', '2027-01-24')
    assert.equal(cached.quotes, day.quotes)
    assert.equal(calls.length, 2)
})
