import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCatalogIndex} from '../backend/catalog-index.ts'
import type {PlaceRegion} from '../backend/catalog.ts'
import type {SupplyHotel} from '../src/supply-contract.ts'

const region = {id: 'synthetic', name: 'Область', country: '', latitude: 0, longitude: 0, sourceIds: ['a', 'b']} satisfies PlaceRegion
const query = {destination: region, q: '', source: null, box: null, limit: 24, offset: 0}
const noPhoto = () => null

function row(id: string, source: string, name: string, x = 0): SupplyHotel {
    return {id, name, latitude: 0, longitude: x, sourceId: source, sourceUrl: '/', sourceName: source,
        locality: null, category: null, website: null, price: null, photo: null}
}

test('индексы подстрок и координат физически ограничены выбранным направлением', t => {
    const dir = mkdtempSync(join(tmpdir(), 'scoped-index-'))
    t.after(() => rmSync(dir, {force: true, recursive: true}))
    const path = join(dir, 'index.sqlite')
    const destinations = [region, {...region, id: 'other'}]
    const write = createCatalogIndex({path, destinations})
    t.after(write.close)
    for (const destination of destinations) {
        const records = Array.from({length: 300}, (_, i) => row(destination.id + i, 'a', 'HOTÉL ' + i, i / 100))
        write.replaceSource(destination.id, 'a', {fetchedAt: '2026-11-13', records}, noPhoto)
    }
    const read = createCatalogIndex({path, destinations})
    t.after(read.close)
    const result = read.list({...query, q: 'hotel', box: [0.2, 0, 0.21, 0], limit: 1})
    assert.equal(result.total, 2)
    assert.equal(result.items[0].id, region.id + 20)
    assert.deepEqual(read.stats().byRegion, {[region.id]: 1})
    assert.deepEqual(read.list({...query, q: 'tel 289'}).items.map(h => h.name), ['HOTÉL 289'])
    const plan = read.withPublication(db => db.prepare(
        'EXPLAIN QUERY PLAN SELECT p.id FROM geo_' + Buffer.from(region.id).toString('hex') + ' g CROSS JOIN places p ON p.key=g.key WHERE g.w>=? AND g.w<=?'
    ).all(0.2, 0.21))
    assert.match(JSON.stringify(plan), /VIRTUAL TABLE INDEX/)
})

test('точечное переименование, порядок числа и rollback сохранены при повторном открытии', t => {
    const dir = mkdtempSync(join(tmpdir(), 'order-index-'))
    t.after(() => rmSync(dir, {force: true, recursive: true}))
    const path = join(dir, 'index.sqlite')
    const destinations = [region]
    let index = createCatalogIndex({path, destinations})
    const values = ['Отель 10', 'Hotel 2', 'Hotel 19', 'Отель 3', 'Hotel 8'].map((name, i) => row('hotel-' + i, 'a', name))
    index.replaceSource(region.id, 'a', {fetchedAt: null, records: values}, noPhoto)
    const updated = {...values[0], name: 'Hotel 1'}
    assert.deepEqual(index.patch(region.id, 'a', {upsert: [updated]}, noPhoto), {changed: true})
    assert.deepEqual(index.patch(region.id, 'a', {upsert: [updated]}, noPhoto), {changed: false})
    assert.throws(() => index.withPublication(() => {
        index.patch(region.id, 'a', {remove: [updated.id]}, noPhoto)
        throw new Error('abort')
    }), /abort/)
    index.close()
    index = createCatalogIndex({path, destinations})
    t.after(index.close)
    const actual = index.list(query).items.map(h => h.name)
    assert.deepEqual(actual, ['Отель 3', 'Hotel 1', 'Hotel 2', 'Hotel 8', 'Hotel 19'])
    assert.equal(index.revision(region.id), 2)
    assert.equal(index.stats().payloadReads, 5)
})
