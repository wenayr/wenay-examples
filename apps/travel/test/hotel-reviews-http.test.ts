import assert from 'node:assert/strict'
import test from 'node:test'
import {createHotelReviewsHttp} from '../backend/hotel-reviews-http.ts'
import {validReviewProperty} from '../src/hotel-reviews-contract.ts'

const mapping = {hotelId: 'tez:1061', propertyId: '123', sourceUrl: 'https://www.expedia.com/Sand-Beach.h123.Hotel-Information'}
const another = {...mapping, hotelId: 'tez:511', propertyId: '456', sourceUrl: 'https://www.expedia.com/Desert-Rose.h456.Hotel-Information'}
const settings = {showReviews: true, reviewProperties: [mapping]}
const request = (id = mapping.hotelId) => new Request('https://travel.example/api/travel/hotel-reviews?hotelId=' + id)
function source(propertyId: string, sourceUrl: string, retrievedAt: string) {
    return {provider: 'expedia-rapid' as const, propertyId, sourceUrl, retrievedAt, partial: true as const,
        order: 'source-recent' as const, summary: null, reviews: [{id: 'fixture:negative', author: 'Fixture guest',
            publishedAt: '2030-01-01T12:00:00Z', travelDate: undefined, rating: 1, maxRating: 5 as const,
            title: 'Fixture title', text: 'Fixture negative text', sourceUrl, verifiedStay: null}]}
}
async function body(response: Response | null) {
    assert.ok(response)
    return response.json()
}

test('review states remain honest before credentials and exact property mapping exist', async () => {
    const http = createHotelReviewsHttp({resolveSettings: async () => settings})
    const unconfigured = await body(await http.handle(request()))
    assert.equal(unconfigured.status, 'not-configured')
    assert.equal(unconfigured.summary, null)
    assert.deepEqual(unconfigured.reviews, [])
    const referenced = await body(await http.handle(request('tez:10591207')))
    assert.equal(referenced.externalReferences[0].name, 'Tripadvisor')
    assert.match(referenced.externalReferences[0].url, /d6164318-Reviews/)
    assert.equal(await http.handle(new Request('https://travel.example/not-reviews')), null)
    assert.equal((await http.handle(request('arbitrary')))!.status, 400)
    const disabled = createHotelReviewsHttp({resolveSettings: async () => ({...settings, showReviews: false})})
    const hidden = await body(await disabled.handle(request('tez:10591207')))
    assert.equal(hidden.status, 'disabled')
    assert.deepEqual(hidden.externalReferences, [])
})

test('source results keep their date, negative reviews and property identity through fresh and stale cache', async () => {
    let calls = 0
    let fail = false
    let time = Date.parse('2030-01-02T12:00:00Z')
    const http = createHotelReviewsHttp({resolveSettings: async () => settings, now: () => new Date(time), provider: {
        async read({propertyId, sourceUrl}) {
            calls++
            if (fail) throw new Error('Fixture source unavailable')
            return source(propertyId, sourceUrl, new Date(time).toISOString())
        },
    }})
    const first = await body(await http.handle(request()))
    assert.equal(first.status, 'ready')
    assert.equal(first.reviews[0].rating, 1)
    assert.equal(first.summary, null)
    assert.equal(first.source.url, mapping.sourceUrl)
    const checkedAt = first.source.retrievedAt
    await body(await http.handle(request()))
    assert.equal(calls, 1)
    fail = true
    time += 31 * 60_000
    const stale = await body(await http.handle(request()))
    assert.equal(stale.source.stale, true)
    assert.equal(stale.source.retrievedAt, checkedAt)
    assert.equal(stale.reviews[0].rating, 1)
    time += 49 * 60 * 60_000
    const expired = await body(await http.handle(request()))
    assert.equal(expired.status, 'unavailable')
    assert.equal(expired.source.retrievedAt, null)
    assert.deepEqual(expired.reviews, [])
})

test('per-request settings cannot expose another agency mapping or accept a mismatching property response', async () => {
    let calls = 0
    const http = createHotelReviewsHttp({resolveSettings: async request => request.headers.get('fixture-owner') == 'other'
        ? {...settings, reviewProperties: [another]} : settings,
    provider: {async read() {
        calls++
        return source(another.propertyId, another.sourceUrl, '2030-01-02T12:00:00Z')
    }}})
    assert.equal((await body(await http.handle(request()))).status, 'unavailable')
    const other = new Request(request(), {headers: {'fixture-owner': 'other'}})
    assert.equal((await body(await http.handle(other))).status, 'not-mapped')
    assert.equal(calls, 1)
    assert.equal(validReviewProperty(mapping), true)
    assert.equal(validReviewProperty({...mapping, sourceUrl: 'https://attacker.example/Sand.h123.Hotel-Information'}), false)
    assert.equal(validReviewProperty({...mapping, propertyId: another.propertyId}), false)
})

test('simultaneous views share a single supplier read, while each request keeps its own cancellation', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const http = createHotelReviewsHttp({resolveSettings: async () => settings, provider: {async read({propertyId, sourceUrl}) {
        calls++
        await gate
        return source(propertyId, sourceUrl, '2030-01-02T12:00:00Z')
    }}})
    const controller = new AbortController()
    const first = http.handle(new Request(request(), {signal: controller.signal}))
    const second = http.handle(request())
    controller.abort()
    release()
    assert.equal((await first)!.status, 499)
    assert.equal((await body(await second)).status, 'ready')
    assert.equal(calls, 1)
})
