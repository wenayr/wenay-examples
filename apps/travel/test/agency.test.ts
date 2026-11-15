import assert from 'node:assert/strict'
import test from 'node:test'
import {createAgencies, type AgencyBucket} from '../backend/agency.ts'
import {createTravelWorker} from '../backend/worker.ts'
import {initialAgencySettings} from '../src/agency-contract.ts'

function createBucket() {
    const entries = new Map<string, {value: string, etag: string}>()
    let version = 0
    const bucket = {
        async get(key: string) {
            const entry = entries.get(key)
            return entry ? {etag: entry.etag, text: async () => entry.value} : null
        },
        async put(key: string, value: string, options: {onlyIf: Headers}) {
            const current = entries.get(key)
            const expected = options.onlyIf.get('if-match')?.replace(/^"|"$/g, '')
            if (options.onlyIf.get('if-none-match') == '*' && current) return null
            if (expected && expected != current?.etag) return null
            const etag = String(++version)
            entries.set(key, {value, etag})
            return {etag}
        },
    } satisfies AgencyBucket
    return {bucket, entries}
}

function settings(slug = 'sea-and-sun') {
    return {...initialAgencySettings(), name: 'Море и солнце', slug, contact: {email: 'office@example.com', phone: '+372 555 123', website: ''}}
}
function request(path: string, owner: string | null = 'alice', method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
    const headers = new Headers(extra)
    if (owner) headers.set('oai-authenticated-user-id', owner)
    if (body != null) headers.set('content-type', 'application/json')
    return new Request('https://travel.example/api/travel/' + path, {
        method, headers, body: body == null ? undefined : JSON.stringify(body),
    })
}

test('agency settings and leads survive a new Worker and are isolated by trusted owner identity', async () => {
    const {bucket, entries} = createBucket()
    let worker = createTravelWorker()
    const env = {BUCKET: bucket}
    const created = await worker.fetch(request('agency', 'alice', 'POST', {...settings(), owner: 'bob'}), env)
    assert.equal(created.status, 201)
    const profile = (await created.json()).agency
    const added = await worker.fetch(request('agency/leads', 'alice', 'POST', {name: 'Ирина', contact: 'client@example.com', message: 'Море в январе'}), env)
    assert.equal(added.status, 201)
    const lead = (await added.json()).lead
    worker = createTravelWorker()
    const restored = await (await worker.fetch(request('agency'), env)).json()
    assert.equal(restored.agency.id, profile.id)
    assert.equal(restored.leads[0].id, lead.id)
    const bob = await (await worker.fetch(request('agency', 'bob'), env)).json()
    assert.equal(bob.agency, null)
    assert.deepEqual(bob.leads, [])
    const foreign = await worker.fetch(request('agency/leads/' + lead.id, 'bob', 'PATCH', {revision: 1, status: 'closed'}), env)
    assert.equal(foreign.status, 404)
    const anonymous = await worker.fetch(request('agency/leads', null), env)
    assert.equal(anonymous.status, 401)
    assert.equal([...entries.keys()].some(key => key.includes('alice')), false)
    assert.equal('owner' in restored.agency, false)
})

test('conditional revisions reject simultaneous saves and slug creation without overwriting another tenant', async () => {
    const {bucket} = createBucket()
    const worker = createTravelWorker()
    const env = {BUCKET: bucket}
    const results = await Promise.all([
        worker.fetch(request('agency', 'alice', 'POST', settings('unique-trip')), env),
        worker.fetch(request('agency', 'bob', 'POST', settings('unique-trip')), env),
    ])
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409])
    const owner = results[0].status == 201 ? 'alice' : 'bob'
    const save = {...settings('unique-trip'), revision: 1}
    const saves = await Promise.all([
        worker.fetch(request('agency', owner, 'PUT', {...save, name: 'Первый'}), env),
        worker.fetch(request('agency', owner, 'PUT', {...save, name: 'Второй'}), env),
    ])
    assert.deepEqual(saves.map(result => result.status).sort(), [200, 409])
    const stale = await worker.fetch(request('agency', owner, 'PUT', save), env)
    assert.equal(stale.status, 409)
    const renamed = await worker.fetch(request('agency', owner, 'PUT', {...save, revision: 2, slug: 'another-slug'}), env)
    assert.equal(renamed.status, 400)
})

test('storefront exposes only business fields and routes a customer request to the selected agency', async () => {
    const {bucket} = createBucket()
    const worker = createTravelWorker()
    const env = {BUCKET: bucket}
    await worker.fetch(request('agency', 'alice', 'POST', settings('alice-trip')), env)
    await worker.fetch(request('agency', 'bob', 'POST', settings('bob-trip')), env)
    const storefront = await (await worker.fetch(request('storefront/bob-trip', null), env)).json()
    assert.equal(storefront.agency.slug, 'bob-trip')
    for (const hidden of ['id', 'owner', 'reviewProperties', 'leads', 'createdAt']) assert.equal(hidden in storefront.agency, false)
    const sent = await worker.fetch(request('storefront/bob-trip/leads', null, 'POST', {
        name: 'Анна', contact: 'anna@example.com', message: 'Отель с пляжем', owner: 'alice',
    }), env)
    assert.equal(sent.status, 201)
    const receipt = await sent.json()
    assert.deepEqual(Object.keys(receipt).sort(), ['accepted', 'reference'])
    const bob = await (await worker.fetch(request('agency', 'bob'), env)).json()
    const alice = await (await worker.fetch(request('agency', 'alice'), env)).json()
    assert.equal(bob.leads[0].name, 'Анна')
    assert.equal(alice.leads.length, 0)
    assert.equal((await worker.fetch(request('storefront/bob-trip/leads', null), env)).status, 405)
    assert.equal((await worker.fetch(request('storefront/missing-trip', null), env)).status, 404)
})

test('cross-origin, unsafe settings and large payloads fail before any persistent write', async () => {
    const {bucket, entries} = createBucket()
    const worker = createTravelWorker()
    const env = {BUCKET: bucket}
    assert.equal((await worker.fetch(request('agency', 'alice', 'POST', settings(), {origin: 'https://attacker.example'}), env)).status, 403)
    assert.equal((await worker.fetch(request('agency', 'alice', 'POST', {...settings(), brandColor: 'red;background:url(x)'}), env)).status, 400)
    const mapping = {hotelId: 'tez:1061', propertyId: '1234', sourceUrl: 'https://expedia.com.evil.example/test.h1234.Hotel-Information'}
    assert.equal((await worker.fetch(request('agency', 'alice', 'POST', {...settings(), reviewProperties: [mapping]}), env)).status, 400)
    assert.equal((await worker.fetch(request('agency', 'alice', 'POST', {...settings(), tagline: 'x'.repeat(20_000)}), env)).status, 413)
    assert.equal(entries.size, 0)
    assert.equal((await worker.fetch(request('agency', null, 'POST', settings()), env)).status, 401)
})

test('source and destination policies apply to server requests, including the tenant query and disabled reviews', async () => {
    const {bucket} = createBucket()
    const worker = createTravelWorker()
    const env = {BUCKET: bucket}
    await worker.fetch(request('agency', 'alice', 'POST', {...settings('quiet-travel'), sources: [], destinations: ['sharm'], showReviews: false}), env)
    const destinations = await (await worker.fetch(request('destinations?agency=quiet-travel', null), env)).json()
    assert.deepEqual(destinations.destinations.map((item: {id: string}) => item.id), ['sharm'])
    assert.equal((await worker.fetch(request('packages?agency=quiet-travel', null), env)).status, 403)
    assert.equal((await worker.fetch(request('package-map-hotels?agency=quiet-travel', null), env)).status, 403)
    await worker.fetch(request('agency', 'bob', 'POST', {...settings('sharm-travel'), destinations: ['sharm']}), env)
    const scoped = 'package-map-hotels?agency=sharm-travel'
    const outside = await (await worker.fetch(request(scoped + '&west=33.7&south=27&east=33.9&north=27.4', null), env)).json()
    assert.equal(outside.area.coverage, 'unsupported')
    assert.deepEqual(outside.knownHotels, [])
    const allowed = await (await worker.fetch(request(scoped + '&destination=sharm', null), env)).json()
    assert.ok(allowed.knownHotels.length > 0)
    assert.ok(allowed.knownHotels.every((hotel: {destinationId: string}) => hotel.destinationId == 'sharm'))
    const reviews = await (await worker.fetch(request('hotel-reviews?hotelId=tez:1061&agency=quiet-travel', null), env)).json()
    assert.equal(reviews.status, 'disabled')
    assert.deepEqual(reviews.externalReferences, [])
    assert.equal((await worker.fetch(request('packages?agency=missing-trip', null), env)).status, 404)
})

test('failed final profile write keeps a private reservation and an owner retry recovers the same agency identity', async () => {
    const storage = createBucket()
    let fail = true
    const bucket: AgencyBucket = {...storage.bucket, async put(key, value, options) {
        if (fail && key.includes('/owners/')) throw new Error('Controlled interrupted save')
        return storage.bucket.put(key, value, options)
    }}
    const service = createAgencies({bucket, id: () => 'stable-agency-id'})
    await assert.rejects(service.control.create('alice', settings('recover-trip')))
    await assert.rejects(service.view.storefront('recover-trip'), /ещё не создано/)
    fail = false
    const recovered = await service.control.create('alice', settings('recover-trip'))
    assert.equal(recovered.agency?.id, 'stable-agency-id')
    assert.equal((await service.view.storefront('recover-trip')).name, settings().name)
})
