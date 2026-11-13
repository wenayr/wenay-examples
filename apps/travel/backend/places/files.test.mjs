import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readPlaceSnapshot, savePlaceSnapshot, snapshotRegion} from './files.mjs'

test('working snapshots preserve observations across restart, reject late replies, and tombstone rows only on complete feeds', t => {
    const directory = mkdtempSync(join(tmpdir(), 'wenay-place-files-'))
    const previous = process.env.TRAVEL_SNAPSHOT_DIR
    process.env.TRAVEL_SNAPSHOT_DIR = directory
    t.after(() => {
        if (previous == null) delete process.env.TRAVEL_SNAPSHOT_DIR
        else process.env.TRAVEL_SNAPSHOT_DIR = previous
        rmSync(directory, {recursive: true, force: true})
    })
    const source = readPlaceSnapshot('hurghada', 'osm')
    const [hotel, neighbor] = source.records
    const first = new Date(Date.parse(source.fetchedAt) + 60_000).toISOString()
    const second = new Date(Date.parse(first) + 60_000).toISOString()
    const third = new Date(Date.parse(second) + 60_000).toISOString()
    savePlaceSnapshot('hurghada', {...source, records: [hotel, neighbor], fetchedAt: first})
    const changed = {...hotel, name: 'New name'}
    savePlaceSnapshot('hurghada', {...source, records: [changed], partial: true, fetchedAt: second})
    assert.equal(readPlaceSnapshot('hurghada', 'osm').records.length, 2)
    assert.equal(readPlaceSnapshot('hurghada', 'osm').records[0].name, changed.name)
    savePlaceSnapshot('hurghada', {...source, records: [hotel], fetchedAt: first})
    assert.equal(readPlaceSnapshot('hurghada', 'osm').fetchedAt, second)
    savePlaceSnapshot('hurghada', {...source, records: [], fetchedAt: third})
    savePlaceSnapshot('hurghada', {...source, records: [], fetchedAt: third})
    assert.deepEqual(readPlaceSnapshot('hurghada', 'osm').records, [])
    const published = readdirSync(directory).filter(snapshotRegion)
    assert.equal(published.length, 2)
    for (const file of published) assert.deepEqual(snapshotRegion(file), {destinationId: 'hurghada', sourceId: 'osm'})
    assert.equal(snapshotRegion('.writer.tmp'), null)
})

test('writers take turns before fetching a partial feed, so two disjoint additions survive', async t => {
    const {fetchAndPublish} = await import('./files.mjs')
    const directory = mkdtempSync(join(tmpdir(), 'wenay-place-serial-'))
    const previous = process.env.TRAVEL_SNAPSHOT_DIR
    process.env.TRAVEL_SNAPSHOT_DIR = directory
    t.after(() => {
        if (previous == null) delete process.env.TRAVEL_SNAPSHOT_DIR
        else process.env.TRAVEL_SNAPSHOT_DIR = previous
        rmSync(directory, {recursive: true, force: true})
    })
    const state = readPlaceSnapshot('hurghada', 'osm')
    const [first, second] = state.records
    const fetchedAt = new Date(Date.parse(state.fetchedAt) + 10_000).toISOString()
    savePlaceSnapshot('hurghada', {...state, records: [], fetchedAt})
    const started = []
    let releaseFirst
    const gate = new Promise(resolve => { releaseFirst = resolve })
    const a = fetchAndPublish('hurghada', 'osm', async () => {
        started.push('a')
        await gate
        return {...state, records: [first], partial: true, fetchedAt}
    })
    const b = fetchAndPublish('hurghada', 'osm', async () => {
        started.push('b')
        return {...state, records: [second], partial: true, fetchedAt}
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.throws(() => savePlaceSnapshot('hurghada', {...state, fetchedAt}), {code: 'EBUSY'})
    assert.deepEqual(started, ['a'])
    releaseFirst()
    await Promise.all([a, b])
    assert.deepEqual(started, ['a', 'b'])
    assert.deepEqual(new Set(readPlaceSnapshot('hurghada', 'osm').records.map(row => row.id)), new Set([first.id, second.id]))
    assert.doesNotThrow(() => savePlaceSnapshot('hurghada', {...state, records: [], fetchedAt}))
})

test('a killed writer releases the per-feed lease for another process', async t => {
    const {spawn} = await import('node:child_process')
    const {once} = await import('node:events')
    const directory = mkdtempSync(join(tmpdir(), 'wenay-place-crash-'))
    const previous = process.env.TRAVEL_SNAPSHOT_DIR
    process.env.TRAVEL_SNAPSHOT_DIR = directory
    const module = new URL('./files.mjs', import.meta.url).href
    const fixture = 'import {fetchAndPublish} from ' + JSON.stringify(module)
        + '; await fetchAndPublish("hurghada","osm",async () => {process.send("locked"); await new Promise(r=>setTimeout(r,60000))})'
    const child = spawn(process.execPath, ['--input-type=module', '-e', fixture], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']})
    t.after(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL')
        if (previous == null) delete process.env.TRAVEL_SNAPSHOT_DIR
        else process.env.TRAVEL_SNAPSHOT_DIR = previous
        rmSync(directory, {recursive: true, force: true})
    })
    await once(child, 'message', {signal: AbortSignal.timeout(5_000)})
    const source = readPlaceSnapshot('hurghada', 'osm')
    const snapshot = {...source, fetchedAt: new Date(Date.parse(source.fetchedAt) + 10_000).toISOString(), records: []}
    assert.throws(() => savePlaceSnapshot('hurghada', snapshot), {code: 'EBUSY'})
    const closed = once(child, 'exit', {signal: AbortSignal.timeout(5_000)})
    child.kill('SIGKILL')
    await closed
    assert.deepEqual(savePlaceSnapshot('hurghada', snapshot).records, [])
})
