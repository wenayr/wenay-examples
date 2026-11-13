import assert from 'node:assert/strict'
import {mkdtempSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {openCatalogStorage} from '../backend/catalog-storage.ts'
import {readPlaceSnapshot, savePlaceSnapshot} from '../backend/places/index.mjs'
import {createPropertyPhotos} from '../backend/property-photos.ts'

test('прогретые процессы сверяют метаданные, точечные изменения переживают рестарт обоих читателей', t => {
    const dir = mkdtempSync(join(tmpdir(), 'wenay-startup-index-'))
    const manifest = join(dir, 'photos.json')
    const previous = [process.env.TRAVEL_SNAPSHOT_DIR, process.env.TRAVEL_CATALOG_INDEX_PATH]
    process.env.TRAVEL_SNAPSHOT_DIR = dir
    process.env.TRAVEL_CATALOG_INDEX_PATH = join(dir, 'prepared.sqlite')
    const readers = new Set<ReturnType<typeof openCatalogStorage>>()
    function open() {
        const storage = openCatalogStorage({photos: createPropertyPhotos({manifestPath: manifest, lazy: true})})
        readers.add(storage)
        return storage
    }
    t.after(() => {
        for (const reader of readers) reader.close()
        const variables = ['TRAVEL_SNAPSHOT_DIR', 'TRAVEL_CATALOG_INDEX_PATH']
        for (const [i, key] of variables.entries()) {
            if (previous[i] != null) process.env[key] = previous[i]
            else delete process.env[key]
        }
        rmSync(dir, {recursive: true, force: true})
    })

    const city = 'hurghada'
    const provider = 'wikidata'
    const input = readPlaceSnapshot(city, provider)
    const hotel = input.records[0]
    const later = (seconds: number) => new Date(Date.parse(input.fetchedAt!) + seconds * 1000).toISOString()
    savePlaceSnapshot(city, {...input, records: [hotel], fetchedAt: later(1)})
    const display = {url: 'https://example.org/p', sourceUrl: 'https://example.org/p', credit: 'Test', license: 'CC0', licenseUrl: 'https://example.org/l'}
    const image = {...display, provider: 'wikimedia-commons', matchedBy: 'wikidata', externalHotelId: hotel.id,
        upstreamPhotoId: 'File:Hotel.jpg', evidenceUrl: 'https://example.org/evidence'}
    writeFileSync(manifest, JSON.stringify({[hotel.id]: image}))

    const a = open()
    assert.ok(a.importedSources() > 0)
    assert.deepEqual(a.index.find(city, hotel.id)?.photo, image)
    // Recreate the previous persistent format without changing the input file's identity or timestamps.
    const stat = statSync(manifest, {bigint: true})
    const oldStamp = [manifest, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
    a.index.withPublication(db => {
        db.prepare('UPDATE photo_manifest SET stamp=? WHERE id=1').run(oldStamp)
        db.prepare('UPDATE photo_credits SET image=? WHERE id=?').run(JSON.stringify(display), hotel.id)
        a.index.applyPhotos([hotel.id], () => display)
    })
    assert.deepEqual(a.index.find(city, hotel.id)?.photo, display)
    a.pollChanges()
    const b = open()
    assert.equal(b.importedSources(), 0)
    assert.ok(a.pollChanges().includes(city))
    assert.deepEqual(b.index.find(city, hotel.id)?.photo, image)

    const updated = {...image, evidenceUrl: 'https://example.org/new-evidence'}
    writeFileSync(manifest + '.new', JSON.stringify({[hotel.id]: updated}))
    renameSync(manifest + '.new', manifest)
    a.syncPhotos()
    assert.ok(a.pollChanges().includes(city))
    assert.ok(b.pollChanges().includes(city))
    assert.deepEqual(b.index.find(city, hotel.id)?.photo, updated)

    savePlaceSnapshot(city, {...input, records: [{...hotel, name: 'Изменение'}], fetchedAt: later(2)})
    assert.equal(a.syncSource(city, provider), true)
    assert.equal(b.syncSource(city, provider), false)
    assert.deepEqual(a.pollChanges(), [city])
    assert.deepEqual(b.pollChanges(), [city])
    assert.deepEqual(b.pollChanges(), [])
    assert.equal(b.index.find(city, hotel.id)?.name, 'Изменение')

    writeFileSync(manifest + '.new', '{}')
    renameSync(manifest + '.new', manifest)
    a.syncPhotos()
    b.syncPhotos()
    assert.ok(a.pollChanges().includes(city))
    assert.deepEqual(a.pollChanges(), [])
    assert.ok(b.pollChanges().includes(city))
    assert.equal(b.index.find(city, hotel.id)?.photo, null)

    a.close()
    readers.delete(a)
    b.close()
    readers.delete(b)
    const reopened = open()
    assert.equal(reopened.importedSources(), 0)
    assert.equal(reopened.index.find(city, hotel.id)?.photo, null)
})
