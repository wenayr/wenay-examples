import test from 'node:test'
import assert from 'node:assert/strict'
import type {ProviderOffer, ProviderRegistration, ProviderResult} from '../src/provider-contract.ts'
import {createProviderRegistry} from '../backend/providers/index.ts'
import {readProviderQuery} from '../backend/providers/query.ts'

const checkedAt = '2026-11-14T10:00:00Z'
const query = {kind: 'flights', origin: 'DUB', destination: 'STN', departure: '2026-12-15', adults: 2} as const
function offer(id: string, providerId: string): ProviderOffer {
    return {id, providerId, kind: 'flights', title: id, price: {amount: 100, currency: 'EUR', basis: 'party', type: 'retail'},
        accuracy: 'live-offer', sourceUrl: 'https://example.org/search', checkedAt, expiresAt: '2026-11-14T11:00:00Z',
        adults: 2, includes: {checkedBags: 1, taxes: true}, conditions: 'Known', comparisonKey: 'same-flight'}
}
function registration(id: string, result: ProviderResult, loads: string[], requiredEnv: string[] = []): ProviderRegistration {
    return {definition: {id, name: id, website: 'https://example.org', docsUrl: 'https://example.org/docs', kinds: ['flights', 'deals'],
        requiredEnv, activation: 'Use a partner account', queryFields: [], description: 'Fixture'},
        load: async () => {
            loads.push(id)
            return {search: async () => result}
        }}
}

test('provider activation is lazy, isolated and exposes names without token values', async () => {
    const loads: string[] = []
    const secret = 'secret-only-on-server'
    const env: Record<string, string> = {}
    const definitions = {public: registration('public', {providerId: 'public', status: 'live', checkedAt, description: 'Published',
        offers: [offer('a', 'public'), offer('a', 'public')]}, loads),
    partner: registration('partner', {providerId: 'partner', status: 'live', checkedAt, description: 'Partner',
        offers: [offer('b', 'partner')]}, loads, ['TEST_KEY'])}
    const app = createProviderRegistry({fetch, now: () => new Date(checkedAt), env, registrations: definitions})
    assert.deepEqual(loads, [])
    const first = await app.search(query)
    assert.deepEqual(loads, ['public'])
    assert.equal(first.offers.length, 1)
    assert.equal(first.results.find(result => result.providerId == 'partner')?.status, 'requires-access')
    env.TEST_KEY = secret
    const next = await app.search(query)
    assert.deepEqual(loads, ['public', 'partner'])
    assert.equal(next.offers.length, 2)
    assert.equal(next.groups.length, 1)
    assert.ok(!JSON.stringify(app.list()).includes(secret))
    assert.equal(app.list().summary.liveWithPrices, 2)
})

test('sandbox and net prices never qualify as consumer hot deals', async () => {
    const loads: string[] = []
    const sale = {kind: 'supplier-sale' as const, description: 'Official sale', evidenceUrl: 'https://example.org/sale', expiresAt: null}
    const net = {...offer('net', 'net'), price: {amount: 50, currency: 'EUR', basis: 'party' as const, type: 'net' as const}, deal: sale}
    const live = {...offer('retail', 'retail'), deal: sale}
    const definitions = {
        net: registration('net', {providerId: 'net', status: 'live', checkedAt, description: 'Net', offers: [net]}, loads),
        retail: registration('retail', {providerId: 'retail', status: 'live', checkedAt, description: 'Retail', offers: [live]}, loads),
        sandbox: registration('sandbox', {providerId: 'sandbox', status: 'sandbox', environment: 'sandbox', checkedAt,
            description: 'Test only', offers: [{...offer('test', 'sandbox'), deal: sale}]}, loads)
    }
    const app = createProviderRegistry({fetch, now: () => new Date(checkedAt), env: {}, registrations: definitions})
    const result = await app.search({...query, kind: 'deals'})
    assert.deepEqual(result.offers.map(row => row.id), ['retail'])
    assert.equal(result.results.find(source => source.providerId == 'sandbox')?.status, 'sandbox')
})

test('global provider queries validate the date, occupancy and provider mapping independently of local catalog regions', () => {
    const input = {kind: 'hotels', destination: 'Bangkok', checkIn: '2026-12-15', checkOut: '2026-12-22', adults: 3, rooms: 2,
        providerRefs: {xotelo: {hotelIds: ['g297930-d305178']}}, providers: ['xotelo']}
    assert.equal(readProviderQuery(input, '2026-11-14').destination, 'Bangkok')
    assert.throws(() => readProviderQuery({...input, rooms: 4}, '2026-11-14'), RangeError)
    assert.throws(() => readProviderQuery({...input, checkOut: '2026-12-14'}, '2026-11-14'), RangeError)
    assert.throws(() => readProviderQuery({...input, providerRefs: {xotelo: {hotelIds: ['a'.repeat(121)]}}}, '2026-11-14'), RangeError)
})
