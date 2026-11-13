import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test, {type TestContext} from 'node:test'
import {runPhotoImport} from '../backend/photos/import-photos.ts'
import type {CommonsCandidate} from '../backend/photos/commons.ts'

const fullCredit = 'Фотограф: Anna &amp; Studio ' + 'Очень длинная строка атрибуции '.repeat(15)
function image(title: string, license = 'CC BY-SA 4.0') {
    return {title, imageinfo: [{
        url: 'https://upload.wikimedia.org/original.jpg', thumburl: 'https://thumb.wikimedia.org/500.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/' + encodeURI(title.replaceAll(' ', '_')),
        mime: 'image/jpeg', sha1: 'abc123', extmetadata: {
            Artist: {value: '<span>' + fullCredit + '</span>'},
            LicenseShortName: {value: license}, LicenseUrl: {value: 'https://creativecommons.org/licenses/by-sa/4.0/'},
        },
    }]}
}

type tTitles = Record<string, string[]>
function wiki(titles: tTitles, rejected: string[] = []): typeof fetch {
    return async function mock(input) {
        const url = new URL(String(input))
        if (url.hostname == 'query.wikidata.org') {
            const ids = [...url.searchParams.get('query')!.matchAll(/wd:(Q[0-9]+)/g)].map(m => m[1])
            const bindings = ids.flatMap(key => {
                const files = titles[key] ?? []
                const id = {value: 'http://www.wikidata.org/entity/' + key}
                if (!files.length) return [{id}]
                return files.map(f => ({id, file: {value: 'http://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f)}}))
            })
            return Response.json({results: {bindings}})
        }
        const list = url.searchParams.get('titles')!.split('|')
        return Response.json({query: {pages: list.map(title => image(title, rejected.includes(title) ? 'CC BY-NC 4.0' : 'CC BY-SA 4.0'))}})
    }
}

async function setup(t: TestContext, keys = ['Q42']) {
    const dir = await mkdtemp(join(tmpdir(), 'wenay-photo-test-'))
    t.after(() => rm(dir, {recursive: true, force: true}))
    return {manifestPath: join(dir, 'manifest.json'), checkpointPath: join(dir, 'resume.sqlite'),
        targets: keys.map(key => ({key, links: [] as CommonsCandidate[]})),
        exclusions: {}, now: 1000, fetcher: wiki({Q42: ['Hotel A.jpg']}), dir}
}

test('dry-run writes nothing; normal import records provenance, preserves credit and resumes', async t => {
    const options = await setup(t)
    const preview = await runPhotoImport({...options, dryRun: true})
    assert.equal(preview.added, 1)
    assert.deepEqual(await readdir(options.dir), [])
    const first = await runPhotoImport(options)
    assert.equal(first.added, 1)
    const item = JSON.parse(await readFile(options.manifestPath, 'utf8')).Q42
    assert.equal(item.upstreamPhotoId, 'File:Hotel A.jpg')
    assert.equal(item.matchedBy, 'wikidata:P18')
    assert.equal(item.fileVersion, 'abc123')
    assert.equal(item.credit, fullCredit.replace('&amp;', '&').trim())
    const resume = await runPhotoImport({...options, fetcher() {throw new Error('fresh rows may not query upstream')}})
    assert.equal(resume.skippedFresh, 1)
    const revalidate = await runPhotoImport({...options, force: true})
    assert.equal(revalidate.unchanged, 1)
})

test('transient or incomplete response preserves last photo; confirmed source removal clears it', async t => {
    const options = await setup(t)
    await runPhotoImport(options)
    const saved = await readFile(options.manifestPath, 'utf8')
    for (const response of [() => new Response(null, {status: 429}), () => Response.json({entities: {}})]) {
        await assert.rejects(runPhotoImport({...options, force: true, fetcher: async () => response()}))
        assert.equal(await readFile(options.manifestPath, 'utf8'), saved)
    }
    const removed = await runPhotoImport({...options, force: true, fetcher: wiki({})})
    assert.equal(removed.removed, 1)
    assert.deepEqual(JSON.parse(await readFile(options.manifestPath, 'utf8')), {})
})

test('excludes cross-property imagery and unlicensed files before picking the next P18', async t => {
    const options = await setup(t)
    const exclusions = {Q42: ['Neighbour.jpg']}
    const fetcher = wiki({Q42: ['Neighbour.jpg', 'Restricted.jpg', 'Real hotel.jpg']}, ['File:Restricted.jpg'])
    await runPhotoImport({...options, exclusions, fetcher})
    const data = JSON.parse(await readFile(options.manifestPath, 'utf8'))
    assert.equal(data.Q42.upstreamPhotoId, 'File:Real hotel.jpg')
})

test('verified manual associations survive absent P18, and a new file revision replaces a stale local derivative', async t => {
    const options = await setup(t)
    await runPhotoImport(options)
    const data = JSON.parse(await readFile(options.manifestPath, 'utf8'))
    Object.assign(data.Q42, {matchedBy: 'manual:verified-property', url: '/hotel-photos/old.webp', fileVersion: 'prior'})
    await writeFile(options.manifestPath, JSON.stringify(data))
    const stats = await runPhotoImport({...options, fetcher: wiki({})})
    assert.equal(stats.updated, 1)
    const updated = JSON.parse(await readFile(options.manifestPath, 'utf8')).Q42
    assert.equal(updated.url, 'https://thumb.wikimedia.org/500.jpg')
    assert.equal(updated.fileVersion, 'abc123')
})

test('successful batches survive interruption; retry skips just those batches', async t => {
    const keys = Array.from({length: 21}, (_, i) => 'Q' + (i + 1))
    const options = await setup(t, keys)
    const healthy = wiki(Object.fromEntries(keys.map(key => [key, [key + '.jpg']])))
    const flaky: typeof fetch = (input, init) => {
        const url = new URL(String(input))
        if (url.searchParams.get('query')?.includes('VALUES ?id { wd:Q21 }')) return Promise.resolve(new Response(null, {status: 503}))
        return healthy(input, init)
    }
    await assert.rejects(runPhotoImport({...options, fetcher: flaky}))
    const retry = await runPhotoImport({...options, fetcher: healthy})
    assert.equal(retry.attempted, 1)
    assert.equal(retry.skippedFresh, 20)
    assert.equal(Object.keys(JSON.parse(await readFile(options.manifestPath, 'utf8'))).length, 21)
})

test('concurrent imports preserve changes to different properties', async t => {
    const options = await setup(t)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    const first = wiki({Q42: ['First.jpg']})
    const delayed: typeof fetch = async (input, init) => {
        started()
        await gate
        return first(input, init)
    }
    const a = runPhotoImport({...options, fetcher: delayed})
    await waiting
    try {
        await runPhotoImport({...options, targets: [{key: 'Q43', links: []}], fetcher: wiki({Q43: ['Second.jpg']})})
    } finally {
        release()
    }
    await a
    const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'))
    assert.equal(manifest.Q42.upstreamPhotoId, 'File:First.jpg')
    assert.equal(manifest.Q43.upstreamPhotoId, 'File:Second.jpg')
})

test('a slow import cannot overwrite a newer photo for the same property', async t => {
    const options = await setup(t)
    let started!: () => void
    let release!: () => void
    const waiting = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const old = wiki({Q42: ['Stale.jpg']})
    const delayed: typeof fetch = async (input, init) => {
        started()
        await gate
        return old(input, init)
    }
    const slow = runPhotoImport({...options, fetcher: delayed})
    await waiting
    try {
        await runPhotoImport({...options, fetcher: wiki({Q42: ['New.jpg']})})
    } finally {
        release()
    }
    await assert.rejects(slow, /Concurrent photo change/)
    const manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'))
    assert.equal(manifest.Q42.upstreamPhotoId, 'File:New.jpg')
})
