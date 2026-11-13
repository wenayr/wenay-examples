import {readFile, mkdir, rename, writeFile, unlink} from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {dirname, resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import type {SupplyPhoto} from '../../src/supply-contract.ts'
import {commonsTitle, isWikidataKey, readImages, readP18, sourceTitle, type CommonsCandidate} from './commons.ts'

export interface ImportTarget {key: string, links: CommonsCandidate[]}
interface PhotoRecord extends SupplyPhoto {
    provider?: string
    externalHotelId?: string
    upstreamPhotoId?: string
    matchedBy?: string
    evidenceUrl?: string
    fileVersion?: string
}
type tManifest = Record<string, PhotoRecord>
type tExclusions = Record<string, string[]>

async function readManifest(path: string): Promise<tManifest> {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'))
        if (!value || Array.isArray(value) || typeof value != 'object') throw new Error('Invalid property photo manifest')
        return value
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code == 'ENOENT') return {}
        throw error
    }
}

async function replaceManifest(path: string, manifest: tManifest) {
    const temp = path + '.' + randomUUID() + '.tmp'
    const sorted = Object.fromEntries(Object.keys(manifest).sort().map(key => [key, manifest[key]]))
    try {
        await writeFile(temp, JSON.stringify(sorted, null, 2) + '\n', {flag: 'wx'})
        await rename(temp, path)
    } finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
            if (error.code != 'ENOENT') throw error
        })
    }
}

function stamp(input: unknown) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

async function resolveBatch(targets: ImportTarget[], initial: tManifest, excluded: tExclusions, fetcher: typeof fetch) {
    const wdTargets = targets.filter(t => !t.links.length && initial[t.key]?.matchedBy != 'manual:verified-property')
    const wd = await readP18(wdTargets.map(t => t.key).filter(isWikidataKey), fetcher)
    const byKey = new Map<string, CommonsCandidate[]>()
    for (const {key, links} of targets) {
        const old = initial[key]
        const candidates = [...links, ...wd.get(key) ?? []]
        if (old?.matchedBy == 'manual:verified-property') {
            const title = sourceTitle(old.sourceUrl)
            const registered = links.find(link => link.title == title && link.matchedBy == old.matchedBy)
            const evidenceUrl = registered?.evidenceUrl ?? old.evidenceUrl ?? old.sourceUrl
            if (title) candidates.unshift({hotelKey: key, title, matchedBy: old.matchedBy, evidenceUrl})
        }
        const omissions = new Set((excluded[key] ?? []).map(value => commonsTitle(value.startsWith('File:') ? value : 'File:' + value)))
        byKey.set(key, candidates.filter(item => !omissions.has(item.title)))
    }
    const titles = new Set(Array.from(byKey.values()).flat().map(candidate => candidate.title))
    const files = await readImages([...titles], fetcher)
    const parsed = new Map<string, PhotoRecord | null>()
    for (const [key, candidates] of byKey) {
        const old = initial[key]
        // Another feed or manually curated non-Commons photo is outside this adapter's authority.
        if (old && !sourceTitle(old.sourceUrl)) continue
        // An explicitly curated file cannot be revoked by an unrelated P18 lookup.
        if (old?.matchedBy?.startsWith('reviewed-') && !candidates.some(c => c.matchedBy.startsWith('reviewed-'))) continue
        // Losing a snapshot is not a confirmed removal of an OSM tag.
        if (!isWikidataKey(key) && !candidates.length) continue
        let best: PhotoRecord | null = null
        for (const candidate of candidates) {
            const file = files.get(candidate.title)
            if (!file) continue
            best = {
                ...file.photo, provider: 'wikimedia-commons', externalHotelId: key, upstreamPhotoId: sourceTitle(file.photo.sourceUrl) ?? candidate.title,
                matchedBy: candidate.matchedBy, evidenceUrl: candidate.evidenceUrl, fileVersion: file.version,
            }
            const sameFile = old && sourceTitle(old.sourceUrl) == best.upstreamPhotoId
            const sameVersion = !old?.fileVersion || old.fileVersion == file.version
            const keepLocal = sameFile && old.url.startsWith('/hotel-photos/') && sameVersion
            if (keepLocal) best.url = old.url
            break
        }
        parsed.set(key, best)
    }
    return parsed
}

interface ImportOptions {
    manifestPath: string
    checkpointPath: string
    targets: ImportTarget[]
    exclusions: tExclusions
    fetcher?: typeof fetch
    force?: boolean
    dryRun?: boolean
    limit?: number
    now?: number
    onProgress?: (attempted: number, changes: number) => void
}

const refreshAfter = 14 * 24 * 3600_000
const batchSize = 20

export async function runPhotoImport(options: ImportOptions) {
    const {manifestPath, checkpointPath, exclusions, dryRun = false, force = false} = options
    const now = options.now ?? Date.now()
    const summary = {eligible: options.targets.length, attempted: 0, skippedFresh: 0, added: 0, updated: 0, removed: 0, unchanged: 0}
    let journal: DatabaseSync | undefined
    if (!dryRun) {
        await mkdir(dirname(checkpointPath), {recursive: true})
        await mkdir(dirname(manifestPath), {recursive: true})
        journal = new DatabaseSync(checkpointPath)
    } else {
        try {
            journal = new DatabaseSync(checkpointPath, {readOnly: true})
        } catch (error) {
            if ((error as {errcode?: number}).errcode != 14) throw error
        }
    }
    try {
        if (!dryRun) {
            journal!.exec('PRAGMA busy_timeout=5000')
            journal!.exec('CREATE TABLE IF NOT EXISTS checked (id TEXT PRIMARY KEY, stamp TEXT NOT NULL, checked_at INTEGER NOT NULL)')
        }
        const read = journal?.prepare('SELECT stamp, checked_at FROM checked WHERE id=?')
        const save = dryRun ? null : journal!.prepare('INSERT OR REPLACE INTO checked(id,stamp,checked_at) VALUES(?,?,?)')
        const path = resolve(manifestPath)
        let current = await readManifest(manifestPath)
        const dirty = []
        const inputStamp = (t: ImportTarget, manifest: tManifest) => stamp([t.links, exclusions[t.key] ?? [], manifest[t.key] ?? null])
        for (const target of options.targets) {
            const checked = read?.get(path + '#' + target.key)
            if (!force && checked?.stamp == inputStamp(target, current) && Number(checked?.checked_at) > now - refreshAfter) {
                summary.skippedFresh++
                continue
            }
            dirty.push(target)
            if (dirty.length == options.limit) break
        }
        for (let offset = 0; offset < dirty.length; offset += batchSize) {
            const batch = dirty.slice(offset, offset + batchSize)
            const before = current
            const changes = await resolveBatch(batch, before, exclusions, options.fetcher ?? fetch)
            if (!dryRun) journal!.exec('BEGIN IMMEDIATE')
            try {
                // All imports for this manifest share a checkpoint DB. SQLite releases this
                // short writer lock automatically if an importer is interrupted.
                current = dryRun ? {...before} : await readManifest(manifestPath)
                let changed = false
                for (const target of batch) {
                    const key = target.key
                    if (stamp(before[key] ?? null) != stamp(current[key] ?? null)) throw new Error('Concurrent photo change: ' + key + '; rerun')
                    const next = changes.get(key)
                    if (next === undefined || stamp(current[key] ?? null) == stamp(next)) {
                        summary.unchanged++
                    } else if (!next) {
                        delete current[key]
                        changed = true
                        summary.removed++
                    } else {
                        if (current[key]) summary.updated++
                        else summary.added++
                        current[key] = next
                        changed = true
                    }
                    save?.run(path + '#' + key, inputStamp(target, current), now)
                }
                if (changed && !dryRun) await replaceManifest(manifestPath, current)
                if (!dryRun) journal!.exec('COMMIT')
            } catch (error) {
                if (!dryRun) journal!.exec('ROLLBACK')
                throw error
            }
            summary.attempted += batch.length
            options.onProgress?.(summary.attempted, summary.added + summary.updated + summary.removed)
        }
        return summary
    } finally {
        journal?.close()
    }
}
