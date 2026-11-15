import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createPreviewAgencyStorage} from '../scripts/preview-agency-storage.mjs'

test('preview storage persists HEAD completion metadata and serializes CAS across adapter instances', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'travel-source-preview-'))
    try {
        const first = createPreviewAgencyStorage(directory)
        const second = createPreviewAgencyStorage(directory)
        const options = {onlyIf: new Headers({'if-none-match': '*'}), httpMetadata: {contentType: 'application/json'},
            customMetadata: {sequence: '1', providerRetryAt: '0'}}
        const created = await first.put('source', '{"price":100}', options)
        assert.ok(created)
        const updates = await Promise.all([first, second].map(bucket => bucket.put('source', '{"price":200}', {
            ...options, onlyIf: new Headers({'if-match': '"' + created.etag + '"'}), customMetadata: {sequence: '2', providerRetryAt: '60000'},
        })))
        assert.equal(updates.filter(Boolean).length, 1)
        const restored = createPreviewAgencyStorage(directory)
        const head = await restored.head!('source')
        assert.deepEqual(head?.customMetadata, {sequence: '2', providerRetryAt: '60000'})
        assert.equal(await (await restored.get('source'))?.text(), '{"price":200}')
        assert.equal(head?.etag, updates.find(Boolean)?.etag)
    } finally { await rm(directory, {recursive: true, force: true}) }
})
