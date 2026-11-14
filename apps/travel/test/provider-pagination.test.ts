import test from 'node:test'
import assert from 'node:assert/strict'
import {search as xoteloSearch} from '../backend/providers/stays/xotelo.ts'
import {search as ratehawkSearch} from '../backend/providers/stays/ratehawk.ts'
import {readProviderQuery} from '../backend/providers/query.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

test('Xotelo pages the remote catalog and bounds concurrent rate requests without truncating the continuation', async () => {
    let active = 0
    let peak = 0
    const offsets: string[] = []
    const query: ProviderQuery = {kind: 'hotels', checkIn: '2026-12-15', checkOut: '2026-12-22', adults: 2,
        rooms: 1, currency: 'EUR', offset: 10, limit: 10, providerRefs: {xotelo: {destinationId: 'g123'}}}
    const deps: ProviderDeps = {now: () => new Date('2026-11-14T10:00:00Z'), env: {}, fetch: async raw => {
        const url = new URL(String(raw))
        if (url.pathname.endsWith('/list')) {
            const offset = Number(url.searchParams.get('offset'))
            const limit = Number(url.searchParams.get('limit'))
            offsets.push(String(offset))
            return Response.json({error: null, result: {total_count: 25, offset, limit,
                list: Array.from({length: Math.min(limit, 25 - offset)}, (_, index) => ({
                    key: 'g123-d' + (offset + index + 1), name: 'Hotel ' + (offset + index + 1)
                }))}})
        }
        active++
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return Response.json({error: null, result: {chk_in: query.checkIn, chk_out: query.checkOut, currency: 'EUR',
            rates: [{code: 'seller', name: 'Seller', rate: 100}]}})
    }}
    const first = await xoteloSearch(query, deps)
    assert.equal(first.offers.length, 10)
    assert.equal(first.total, 25)
    assert.equal(first.nextOffset, 20)
    assert.equal(first.partial, true)
    assert.equal(first.status, 'cached')
    const next = await xoteloSearch({...query, offset: first.nextOffset!}, deps)
    assert.equal(next.offers.length, 5)
    assert.equal(next.nextOffset, null)
    assert.equal(next.partial, false)
    assert.deepEqual(offsets, ['10', '20'])
    assert.ok(peak <= 4)
    assert.notEqual(first.offers[0].hotel?.id, next.offers[0].hotel?.id)
})

test('a large world-map radius stays valid globally while ETG applies its own documented 70 km limit', async () => {
    const query = readProviderQuery({kind: 'hotels', latitude: 13.75, longitude: 100.5, radiusKm: 5000,
        checkIn: '2026-12-15', checkOut: '2026-12-22', adults: 2, nationality: 'EE'}, '2026-11-14')
    assert.equal(query.radiusKm, 5000)
    let requests = 0
    const result = await ratehawkSearch(query, {now: () => new Date(), env: {RATEHAWK_KEY_ID: 'fixture', RATEHAWK_API_KEY: 'fixture'},
        fetch: async () => {
            requests++
            throw new Error('Unsupported ETG radius must not be sent')
        }})
    assert.equal(result.status, 'unsupported-query')
    assert.match(result.description, /70/)
    assert.equal(requests, 0)
})
