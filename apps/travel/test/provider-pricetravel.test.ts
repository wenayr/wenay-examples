import test from 'node:test'
import assert from 'node:assert/strict'
import {search} from '../backend/providers/stays/pricetravel.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

test('PriceTravel sends actual occupancy, reuses OAuth and distinguishes public from agency net prices', async () => {
    const calls: string[] = []
    const query: ProviderQuery = {kind: 'hotels', checkIn: '2026-12-15', checkOut: '2026-12-22', adults: 2, rooms: 1, adultAges: [30, 35],
        bookerCountry: 'EE', providerRefs: {pricetravel: {hotelIds: ['231160']}}}
    const deps: ProviderDeps = {now: () => new Date('2026-11-14T10:00:00Z'),
        env: {PRICETRAVEL_CLIENT_ID: 'fixture-partner', PRICETRAVEL_CLIENT_SECRET: 'server-only-secret'},
        fetch: async (url, options) => {
            calls.push(String(url))
            if (String(url).endsWith('/connect/token')) {
                assert.equal(new URLSearchParams(String(options?.body)).get('scopes'), 'admin_api')
                return Response.json({access_token: 'fixture-bearer', expires_in: 3600})
            }
            assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer fixture-bearer')
            const body = JSON.parse(String(options?.body))
            assert.deepEqual(body.roomCriteria, [{paxes: [{age: 30}, {age: 35}]}])
            assert.deepEqual(body.hotelIds, [231160])
            assert.equal(body.market, 'EE')
            return Response.json({hotels: [{id: 231160, name: 'Hotel Hacienda Cancun', rooms: [{id: 1, name: 'Double', rates: [
                {rateKey: 'retail-key', clientCurrency: 'USD', amount: 108.78, publicAmount: 135.98,
                    reservationPolicies: [{type: 'MEAL_PLAN', description: 'Room Only'}], feesNotIncluded: {total: 10}},
                {rateKey: 'net-key', clientCurrency: 'USD', amount: 108.78, publicAmount: 0,
                    reservationPolicies: [], feesNotIncluded: {total: 0}}
            ]}]}]})
        }}
    const first = await search(query, deps)
    assert.equal(first.offers[0].price.amount, 135.98)
    assert.equal(first.offers[0].price.type, 'retail')
    assert.equal(first.offers[0].includes.taxes, false)
    assert.equal(first.offers[1].price.type, 'net')
    assert.equal(first.offers[1].price.currency, 'USD')
    await search(query, deps)
    assert.equal(calls.filter(url => url.endsWith('/connect/token')).length, 1)
    assert.equal(calls.filter(url => url.includes('/hotels/rates')).length, 2)
    assert.equal((await search({...query, rooms: 2}, deps)).status, 'unsupported-query')
})
