import assert from 'node:assert/strict'
import test from 'node:test'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'
import {stayProviders} from '../backend/providers/stays/definitions.ts'
import {readBooking} from '../backend/providers/stays/booking.ts'
import {readRapid} from '../backend/providers/stays/rapid.ts'
import {readXotelo} from '../backend/providers/stays/xotelo.ts'
import {readTravelgate} from '../backend/providers/stays/travelgate.ts'

const query: ProviderQuery = {kind: 'hotels', destination: 'Bangkok', checkIn: '2026-12-15', checkOut: '2026-12-22',
    adults: 2, adultAges: [32, 34], rooms: 1, currency: 'EUR', nationality: 'EE', bookerCountry: 'EE', latitude: 13.75, longitude: 100.52,
    providerRefs: {'hotelbeds': {hotelIds: ['123']}, 'booking-demand': {hotelIds: ['123']}, 'expedia-rapid': {hotelIds: ['123']},
        liteapi: {hotelIds: ['lp123']}, travelgate: {hotelIds: ['123']}, dida: {hotelIds: ['512']}, xotelo: {hotelIds: ['g293916-d300624']},
        makcorps: {destinationId: '293916'}, agoda: {hotelIds: ['123']}, grnconnect: {hotelIds: ['123']}, tourmind: {hotelIds: ['123']}}}
const money = {value: '120.50', currency: 'EUR'}
const rapid = [{property_id: '123', rooms: [{id: 'r', room_name: 'Double Room', rates: [{id: 'rate', refundable: true,
    occupancy_pricing: {'2': {totals: {property_inclusive: {request_currency: money}}}}}]}]}]
const booking = {data: [{id: 123, currency: {accommodation: 'USD', booker: 'EUR'},
    price: {total: {accommodation_currency: 150, booker_currency: 120.5}}, url: 'https://www.booking.com/hotel/th/example.html'}]}
const travelgate = {data: {hotelX: {search: {options: [{id: 'opt', status: 'OK', hotelCode: '123', hotelName: 'Hotel',
    boardCode: 'RO', price: {currency: 'EUR', gross: 100, minimumSellingPrice: 120.5, net: 90, binding: true},
    cancelPolicy: {refundable: true}}]}}}}
const fixtures = {
    hotelbeds: {hotels: {hotels: [{code: 123, name: 'Hotel', currency: 'EUR', rooms: [{rates: [{rateKey: 'rk', rooms: 1,
        sellingRate: '120.50', net: '100.00', taxes: {allIncluded: false}}]}]}]}},
    ratehawk: {status: 'ok', data: {hotels: [{id: 'hotel', hid: 123, rates: [{match_hash: 'match', meal: 'breakfast',
        payment_options: {payment_types: [{show_amount: '120.50', show_currency_code: 'EUR', amount: '150', currency_code: 'USD'}]}}]}]}},
    'booking-demand': booking,
    'expedia-rapid': rapid,
    liteapi: {data: [{hotelId: 'lp123', name: 'Hotel', roomTypes: [{offerId: 'o', offerRetailRate: {amount: 100, currency: 'EUR'},
        suggestedSellingPrice: {amount: 120.5, currency: 'EUR'}, rates: [{boardName: 'Breakfast',
            cancellationPolicies: {refundableTag: 'RFN'}, retailRate: {taxesAndFees: [{included: false, amount: 10}]}}]}]}]},
    travelgate,
    dida: {Success: {PriceDetails: {CheckInDate: query.checkIn, CheckOutDate: query.checkOut, HotelList: [{HotelID: 512,
        HotelName: 'Hotel', RatePlanList: [{RatePlanID: 'rate', TotalPrice: 120.5, Currency: 'EUR', RoomStatus: 1,
            RoomOccupancy: {AdultCount: 2}, BreakfastType: 1}]}]}}},
    xotelo: {error: null, result: {chk_in: query.checkIn, chk_out: query.checkOut, currency: 'EUR',
        rates: [{code: 'BookingCom', name: 'Booking.com', rate: 120.5}]}},
    makcorps: [{hotelId: 123, name: 'Hotel', vendor1: 'Booking.com', price1: '€120.50'}],
    agoda: {properties: [{propertyId: 123, propertyName: 'Hotel', rooms: [{blockId: 'block', totalPayment: {inclusive: 100, minSellPrice: 120.5},
        rate: {currency: 'EUR'}, freeCancellation: true}]}]},
    grnconnect: {checkin: query.checkIn, checkout: query.checkOut, hotels: [{hotel_code: '123', name: 'Hotel',
        rates: [{rate_key: 'rk', no_of_rooms: 1, price: 100, msp: {currency: 'EUR', price: 120.5}, currency: 'EUR'}]}]},
    tourmind: {Hotels: [{HotelCode: '123', CheckIn: query.checkIn, CheckOut: query.checkOut, RoomTypes: [{Name: 'Double',
        RateInfos: [{RateCode: 'r', OnRequest: false, Allotment: 2, TotalPrice: 120.5, CurrencyCode: 'EUR'}]}]}]},
} as const

const endpoints = {
    hotelbeds: 'https://api.hotelbeds.com/hotel-api/1.0/hotels',
    ratehawk: 'https://api.ratehawk.com/api/b2b/v3/search/serp/geo/',
    'booking-demand': 'https://demandapi.booking.com/3.3/accommodations/search',
    'expedia-rapid': 'https://api.ean.com/v3/properties/availability',
    liteapi: 'https://api.liteapi.travel/v3.0/hotels/rates',
    travelgate: 'https://api-shopping.travelgate.com/graphql',
    dida: 'https://apiint.didatravel.com/api/rate/pricesearch',
    xotelo: 'https://data.xotelo.com/api/rates',
    makcorps: 'https://api.makcorps.com/city',
    agoda: 'https://fixture-provider.invalid/api/v4/property/availability',
    grnconnect: 'https://fixture-provider.invalid/api/v3/hotels/availability',
    tourmind: 'https://fixture-provider.invalid/v2/HotelDetail',
} as const

for (const [id, registration] of Object.entries(stayProviders).filter(([id]) => id in fixtures)) {
    test(id + ' executes its documented request and parses the supplier price', async () => {
        const env = Object.fromEntries(registration.definition.requiredEnv.map(key => [key,
            key.endsWith('_API_BASE') ? 'https://fixture-provider.invalid' : 'fixture-key']))
        const calls: {url: string, init?: RequestInit}[] = []
        const deps: ProviderDeps = {env, now: () => new Date('2026-11-14T01:00:00Z'), async fetch(input, init) {
            calls.push({url: String(input), init})
            return Response.json(fixtures[id as keyof typeof fixtures])
        }}
        const adapter = await registration.load()
        const result = await adapter.search(query, deps)
        assert.equal(result.status, id == 'xotelo' ? 'cached' : 'live', result.description)
        assert.equal(result.offers.length, 1)
        assert.equal(result.offers[0].price.amount, 120.5)
        assert.equal(result.offers[0].price.currency, 'EUR')
        assert.equal(result.offers[0].checkIn, query.checkIn)
        assert.ok(calls[0].url.startsWith(endpoints[id as keyof typeof endpoints]))
        assert.equal(calls[0].init?.redirect, 'error')
        if (id == 'tourmind') {
            const body = JSON.parse(String(calls[0].init?.body))
            assert.deepEqual(body.PaxRooms, [{Adults: 2, Children: 0, ChildrenAges: [], RoomCount: 1}])
            assert.equal(body.RoomCount, undefined)
        }
        if (registration.definition.requiredEnv.length) {
            const unauthorized = await adapter.search(query, {...deps, fetch: async () => new Response('', {status: 401})})
            assert.equal(unauthorized.status, 'requires-access')
            assert.equal(unauthorized.offers.length, 0)
        }
    })
}

test('Booking Demand keeps the amount and currency from the same response branch', () => {
    const deps: ProviderDeps = {fetch, env: {}, now: () => new Date('2026-11-14T01:00:00Z')}
    const offers = readBooking(booking, query, deps)
    assert.deepEqual(offers[0].price, {amount: 120.5, currency: 'EUR', basis: 'party', type: 'unknown'})
    const fallback = {data: [{id: 123, currency: {accommodation: 'USD', booker: null},
        price: {total: {accommodation_currency: 150, booker_currency: null}}}]}
    assert.equal(readBooking(fallback, query, deps)[0].price.currency, 'USD')
    assert.equal(readBooking(fallback, query, deps)[0].price.amount, 150)
})

test('nightly and supplier prices retain their true hotel identity and selling floor', () => {
    const deps: ProviderDeps = {fetch, env: {}, now: () => new Date('2026-11-14T01:00:00Z')}
    const nightly = readXotelo(fixtures.xotelo, query, deps, 'g293916-d300624', {key: 'g293916-d300624', name: 'Asia Hotel Bangkok'})[0]
    assert.equal(nightly.hotel?.name, 'Asia Hotel Bangkok')
    assert.equal(nightly.title, 'Asia Hotel Bangkok · Booking.com')
    assert.equal(nightly.price.basis, 'room-night')
    assert.equal(nightly.includes.taxes, null)
    const group = readRapid(rapid, {...query, adults: 4, rooms: 2}, deps)[0]
    assert.equal(group.price.amount, 241)
    assert.equal(group.hotel?.name, 'Expedia · 123')
    assert.equal(readTravelgate(travelgate, query, deps)[0].price.amount, 120.5)
})

test('hotel sandbox replies are diagnostic and never production live offers', async () => {
    const {search} = await stayProviders.hotelbeds.load()
    const deps: ProviderDeps = {now: () => new Date('2026-11-14T01:00:00Z'),
        env: {HOTELBEDS_API_KEY: 'test-key', HOTELBEDS_SECRET: 'test-secret', HOTELBEDS_SANDBOX: 'true'},
        fetch: async () => Response.json(fixtures.hotelbeds)}
    const result = await search(query, deps)
    assert.equal(result.status, 'sandbox')
    assert.equal(result.environment, 'sandbox')
})
