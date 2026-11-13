import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlaceCatalog, type PlaceDataset} from '../backend/catalog.ts'
import type {SupplyPhoto} from '../src/supply-contract.ts'

const destination = {id: 'dublin', sourceIds: ['failte'], name: 'Dublin', country: 'Ирландия', latitude: 53.35, longitude: -6.2}
const source = {id: 'failte', name: 'Fáilte Ireland'}
const hotel = {
    id: 'failte:AA5', sourceId: 'failte', sourceName: source.name, sourceUrl: 'https://example.org',
    name: 'Old name', latitude: 53, longitude: -6, category: 'Hotel', locality: 'Dublin', photo: null, price: null, website: null,
    wikidataId: 'Q123',
} as const
const query = {destination, source: null, q: '', box: null, offset: 0, limit: 5}

test('повторный импорт, смена поля, подтверждённое фото и снятие записи', t => {
    const changes: string[] = []
    let photo: SupplyPhoto | null = null
    let data: PlaceDataset = {records: [hotel], fetchedAt: '2026-01-01'}
    const catalog = createPlaceCatalog({
        destinations: [destination], sources: [source], readSnapshot: () => data,
        photo: () => photo, onChange: id => changes.push(id),
    })
    t.after(catalog.shutdown)
    assert.equal(catalog.list(query).items[0].name, 'Old name')
    data = {records: [{...hotel}], fetchedAt: '2026-01-02'}
    catalog.reloadSnapshot('dublin', 'failte')
    assert.deepEqual(changes, [])
    data = {records: [{...hotel, name: 'New name'}], fetchedAt: '2026-01-03'}
    catalog.reloadSnapshot('dublin', 'failte')
    assert.equal(catalog.list({...query, q: 'old'}).total, 0)
    assert.equal(catalog.list({...query, q: 'new'}).total, 1)
    photo = {url: '/photo', sourceUrl: '/source', credit: 'Author', license: 'CC0', licenseUrl: '/license'}
    catalog.invalidatePhotos(['Q456'])
    catalog.invalidatePhotos(['Q123'])
    assert.deepEqual(catalog.find(destination, hotel.id)?.photo, photo)
    photo = null
    catalog.invalidatePhotos([hotel.id])
    assert.equal(catalog.find(destination, hotel.id)?.photo, null)
    data = {records: [], fetchedAt: '2026-01-04'}
    catalog.reloadSnapshot('dublin', 'failte')
    assert.equal(catalog.list(query).total, 0)
    assert.equal(catalog.find(destination, hotel.id), undefined)
    assert.deepEqual(changes, ['dublin', 'dublin', 'dublin', 'dublin'])
})
