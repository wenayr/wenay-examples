import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createServer} from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {savePlaceSnapshot, type ReferencePlace} from '../backend/places/index.mjs'
import {createTravelSupply} from '../backend/supply.ts'
import {openCatalogStorage} from '../backend/catalog-storage.ts'
import {createPropertyPhotos} from '../backend/property-photos.ts'
import type {SupplyCatalogPage} from '../src/supply-contract.ts'

const propertyPhoto = {
    url: 'https://example.org/one.webp', sourceUrl: 'https://example.org/one',
    license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: 'Fixture',
}

function record(id: string, name: string, destinationId: string, latitude: number, longitude: number): ReferencePlace {
    const sourceId = id.split(':')[0]
    return {
        id, name, destinationId, latitude, longitude, locality: destinationId,
        category: 'Отель', website: null, registrationId: null, wikidataId: null,
        sourceId, sourceName: sourceId, sourceUrl: 'https://example.org', photo: null, price: null,
    }
}

test('область карты и источник определяют вариант отеля до объединения дублей', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wenay-catalog-focus-'))
    const manifest = join(directory, 'photo.json')
    const env = {
        TRAVEL_SNAPSHOT_DIR: directory, TRAVEL_CATALOG_INDEX_PATH: join(directory, 'focus.sqlite'),
        TRAVEL_PHOTO_MANIFEST: manifest, TRAVEL_REFRESH_MODE: 'manual',
    }
    const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
    Object.assign(process.env, env)
    try {
        const inside = record('osm:node:100', 'Étoile Hotel', 'hurghada', 27.11, 33.83)
        const entity = 'Q987654'
        const withPhoto = {...record('wikidata:' + entity, 'Etoile Hotel', 'hurghada', 27.111, 33.83), wikidataId: entity}
        const elsewhere = record(inside.id, 'Пафос', 'paphos', 34.78, 32.42)
        writeFileSync(manifest, JSON.stringify({[withPhoto.id]: propertyPhoto}))
        const chain = [0, 1, 2].map(i => record('osm:node:' + (201 + i), 'Маяк', 'hurghada', 27.13 + .00135 * i, 33.83))
        const numerals = [10, 2].map(i => record('osm:node:' + (301 + i), 'Дом ' + i, 'hurghada', 27.14, 33.83))
        const byQ = {...record('osm:node:400', 'Alias', 'hurghada', 27.16, 33.84), wikidataId: entity}
        const snapshotTime = new Date().toISOString()
        for (const rows of [[inside, ...chain, ...numerals, byQ], [withPhoto], [elsewhere]]) {
            const {destinationId, sourceId} = rows[0]
            savePlaceSnapshot(destinationId, {sourceId, fetchedAt: snapshotTime, records: rows})
        }
        openCatalogStorage({photos: createPropertyPhotos({})}).close()
        const supply = createTravelSupply()
        const server = createServer((req, res) => void supply.middleware(req, res, () => res.writeHead(404).end()))
        try {
            server.listen(0, '127.0.0.1')
            await once(server, 'listening')
            const root = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/travel/'
            async function get(route: string) {
                const response = await fetch(root + route)
                assert.equal(response.status, 200)
                return response.json()
            }
            async function result(filter: string) {
                const page = await get('catalog?destination=hurghada&limit=1&q=etoile' + filter) as SupplyCatalogPage
                assert.equal(page.total, 1)
                assert.equal(page.nextOffset, null)
                return page.items[0]
            }
            // The two end points of a 150 m + 150 m chain represent distinct hotels.
            const chainPage = await get('catalog?destination=hurghada&q=' + encodeURIComponent('маяк'))
            assert.deepEqual(chainPage.items.map((hotel: ReferencePlace) => hotel.id), [chain[0].id, chain[2].id])
            const numbersPage = await get('catalog?destination=hurghada&q=' + encodeURIComponent('дом'))
            assert.deepEqual(numbersPage.items.map((hotel: ReferencePlace) => hotel.name), ['Дом 2', 'Дом 10'])
            const aliases = await get('catalog?destination=hurghada&q=alias')
            assert.deepEqual(aliases.items.map((hotel: ReferencePlace) => hotel.id), [byQ.id])
            assert.equal((await result('')).id, withPhoto.id)
            assert.equal((await result('&source=osm')).id, inside.id)
            const found = await result('&west=33.82&east=33.84&south=27.109&north=27.1105')
            assert.equal(found.id, inside.id)
            assert.equal(found.photo, null)
            assert.equal((await get('hotel?destination=hurghada&hotelId=' + inside.id)).hotel.name, inside.name)
            assert.equal((await get('hotel?destination=paphos&hotelId=' + inside.id)).hotel.name, elsewhere.name)
        } finally {
            await supply.shutdown()
            server.closeAllConnections()
            if (server.listening) await new Promise<void>(done => server.close(() => done()))
        }
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value == null) delete process.env[key]
            else process.env[key] = value
        }
        rmSync(directory, {recursive: true, force: true})
    }
})
