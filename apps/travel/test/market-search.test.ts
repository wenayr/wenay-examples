import test from 'node:test'
import assert from 'node:assert/strict'
import {createProviderRegistry, providerRegistrations} from '../backend/providers/index.ts'
import {createFlights} from '../backend/flights/index.ts'
import {queryMarkets, travelRestriction} from '../backend/markets/policy.ts'
import type {ProviderQuery, ProviderRegistration} from '../src/provider-contract.ts'

const now = new Date('2026-11-14T10:00:00Z')
const flight: ProviderQuery = {kind: 'flights', origin: 'NRT', destination: 'ICN', departure: '2026-12-19', adults: 3, currency: 'EUR'}

function fixtureRegistry() {
    let calls = 0
    const registration: ProviderRegistration = {
        definition: {id: 'fixture', name: 'Fixture', website: 'https://example.org', docsUrl: 'https://example.org/docs',
            description: 'Controlled response', requiredEnv: [], access: 'public', activation: '', queryFields: [],
            kinds: ['flights', 'hotels', 'packages', 'deals']},
        load: async () => ({search: async query => {
            calls++
            return {providerId: 'fixture', status: 'live', checkedAt: now.toISOString(), description: 'Controlled response', offers: [{
                id: 'fixture:published', providerId: 'fixture', kind: query.kind, title: 'Published fare',
                price: {amount: 378400, currency: 'KRW', basis: 'person', type: 'retail'}, accuracy: 'published-from',
                sourceUrl: 'https://example.org/fare', checkedAt: now.toISOString(), expiresAt: null,
                adults: 1, includes: {checkedBags: null, taxes: null}, conditions: 'Unknown group availability', comparisonKey: null,
            }]}
        }}),
    }
    const registry = createProviderRegistry({fetch, now: () => now, env: {}, registrations: {fixture: registration}})
    return {registry, calls: () => calls}
}

test('market catalog counts canonical companies and separates configured access from verified requests', async () => {
    const {registry} = fixtureRegistry()
    const before = registry.markets()
    assert.equal(before.items.length, 20)
    assert.equal(before.summary.airlines, 62)
    assert.equal(before.summary.tourismPartners, 58)
    for (const country of before.items) {
        assert.ok(country.airlines.length >= 3)
        assert.ok(country.tourism.length >= 3)
        assert.equal(country.providers[0].coverage, 'request-check')
        for (const company of [...country.airlines, ...country.tourism]) {
            for (const id of company.providerIds ?? []) assert.ok(id in providerRegistrations, id)
        }
    }
    await registry.search(flight)
    const japan = registry.markets('JP').items[0]
    const korea = registry.markets('KR').items[0]
    assert.equal(japan.providers[0].coverage, 'query-verified')
    assert.equal(korea.providers[0].coverage, 'query-verified')
    assert.match(japan.providers[0].coverageDescription, /за человека/)
    assert.equal(registry.markets('FR').items[0].providers[0].coverage, 'request-check')
})

test('actual Ukrainian airport endpoints stop flight-bearing searches before any supplier call', async () => {
    const {registry, calls} = fixtureRegistry()
    const queries: ProviderQuery[] = [
        {...flight, origin: 'KBP'}, {...flight, destination: 'LWO'},
        {kind: 'packages', origin: 'KBP', destination: 'Japan', adults: 2},
        {kind: 'deals', origin: 'KBP', adults: 2},
    ]
    for (const query of queries) {
        const result = await registry.search(query)
        assert.equal(result.offers.length, 0)
        assert.equal(result.notices?.[0].kind, 'airspace')
        assert.equal(result.results[0].status, 'unsupported-query')
    }
    assert.equal(calls(), 0)
    const hotels = await registry.search({kind: 'hotels', origin: 'KBP', destination: 'Kyiv', country: 'UA', adults: 2})
    assert.equal(hotels.offers.length, 1)
    assert.equal(calls(), 1)
    const legacy = createFlights({fetch: async () => {throw new Error('Must not fetch')}, now: () => now})
    const result = await legacy.search({origin: 'KBP', destination: 'NRT', departure: '2026-12-19', returnDate: null, adults: 2, checkedBag: false})
    assert.equal(result.sources[0].id, 'route-review')
})

test('Estonian tourism-in-Russia review is destination-specific and never a nationality or global-country whitelist', async () => {
    const {registry, calls} = fixtureRegistry()
    const incoming = await registry.search({...flight, origin: 'TAS', destination: 'SVO'})
    assert.equal(incoming.notices?.[0].kind, 'commercial')
    assert.equal(calls(), 0)
    const outgoing = await registry.search({...flight, origin: 'SVO', destination: 'TAS', nationality: 'RU', bookerCountry: 'EE'})
    assert.equal(outgoing.offers.length, 1)
    assert.deepEqual(queryMarkets(outgoing.query), {origin: 'RU', destination: 'UZ'})
    const outside = await registry.search({...flight, origin: 'JFK', destination: 'MEX'})
    assert.equal(outside.offers.length, 1)
    assert.equal(calls(), 2)
    assert.equal(travelRestriction({kind: 'hotels', destination: 'Moscow', country: 'JP', adults: 2})?.kind, 'commercial')
    assert.equal(travelRestriction({kind: 'hotels', destination: 'Tokyo', nationality: 'RU', adults: 2}), null)
})
