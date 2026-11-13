import assert from 'node:assert/strict'
import {mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createPropertyPhotos} from '../backend/property-photos.ts'

const photo = {
    url: 'https://upload.wikimedia.org/photo.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', credit: 'Автор',
}

test('published photo changes and removals resolve by exact property or explicit Wikidata ID', t => {
    const dir = mkdtempSync(join(tmpdir(), 'wenay-photo-manifest-'))
    t.after(() => rmSync(dir, {force: true, recursive: true}))
    const manifestPath = join(dir, 'photos.json')
    const photos = createPropertyPhotos({manifestPath})
    const publish = (data: unknown) => {
        writeFileSync(manifestPath + '.next', JSON.stringify(data))
        renameSync(manifestPath + '.next', manifestPath)
        return photos.reload()
    }
    const linked = {id: 'osm:way:12', wikidataId: 'Q123'}
    assert.equal(photos.find(linked), null)
    assert.deepEqual(publish({Q123: photo}), ['wikidata:Q123'])
    assert.deepEqual(photos.find(linked), photo)
    assert.equal(photos.find({id: 'osm:way:13'}), null)
    assert.deepEqual(publish({Q123: {...photo, matchedBy: 'wikidata:P18'}}), [])
    assert.deepEqual(publish({Q123: {...photo, fileVersion: 'new-file-at-same-url'}}), ['wikidata:Q123'])
    assert.deepEqual(publish({Q123: {...photo, credit: 'Новый автор'}, [linked.id]: photo}), ['wikidata:Q123', linked.id])
    assert.deepEqual(photos.find(linked), photo)
    assert.throws(() => publish({Q123: {...photo, licenseUrl: 'javascript:void(0)'}}))
    assert.deepEqual(photos.find(linked), photo)
    assert.deepEqual(publish({}), ['wikidata:Q123', linked.id])
    assert.equal(photos.find(linked), null)
})
