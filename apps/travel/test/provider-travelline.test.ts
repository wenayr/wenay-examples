import test from 'node:test'
import assert from 'node:assert/strict'
import {createTravelLineAdapter} from '../backend/providers/regional/travelline.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

const query: ProviderQuery = {kind: 'hotels', checkIn: '2026-12-15', checkOut: '2026-12-17', adults: 2,
    rooms: 1, currency: 'EUR', providerRefs: {travelline: {hotelIds: ['1024', '2048']}}, limit: 1}

function json(value: unknown, status = 200) {return new Response(JSON.stringify(value), {status})}

test('TravelLine sends granted IDs, reads full-stay taxes and reuses OAuth across source pages', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/auth/token')) {
            const body = new URLSearchParams(String(init?.body))
            assert.equal(body.get('grant_type'), 'client_credentials')
            assert.equal(body.get('client_id'), 'fixture-client')
            assert.equal(body.get('client_secret'), 'fixture-secret')
            return json({access_token: 'fixture-token', expires_in: 900})
        }
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-token')
        if (url.includes('/room-stays/search')) {
            assert.equal(init?.method, 'POST')
            const body = JSON.parse(String(init?.body))
            assert.deepEqual(body.propertyIds, ['1024', '2048'])
            assert.equal(body.adults, 2)
            assert.equal(body.arrivalDate, '2026-12-15')
            assert.equal(body.departureDate, '2026-12-17')
            return json({roomStays: [
                {propertyId: '1024', roomType: {id: 'room-a'}, ratePlan: {id: 'rate-a'}, currencyCode: 'EUR',
                    total: {priceBeforeTax: 202, taxAmount: 14}, fullPlacementsName: '2 adults',
                    bookingFormLink: 'https://hotel.example/book?rate=rate-a'},
                {propertyId: '2048', roomType: {id: 'room-b'}, ratePlan: {id: 'rate-b'}, currencyCode: 'RUB',
                    total: {priceBeforeTax: 10000, taxAmount: 0}, fullPlacementsName: '2 adults'},
                {propertyId: '1024', roomType: {id: 'room-c'}, ratePlan: {id: 'corporate', corporateIds: ['private']},
                    currencyCode: 'EUR', total: {priceBeforeTax: 1, taxAmount: 0}},
                {propertyId: 'unrequested', roomType: {id: 'x'}, ratePlan: {id: 'y'},
                    currencyCode: 'EUR', total: {priceBeforeTax: 2, taxAmount: 0}},
            ]})
        }
        assert.ok(url.includes('/api/content/v1/properties?'))
        return json({properties: ['1024', '2048'].map(id => ({id, name: 'Hotel ' + id,
            contactInfo: {address: {countryCode: 'RUS', latitude: 55.75, longitude: 37.62}}}))})
    }
    const deps: ProviderDeps = {fetch: fetcher, now: () => new Date('2026-11-14T00:00:00Z'),
        env: {TRAVELLINE_CLIENT_ID: 'fixture-client', TRAVELLINE_CLIENT_SECRET: 'fixture-secret'}}
    const adapter = createTravelLineAdapter()
    const first = await adapter.search(query, deps)
    assert.equal(first.status, 'live')
    assert.equal(first.total, 2)
    assert.equal(first.nextOffset, 1)
    assert.equal(first.partial, true)
    assert.equal(first.offers[0].price.amount, 216)
    assert.equal(first.offers[0].price.basis, 'party')
    assert.equal(first.offers[0].hotel?.name, 'Hotel 1024')
    assert.equal(first.offers[0].includes.taxes, true)
    assert.equal(first.offers[0].bookingUrl, 'https://hotel.example/book?rate=rate-a')
    const second = await adapter.search({...query, offset: 1}, deps)
    assert.equal(second.offers[0].price.amount, 10000)
    assert.equal(second.offers[0].price.currency, 'RUB')
    assert.equal(second.offers[0].hotel?.name, 'Hotel 2048')
    assert.equal(second.nextOffset, null)
    assert.equal(calls.filter(url => url.endsWith('/auth/token')).length, 1)
    assert.ok(!JSON.stringify(first).includes('fixture-secret'))
})

test('TravelLine missing access and missing granted properties do not send requests', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => {calls++
        throw new Error('Unexpected request')
    }
    const adapter = createTravelLineAdapter()
    const deps: ProviderDeps = {fetch: fetcher, now: () => new Date('2026-11-14T00:00:00Z'), env: {}}
    const access = await adapter.search(query, deps)
    assert.equal(access.status, 'requires-access')
    const configured = {...deps, env: {TRAVELLINE_CLIENT_ID: 'fixture-client', TRAVELLINE_CLIENT_SECRET: 'fixture-secret'}}
    const missing = await adapter.search({...query, providerRefs: undefined}, configured)
    assert.equal(missing.status, 'unsupported-query')
    const rooms = await adapter.search({...query, rooms: 2}, configured)
    assert.equal(rooms.status, 'unsupported-query')
    assert.equal(calls, 0)
})

test('TravelLine verifies geography against one bounded Content response before paginating', async () => {
    let contentRequests = 0
    const fetcher: typeof fetch = async input => {
        const url = String(input)
        if (url.endsWith('/auth/token')) return json({access_token: 'fixture-token', expires_in: 900})
        if (url.includes('/room-stays/search')) return json({roomStays: ['moscow', 'tokyo'].map(propertyId => ({
            propertyId, roomType: {id: 'double'}, ratePlan: {id: 'public'}, currencyCode: 'EUR',
            total: {priceBeforeTax: 200, taxAmount: 20},
        }))})
        contentRequests++
        return json({properties: [
            {id: 'moscow', name: 'Moscow property', contactInfo: {address: {countryCode: 'RUS', cityName: 'Moscow',
                latitude: 55.75, longitude: 37.62}}},
            {id: 'tokyo', name: 'Tokyo property', contactInfo: {address: {countryCode: 'JPN', cityName: 'Tokyo',
                latitude: 35.68, longitude: 139.76}}},
        ]})
    }
    const deps: ProviderDeps = {fetch: fetcher, now: () => new Date('2026-11-14T00:00:00Z'),
        env: {TRAVELLINE_CLIENT_ID: 'fixture-client', TRAVELLINE_CLIENT_SECRET: 'fixture-secret', TRAVELLINE_PROPERTY_IDS: 'moscow,tokyo'}}
    const adapter = createTravelLineAdapter()
    const locationQuery = {...query, providerRefs: undefined, country: 'JP', destination: 'Tokyo', latitude: 35.68, longitude: 139.76, radiusKm: 5}
    const result = await adapter.search(locationQuery, deps)
    assert.equal(result.status, 'live')
    assert.equal(result.total, 1)
    assert.equal(result.offers[0].hotel?.id, 'tokyo')
    assert.equal(result.offers[0].hotel?.name, 'Tokyo property')
    assert.equal(result.nextOffset, null)
    const unavailable = await adapter.search({...locationQuery, country: 'IT'}, deps)
    assert.equal(unavailable.status, 'unsupported-query')
    assert.equal(unavailable.offers.length, 0)
    assert.equal(contentRequests, 1)
})
