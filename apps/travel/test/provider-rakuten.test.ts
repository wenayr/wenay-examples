import test from 'node:test'
import assert from 'node:assert/strict'
import {readRakuten, search} from '../backend/providers/regional/rakuten.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

const query: ProviderQuery = {kind: 'hotels', country: 'JP', checkIn: '2026-12-15', checkOut: '2026-12-22', adults: 2,
    rooms: 1, latitude: 35.6812, longitude: 139.7671, radiusKm: 2, currency: 'EUR'}

function fixture(chargeFlag = 1) {
    return {pagingInfo: {recordCount: 1, pageCount: 1, page: 1}, hotels: [{hotel: [
        {hotelBasicInfo: {hotelNo: 12345, hotelName: 'Tokyo Fixture Hotel', hotelMinCharge: 1,
            latitude: 35.68, longitude: 139.76, hotelInformationUrl: 'https://travel.rakuten.co.jp/HOTEL/12345/12345.html'}},
        {roomInfo: [{roomBasicInfo: {roomClass: 'double', roomName: 'Double', planId: 42, planName: 'Breakfast plan',
            withBreakfastFlag: 1, reserveUrl: 'https://travel.rakuten.co.jp/room/12345/42'}},
        {dailyCharge: {stayDate: '2026-12-15', rakutenCharge: 15000, total: 30000, chargeFlag}}]}
    ]}]}
}

function dependencies(): ProviderDeps {
    return {now: () => new Date('2026-11-14T10:00:00Z'), env: {RAKUTEN_APPLICATION_ID: 'own-app', RAKUTEN_ACCESS_KEY: 'own-secret'},
        fetch: async () => Response.json(fixture())}
}

test('Rakuten keeps first-night room price in JPY and never substitutes hotelMinCharge or a whole-stay multiplication', () => {
    const result = readRakuten(fixture(), query, dependencies())
    assert.equal(result.offers.length, 1)
    const offer = result.offers[0]
    assert.deepEqual(offer.price, {amount: 15000, currency: 'JPY', basis: 'room-night', type: 'retail'})
    assert.equal(offer.accuracy, 'published-from')
    assert.equal(offer.includes.taxes, null)
    assert.equal(offer.checkOut, '2026-12-22')
    assert.match(offer.conditions!, /первую ночь 2026-12-15/)
    assert.equal(readRakuten(fixture(0), query, dependencies()).status, 'unsupported-query')
    const wrongDate = fixture()
    const parts = wrongDate.hotels[0].hotel[1].roomInfo!
    parts[1].dailyCharge!.stayDate = '2026-12-16'
    assert.equal(readRakuten(wrongDate, query, dependencies()).offers.length, 0)
})

test('Rakuten sends WGS84 and separate server access key, while missing access and provider-specific bounds avoid network calls', async () => {
    let requests = 0
    const deps = dependencies()
    deps.fetch = async (url, options) => {
        requests++
        const parsed = new URL(String(url))
        assert.equal(parsed.origin, 'https://openapi.rakuten.co.jp')
        assert.equal(parsed.searchParams.get('datumType'), '1')
        assert.equal(parsed.searchParams.get('adultNum'), '2')
        assert.equal(parsed.searchParams.get('checkinDate'), '2026-12-15')
        assert.equal(parsed.searchParams.get('checkoutDate'), '2026-12-22')
        assert.equal(parsed.searchParams.get('searchRadius'), '2')
        assert.equal(parsed.searchParams.has('accessKey'), false)
        assert.equal(new Headers(options?.headers).get('accessKey'), 'own-secret')
        assert.equal(options?.redirect, 'error')
        return Response.json(fixture())
    }
    const result = await search(query, deps)
    assert.equal(result.offers.length, 1)
    assert.equal(JSON.stringify(result).includes('own-secret'), false)
    assert.equal(JSON.stringify(result).includes('own-app'), false)
    assert.equal((await search({...query, radiusKm: 20}, deps)).status, 'unsupported-query')
    assert.equal((await search({...query, rooms: 2}, deps)).status, 'unsupported-query')
    assert.equal((await search(query, {...deps, env: {}})).status, 'requires-access')
    assert.equal(requests, 1)
})
