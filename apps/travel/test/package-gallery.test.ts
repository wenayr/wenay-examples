import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createServer} from 'node:http'
import type {AddressInfo} from 'node:net'
import test from 'node:test'
import {createPlaceCatalog} from '../backend/catalog.ts'
import {createSupplyMiddleware} from '../backend/middleware.ts'
import {createPackages} from '../backend/packages.ts'
import type {PackageHotelGallery} from '../src/package-media-contract.ts'

test('галерея отдаёт точные ссылки своего отеля без направления, дат и ценовых запросов', async t => {
    let priceRequests = 0
    async function priceRequest(): Promise<never> {
        priceRequests++
        throw new Error('Галерея не должна запрашивать цены')
    }
    const catalog = createPlaceCatalog({
        destinations: [], sources: [], photo: () => null,
        readSnapshot: () => ({records: [], fetchedAt: null}),
    })
    const middleware = createSupplyMiddleware({
        catalog, packages: createPackages({window: priceRequest, day: priceRequest}),
        partners: async () => ({offers: [], links: [], sources: []}),
    })
    const server = createServer((request, response) => void middleware(request, response, () => response.writeHead(404).end()))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => {
        catalog.shutdown()
        server.closeAllConnections()
        return new Promise<void>(done => server.close(() => done()))
    })
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/travel/package-gallery'
    const response = await fetch(base + '?hotelId=tez:1061&first=invalid&destination=absent')
    assert.equal(response.status, 200)
    const gallery: PackageHotelGallery = await response.json()
    assert.equal(gallery.hotelId, 'tez:1061')
    assert.equal(gallery.hotelUrl, 'https://www.tez-tour.com/hotel.html?id=1061')
    assert.equal(gallery.checkedOn, '2026-11-14')
    assert.equal(gallery.photos.length, 5)
    assert.equal(new Set(gallery.photos.map(photo => photo.url)).size, 5)
    assert.ok(gallery.photos.every(photo => photo.url.startsWith('https://s.tez-tour.com/hotel/1491/')))
    assert.ok(gallery.photos.every(photo => photo.sourceImageUrl == photo.url && photo.sourceUrl == gallery.hotelUrl))
    const other: PackageHotelGallery = await (await fetch(base + '?hotelId=tez:511')).json()
    assert.ok(other.photos.every(photo => photo.url.startsWith('https://s.tez-tour.com/hotel/2075/')))
    assert.equal((await fetch(base + '?hotelId=tez:999999999999999')).status, 404)
    assert.equal((await fetch(base + '?hotelId=tez:0')).status, 400)
    assert.equal((await fetch(base + '?hotelId=https://s.tez-tour.com/hotel/1491/image.jpg')).status, 400)
    assert.equal(priceRequests, 0)
})
