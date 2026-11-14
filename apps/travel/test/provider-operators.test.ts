import assert from 'node:assert/strict'
import test from 'node:test'
import {adapter as joinup, readJoinupOffers} from '../backend/providers/operators/joinup.ts'
import {readItakaOffers} from '../backend/providers/operators/itaka.ts'
import type {ProviderDeps, ProviderQuery} from '../src/provider-contract.ts'

const deps = {fetch, now: () => new Date('2026-11-14T01:00:00Z'), env: {}} satisfies ProviderDeps
const query = {kind: 'deals', adults: 2, currency: 'EUR'} satisfies ProviderQuery

function nuxtPage(value: unknown) {
    const table: unknown[] = []
    function encode(current: unknown): number {
        const index = table.length
        table.push(null)
        if (Array.isArray(current)) table[index] = current.map(encode)
        else if (current && typeof current == 'object') {
            table[index] = Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, encode(entry)]))
        } else table[index] = current
        return index
    }
    encode({'last-minute-en': value})
    return '<script id="__NUXT_DATA__" type="application/json">' + JSON.stringify(table) + '</script>'
}

test('Join UP public feed preserves the two-person total and does not invent hotel or return dates', async () => {
    const html = nuxtPage({cms: {content: [{formattedContent: '<h2>Last Minute Holidays from Tallinn</h2>'}]}, countries: [{
        country: {name: 'Egypt', id: 'c_9', slug: 'egypt', code_iso: 'EG'},
        search_params: {origins: ['2552'], pax_adl: [2]}, tours: [{
            id: '37394', name: 'El Karma Aqua Beach Resort', date: '2026-11-24', stay: 7,
            origin_id: '2552', destination_id: 'c_9', total_price: {price: '1331.00', currency: {code: 'EUR'}},
            city_name: 'Hurghada', country_name: 'Egypt', category: {category: '4'},
        }],
    }]})
    const offers = readJoinupOffers(html, {...query, origin: 'TLL', destination: 'HRG', departure: '2026-11-24'}, deps)
    assert.equal(offers.length, 1)
    assert.deepEqual(offers[0].price, {amount: 1331, currency: 'EUR', basis: 'party', type: 'retail'})
    assert.equal(offers[0].deal?.kind, 'supplier-sale')
    assert.equal(Object.hasOwn(offers[0], 'returnDate'), false)
    assert.equal(Object.hasOwn(offers[0], 'checkIn'), false)
    assert.equal(offers[0].expiresAt, null)
    assert.equal(offers[0].origin, 'TLL')
    assert.equal(offers[0].nights, 7)
    assert.deepEqual(readJoinupOffers(html, {...query, adults: 1}, deps), [])
    assert.deepEqual(readJoinupOffers(html, {...query, origin: 'RIX'}, deps), [])
    assert.deepEqual(readJoinupOffers(html, {...query, departure: '2026-11-25'}, deps), [])
    assert.deepEqual(readJoinupOffers(html, {...query, nights: 8}, deps), [])
    const unsupported = await joinup.search({...query, returnDate: '2026-12-01'}, deps)
    assert.equal(unsupported.status, 'unsupported-query')
    let requests = 0
    let clock = deps.now()
    const resource: ProviderDeps = {...deps, now: () => clock, fetch: async () => {
        requests++
        return new Response(html)
    }}
    const first = await joinup.search(query, resource)
    clock = new Date(clock.getTime() + 2_000)
    const second = await joinup.search({...query, destination: 'Egypt'}, resource)
    assert.equal(requests, 1)
    assert.equal(second.status, 'cached')
    assert.equal(second.checkedAt, first.checkedAt)
    assert.equal(second.offers[0].checkedAt, first.offers[0].checkedAt)
})

function itakaPage(promoted: boolean, count = 2) {
    const rate = {id: 'published-rate', supplierObjectId: 'AEGHRG', priceWithSurcharges: 100000, currency: 'EUR',
        participants: Array.from({length: count}, () => ({type: 'adult', priceWithSurcharges: 50000})),
        promotions: promoted ? [{value: 'LastMinute'}] : [], segments: [
            {type: 'flight', beginDateTime: '2026-11-24T04:00:00+02:00', departure: {title: 'Tallinn'}, destination: {title: 'Hurghada'}},
            {type: 'hotel', beginDate: '2026-11-24', endDate: '2026-12-01', meal: {title: 'All inclusive'},
                content: {title: 'Published Hotel', hotelRating: 40, geographicalIdentifiers: [{id: 'egiptus', title: 'Egiptus', type: 'country'}]}},
            {type: 'flight', beginDateTime: '2026-12-01T21:00:00+02:00', departure: {title: 'Hurghada'}, destination: {title: 'Tallinn'}},
        ]}
    const page = {props: {pageProps: {queryVariables: {rateParams: {adultsNumber: 2, currency: 'EUR'}},
        initialQueryState: {queries: [{state: {data: {main: {rates: {list: [rate]}}}}}]}}}}
    return '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(page) + '</script>'
}

test('ITAKA matches actual party, flights and promotional rate before publishing a hot deal', () => {
    const selected = {...query, origin: 'TLL', destination: 'EG', departure: '2026-11-24', returnDate: '2026-12-01'}
    const offers = readItakaOffers(itakaPage(true), selected, deps)
    assert.equal(offers.length, 1)
    assert.equal(offers[0].price.amount, 1000)
    assert.equal(offers[0].checkOut, '2026-12-01')
    assert.equal(offers[0].origin, 'TLL')
    assert.equal(offers[0].nights, 7)
    assert.equal(offers[0].includes.checkedBags, null)
    assert.equal(offers[0].accuracy, 'published-from')
    assert.deepEqual(readItakaOffers(itakaPage(false), selected, deps), [])
    assert.deepEqual(readItakaOffers(itakaPage(true, 3), selected, deps), [])
    assert.deepEqual(readItakaOffers(itakaPage(true), {...selected, origin: 'RIX'}, deps), [])
    assert.deepEqual(readItakaOffers(itakaPage(true), {...selected, returnDate: '2026-12-02'}, deps), [])
    assert.deepEqual(readItakaOffers(itakaPage(true), {...selected, nights: 6}, deps), [])
})
