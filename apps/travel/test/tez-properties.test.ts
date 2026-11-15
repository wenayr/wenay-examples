import assert from 'node:assert/strict'
import test from 'node:test'
import {createTezProperties} from '../backend/partners/tez-properties.ts'
import type {PackageHotel} from '../src/package-contract.ts'

function hotel(id: number): PackageHotel {
    return {id: 'tez:' + id, name: 'Supplier hotel ' + id, stars: 5,
        latitude: null, longitude: null, url: 'https://www.tez-tour.com/hotel.html?id=' + id}
}

function html(id: number) {
    return '<h1>PROPERTY ' + id + ' <i>5 *</i></h1> HOTEL_ID = ' + id + '; SITE_HOTEL_ID = ' + (id + 1000)
        + '; GEO_LOCATION_LATITUDE = 36.85; GEO_LOCATION_LONGITUDE = 30.80;'
}

function payload(siteId: number) {
    return {success: true, mainSiteGallery: {folder: 'hotel/' + siteId, name: 'Pool.JPG'}, siteGalleries: [
        {folder: 'hotel/' + siteId, name: 'Room 2.jpg'}, {folder: 'hotel/99999', name: 'Unrelated.jpg'},
        {folder: 'hotel/' + siteId, name: '../Escape.jpg'},
    ]}
}

test('lazy property batches advance past the first eight and preserve earlier enrichment and supplier names', async () => {
    let requests = 0
    let active = 0
    let peak = 0
    async function request(input: string | URL | Request) {
        requests++
        active++
        peak = Math.max(peak, active)
        await Promise.resolve()
        const url = new URL(String(input))
        active--
        if (url.pathname == '/hotel.html') return new Response(html(Number(url.searchParams.get('id'))))
        return Response.json(payload(Number(url.searchParams.get('siteHotelId'))))
    }
    const service = createTezProperties({fetch: request as typeof fetch, now: () => new Date('2026-11-15T12:00:00Z')})
    const input = Array.from({length: 12}, (_, id) => hotel(id + 1))
    const first = await service.enrich('antalya', input)
    assert.equal(first.length, 12)
    assert.equal(first.filter(item => item.photo).length, 8)
    assert.equal(requests, 16)
    const second = await service.enrich('antalya', input)
    assert.equal(second.filter(item => item.photo).length, 12)
    assert.equal(requests, 24)
    assert.ok(peak <= 4)
    assert.ok(second.every((item, id) => item.name == input[id].name && item.destinationId == 'antalya'))
    assert.equal(second[0].latitude, 36.85)
    assert.equal(second[0].coordinateSource?.url, input[0].url)
    assert.equal(second[0].photos?.length, 2)
    const gallery = await service.gallery('tez:1')
    assert.equal(requests, 24)
    assert.equal(gallery?.photos[0].sourceImageUrl, 'https://s.tez-tour.com/hotel/1001/Pool_middle.JPG')
    assert.equal(gallery?.photos[1].url, 'https://s.tez-tour.com/hotel/1001/Room%202_middle.jpg')
})

test('one aborted reader does not cancel a shared property lookup or poison the next reader', async () => {
    let release: () => void = () => undefined
    const waiting = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    const upstream: {signal: AbortSignal | null} = {signal: null}
    async function request(input: string | URL | Request, init?: RequestInit) {
        requests++
        upstream.signal = init?.signal ?? null
        const url = new URL(String(input))
        if (url.pathname == '/hotel.html') {
            await waiting
            return new Response(html(1))
        }
        return Response.json(payload(1001))
    }
    const service = createTezProperties({fetch: request as typeof fetch, now: () => new Date('2026-11-15T12:00:00Z')})
    const controller = new AbortController()
    const first = service.enrich('antalya', [hotel(1)], controller.signal)
    const other = service.gallery('tez:1')
    controller.abort(new DOMException('Caller left', 'AbortError'))
    await assert.rejects(first, {name: 'AbortError'})
    assert.equal(upstream.signal?.aborted, false)
    release()
    assert.equal((await other)?.hotelId, 'tez:1')
    assert.equal(requests, 2)
    assert.equal(service.read('tez:1')?.latitude, 36.85)
})

test('wrong hotel identities are negatively cached briefly and do not acquire invented coordinates or photos', async () => {
    let time = Date.parse('2026-11-15T12:00:00Z')
    let requests = 0
    async function request() {
        requests++
        return new Response(html(999))
    }
    const service = createTezProperties({fetch: request as typeof fetch, now: () => new Date(time)})
    const first = await service.enrich('antalya', [hotel(1)])
    assert.equal(first[0].latitude, null)
    assert.equal(first[0].photo, undefined)
    assert.equal(await service.gallery('tez:1'), null)
    assert.equal(requests, 1)
    time += 600_001
    assert.equal(await service.gallery('tez:1'), null)
    assert.equal(requests, 2)
    assert.equal(await service.gallery('tez:0'), null)
    assert.equal(requests, 2)
})

test('different exact hotel identities can share one in-flight supplier gallery URL', async () => {
    let galleries = 0
    async function request(input: string | URL | Request) {
        const url = new URL(String(input))
        if (url.pathname == '/hotel.html') {
            const id = Number(url.searchParams.get('id'))
            return new Response(html(id).replace('SITE_HOTEL_ID = ' + (id + 1000), 'SITE_HOTEL_ID = 1001'))
        }
        galleries++
        await Promise.resolve()
        return Response.json(payload(1001))
    }
    const service = createTezProperties({fetch: request as typeof fetch, now: () => new Date('2026-11-15T12:00:00Z')})
    const result = await service.enrich('antalya', [hotel(1), hotel(2)])
    assert.equal(galleries, 1)
    assert.ok(result.every(item => item.photo?.url == 'https://s.tez-tour.com/hotel/1001/Pool_middle.JPG'))
    assert.notEqual(result[0].photo?.sourceUrl, result[1].photo?.sourceUrl)
})
