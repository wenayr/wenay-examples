import assert from 'node:assert/strict'
import test from 'node:test'
import {createServer} from 'node:http'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {createPlaceCatalog} from '../backend/catalog.ts'
import {createSupplyMiddleware} from '../backend/middleware.ts'
import type {SupplyHotel} from '../src/supply-contract.ts'

const region = {id: 'island', name: 'Остров', country: 'Страна', latitude: 27, longitude: 33, sourceIds: ['a', 'b']}
const sources = [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}]
const common = {
    latitude: 27, longitude: 33, category: 'отель', locality: 'Région', website: null, price: null, photo: null,
} as const
function hotel(id: string, name: string, source: string, latitude = 27): SupplyHotel {
    return {...common, id, name, latitude, sourceId: source, sourceName: source, sourceUrl: 'https://example.org/' + id}
}
const first = hotel('a1', 'Hôtel Alpha', 'a')
const data = {
    a: [first, hotel('a2', 'Gamma', 'a'), hotel('a3', 'Alpha South', 'a', 27.3)],
    b: [hotel('b1', 'Hotel Alpha', 'b', 27.0001), hotel('b2', 'Delta', 'b')],
}
const query = {destination: region, q: '', source: null, box: null, offset: 0, limit: 10}

function createCatalog(refresh: () => Promise<{records: SupplyHotel[], fetchedAt: string}>) {
    return createPlaceCatalog({
        sources, destinations: [region], photo: () => null,
        readSnapshot: (_, id) => ({records: data[id as keyof typeof data], fetchedAt: '2026-11-01T10:00:00Z'}),
        refresh,
    })
}

test('источники, карта, поиск без диакритики и страницы работают по одним данным', async t => {
    let refreshed = 0
    const catalog = createCatalog(async () => {
        refreshed++
        throw new Error('offline')
    })
    t.after(catalog.shutdown)
    const initial = catalog.list({...query, limit: 2})
    assert.equal(initial.total, 4)
    assert.equal(initial.nextOffset, 2)
    assert.equal(catalog.list({...query, offset: 2}).nextOffset, null)
    assert.equal(catalog.list({...query, source: 'b'}).total, 2)
    assert.equal(catalog.list({...query, q: 'hotel alpha'}).total, 1)
    assert.equal(catalog.list({...query, box: [32, 27.1, 34, 28]}).total, 1)
    assert.equal(catalog.find(region, 'b1')?.sourceId, 'b')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(refreshed, 2)
    assert.equal(catalog.list(query).sources[0].status, 'cached')
    assert.match(catalog.list(query).sources[0].description, /не ответил/)
})

test('живой пустой ответ обновляет снимок, повторные фильтры не вызывают поиск поставщика', async t => {
    let requests = 0
    const catalog = createCatalog(async () => {
        requests++
        return {records: [], fetchedAt: '2026-11-13T11:00:00Z'}
    })
    t.after(catalog.shutdown)
    assert.equal(catalog.list(query).total, 4)
    await new Promise(resolve => setImmediate(resolve))
    const result = catalog.list(query)
    assert.equal(result.total, 0)
    assert.equal(result.sources[0].status, 'live')
    assert.equal(requests, 2)
})

test('HTTP проверяет параметры и передаёт поставщику объект, подтверждённый в этом направлении', async t => {
    const catalog = createCatalog(async () => { throw new Error('offline') })
    let received = ''
    const middleware = createSupplyMiddleware({
        catalog, today: () => '2027-01-01',
        partners: async ({hotel, checkIn, checkOut, adults}) => {
            received = [hotel?.id, checkIn, checkOut, adults].join(' ')
            return {links: [], offers: [], sources: []}
        },
    })
    const server = createServer((req, res) => void middleware(req, res, () => res.end('static')))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => {
        catalog.shutdown()
        server.closeAllConnections()
        return new Promise<void>(done => server.close(() => done()))
    })
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/travel/'
    const get = (path: string) => fetch(base + path)
    assert.equal((await get('destinations')).status, 200)
    assert.equal((await get('catalog?destination=wrong')).status, 404)
    assert.equal((await get('catalog?source=bad')).status, 400)
    assert.equal((await get('catalog?west=33')).status, 400)
    assert.equal((await get('catalog?limit=0')).status, 400)
    assert.equal((await get('options?hotelId=wrong')).status, 404)
    assert.equal((await get('options?checkIn=2027-02-29&checkOut=2027-03-02')).status, 400)
    assert.equal((await get('options?hotelId=a1&checkIn=2027-01-24&checkOut=2027-01-31&adults=2')).status, 200)
    assert.equal(received, 'a1 2027-01-24 2027-01-31 2')
})

test('при объединении остаётся карточка с подтверждённой фотографией той же гостиницы', () => {
    const photo = {url: '/photo.webp', sourceUrl: 'https://commons.wikimedia.org', credit: 'Автор', license: 'CC0', licenseUrl: '/rights'}
    const catalog = createPlaceCatalog({
        destinations: [region], sources, readSnapshot: (_, id) => ({records: data[id as keyof typeof data], fetchedAt: '2026-11-01'}),
        refresh: async () => { throw new Error('offline') },
        photo: hotel => hotel.id == 'b1' ? photo : null,
    })
    try {
        assert.equal(catalog.list(query).items[0].id, 'b1')
        assert.equal(catalog.list({...query, source: 'a'}).items.some(hotel => hotel.photo), false)
    } finally {
        catalog.shutdown()
    }
})
