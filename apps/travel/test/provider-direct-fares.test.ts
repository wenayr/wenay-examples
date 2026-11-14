import test from 'node:test'
import assert from 'node:assert/strict'
import {directFareAdapter, readDirectFares} from '../backend/providers/regional/direct-fares.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

const query: ProviderQuery = {kind: 'flights', origin: 'ICN', destination: 'NRT', departure: '2026-12-19', returnDate: '2026-12-22', adults: 2}
const deps: ProviderDeps = {env: {}, now: () => new Date('2026-11-14T10:00:00Z'), fetch: async () => {throw new Error('Unexpected network')}}
const source = 'https://www.koreanair.com/flights/en/flights-from-seoul-to-tokyo'
const validFare = {__typename: 'Fare', originAirportCode: 'ICN', destinationAirportCode: 'NRT', flightType: 'ROUND_TRIP',
    departureDate: '2026-12-19', returnDate: '2026-12-22', currencyCode: 'KRW', totalPrice: 378400, travelClass: 'ECONOMY'}

function page(tenant: string, fares: unknown[]) {
    const data = {props: {pageProps: {tenant, apolloState: {data: {ROOT_QUERY: {fares}}}}}}
    return '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + '</script>'
}

test('Direct airline fares match exact airports and both dates, retain per-person price and reject unrelated or stale fare objects', () => {
    const html = page('ke', [validFare, validFare,
        {...validFare, destinationAirportCode: 'HND'}, {...validFare, departureDate: '2026-12-20'},
        {...validFare, returnDate: '2026-12-23'}, {...validFare, departureDate: '2026-10-01'},
        {...validFare, currencyCode: 'points'}, {__typename: 'AggregateOffer', lowPrice: 1, currencyCode: 'KRW'}])
    const result = readDirectFares('direct-korean', html, query, deps, source)
    assert.equal(result.offers.length, 1)
    assert.deepEqual(result.offers[0].price, {amount: 378400, currency: 'KRW', basis: 'person', type: 'retail'})
    assert.equal(result.offers[0].adults, 1)
    assert.equal(result.offers[0].accuracy, 'published-from')
    assert.equal(result.offers[0].includes.checkedBags, null)
    assert.equal(result.offers[0].comparisonKey, null)
    assert.equal(readDirectFares('direct-korean', html, {...query, returnDate: null}, deps, source).offers.length, 0)
    assert.throws(() => readDirectFares('direct-korean', page('other-airline', [validFare]), query, deps, source))
    const highValueFare = {...validFare, currencyCode: 'VND', totalPrice: 120_000_000}
    const mixed = readDirectFares('direct-korean', page('ke', [highValueFare, {...validFare, currencyCode: 'PTS'}]), query, deps, source)
    assert.equal(mixed.offers.length, 1)
    assert.equal(mixed.offers[0].price.amount, 120_000_000)
})

test('Direct discovery keeps each actual future departure date and uses only its own airline site', async () => {
    let fetched = ''
    const adapter = directFareAdapter('direct-korean')
    const result = await adapter.search({...query, departure: undefined, returnDate: undefined}, {...deps,
        fetch: async (url, options) => {
            fetched = String(url)
            assert.equal(new URL(fetched).origin, 'https://www.koreanair.com')
            assert.equal(options?.redirect, 'error')
            return new Response(page('ke', [validFare, {...validFare, departureDate: '2027-01-10', returnDate: '2027-01-13'}]))
        }})
    assert.match(fetched, /flights-from-seoul-to-tokyo$/)
    assert.deepEqual(result.offers.map(offer => offer.departure).sort(), ['2026-12-19', '2027-01-10'])
    assert.equal((await adapter.search({...query, origin: 'invalid-host'}, deps)).status, 'unsupported-query')
})
