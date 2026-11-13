import {createHash, randomUUID} from 'node:crypto'
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {join, resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {placeDestinations} from './registry.mjs'
import {expandPlace} from './providers.mjs'

export const snapshotColumns = ['propertyId', 'name', 'latitude', 'longitude', 'category', 'locality', 'website', 'wikidataId', 'commonsFile']
const bundled = fileURLToPath(new URL('./snapshots/', import.meta.url))

export function runtimeSnapshotDirectory() {
    const defaultPath = fileURLToPath(new URL('../../travel-data/places/', import.meta.url))
    return resolve(process.env.TRAVEL_SNAPSHOT_DIR || defaultPath)
}

function regionFor(destinationId, sourceId) {
    const region = placeDestinations.find(item => item.id == destinationId)
    if (!region?.sourceIds.includes(sourceId)) throw new RangeError('Unknown destination or source')
    return region
}

export function snapshotRegion(filename) {
    const match = /^([a-z]+)-([a-z]+)\.\d{13}-[a-f0-9]{64}\.json$/.exec(filename)
    if (!match) return null
    const region = placeDestinations.find(item => item.id == match[1])
    return region?.sourceIds.includes(match[2]) ? {destinationId: match[1], sourceId: match[2]} : null
}

export function snapshotPath(destinationId, sourceId) {
    regionFor(destinationId, sourceId)
    return new URL('./snapshots/' + destinationId + '-' + sourceId + '.json', import.meta.url)
}

function generations(directory, destinationId, sourceId) {
    if (!existsSync(directory)) return []
    const prefix = destinationId + '-' + sourceId + '.'
    return readdirSync(directory).filter(name => name.startsWith(prefix) && snapshotRegion(name)).sort().reverse()
}

export function encodePlaceSnapshot(snapshot) {
    const prefix = snapshot.sourceId + ':'
    const rows = snapshot.records.map(record => {
        const compact = {...record, propertyId: record.id.slice(prefix.length)}
        return snapshotColumns.map(key => compact[key])
    })
    return JSON.stringify({version: 1, fetchedAt: snapshot.fetchedAt, rows}) + '\n'
}

function decode(path, region, sourceId) {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw.version != 1 || !Array.isArray(raw.rows)) throw new Error('Unknown place snapshot format')
    const records = raw.rows.map(row => {
        const fields = Object.fromEntries(snapshotColumns.map((key, i) => [key, row[i]]))
        return expandPlace(fields, region, sourceId)
    })
    return {sourceId, records, fetchedAt: raw.fetchedAt}
}

export function readPlaceSnapshot(destinationId, sourceId) {
    const region = regionFor(destinationId, sourceId)
    const directory = runtimeSnapshotDirectory()
    // A concurrent writer may prune a generation between listing and opening it.
    for (let retry = 0; retry < 3; retry++) {
        const [latest] = generations(directory, destinationId, sourceId)
        const path = latest ? join(directory, latest) : join(bundled, destinationId + '-' + sourceId + '.json')
        try {
            return decode(path, region, sourceId)
        } catch (error) {
            if (error.code != 'ENOENT') throw error
            if (!latest) return {sourceId, records: [], fetchedAt: null}
        }
    }
    throw new Error('Place snapshots keep changing during read')
}

function acquireWriter(destinationId, sourceId) {
    regionFor(destinationId, sourceId)
    const directory = runtimeSnapshotDirectory()
    mkdirSync(directory, {recursive: true})
    // A zero-data SQLite file lends us its OS writer lock. A terminated process releases it automatically.
    const path = join(directory, '.' + destinationId + '-' + sourceId + '.writer.sqlite')
    const guard = new DatabaseSync(path)
    try {
        guard.exec('BEGIN IMMEDIATE')
    } catch (error) {
        guard.close()
        if (error.errcode != 5 && error.errcode != 6) throw error
        throw Object.assign(new Error('Snapshot writer is busy: ' + path), {code: 'EBUSY'})
    }
    return () => guard.close()

}

export function savePlaceSnapshot(destinationId, incoming) {
    const release = acquireWriter(destinationId, incoming.sourceId)
    try {
        return publishSnapshot(destinationId, incoming)
    } finally {
        release()
    }
}

export async function fetchAndPublish(destinationId, sourceId, fetchData, signal) {
    const deadline = Date.now() + 40_000
    let release
    while (!release) {
        signal?.throwIfAborted()
        try {
            release = acquireWriter(destinationId, sourceId)
        } catch (error) {
            if (error.code != 'EBUSY' || Date.now() >= deadline) throw error
            await delay(200, undefined, {signal})
        }
    }
    try {
        // Holding the per-feed lease from observation to publication orders even truncated upstream responses.
        const incoming = await fetchData()
        signal?.throwIfAborted()
        return publishSnapshot(destinationId, incoming)
    } finally {
        release()
    }
}

function publishSnapshot(destinationId, incoming) {
    const sourceId = incoming.sourceId
    regionFor(destinationId, sourceId)
    const timestamp = Date.parse(incoming.fetchedAt)
    if (!Number.isSafeInteger(timestamp) || String(timestamp).length != 13) throw new Error('Expected a timestamp for this observation')
    const directory = runtimeSnapshotDirectory()
    mkdirSync(directory, {recursive: true})
    const existing = readPlaceSnapshot(destinationId, sourceId)
    if (Date.parse(existing.fetchedAt) > timestamp) return existing
    let records = incoming.records
    if (incoming.partial) {
        const seen = new Set(records.map(hotel => hotel.id))
        records = [...records, ...existing.records.filter(hotel => !seen.has(hotel.id))]
    }
    const encoded = encodePlaceSnapshot({...incoming, records})
    const hash = createHash('sha256').update(encoded).digest('hex')
    const [lastName] = generations(directory, destinationId, sourceId)
    if (lastName?.endsWith('-' + hash + '.json')) return existing
    const lastVersion = Number(lastName?.split('.')[1]?.split('-')[0] ?? 0)
    const generation = Math.max(timestamp, lastVersion + 1)
    const name = destinationId + '-' + sourceId + '.' + generation + '-' + hash + '.json'
    const temporary = join(directory, '.' + name + '.' + randomUUID() + '.tmp')
    try {
        writeFileSync(temporary, encoded, {flag: 'wx', flush: true})
        renameSync(temporary, join(directory, name))
    } finally {
        rmSync(temporary, {force: true})
    }
    // Publications never overwrite a newer observation, even across processes.
    const names = generations(directory, destinationId, sourceId)
    for (const old of names.slice(2)) rmSync(join(directory, old), {force: true})
    return readPlaceSnapshot(destinationId, sourceId)
}
