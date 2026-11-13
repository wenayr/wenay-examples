import {mkdirSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import type {DatabaseSync} from 'node:sqlite'
import type {SupplyHotel, SupplyPhoto} from '../src/supply-contract.ts'
import {createCatalogIndex} from './catalog-index.ts'
import {placeDestinations, runtimeSnapshotDirectory, snapshotReference} from './places/index.mjs'
import type {createPropertyPhotos} from './property-photos.ts'

export function catalogIndexPath() {
    return resolve(process.env.TRAVEL_CATALOG_INDEX_PATH ?? join(runtimeSnapshotDirectory(), 'catalog.sqlite'))
}

function manifestStamp(path: string) {
    const stat = statSync(path, {bigint: true, throwIfNoEntry: false})
    // v2 restores full attribution from the same file for indexes that stored only display fields.
    return stat && ['v2', path, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}

// The new manifest, affected hotel rows and their region revisions become visible in one commit.
function initializePhotoIndex(db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS photo_manifest(id INTEGER PRIMARY KEY, stamp TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS photo_credits(id TEXT PRIMARY KEY, image TEXT NOT NULL) WITHOUT ROWID`)
    return {
        imageById: db.prepare('SELECT image FROM photo_credits WHERE id=?'),
        readStamp: db.prepare('SELECT stamp FROM photo_manifest WHERE id=1'),
        previous: db.prepare('SELECT id,image FROM photo_credits'),
        put: db.prepare('INSERT OR REPLACE INTO photo_credits(id,image) VALUES(?,?)'),
        remove: db.prepare('DELETE FROM photo_credits WHERE id=?'),
        publishStamp: db.prepare('INSERT OR REPLACE INTO photo_manifest(id,stamp) VALUES(1,?)'),
    }
}

export function openCatalogStorage({photos, prepare = true}: {photos: ReturnType<typeof createPropertyPhotos>, prepare?: boolean}) {
    const path = catalogIndexPath()
    mkdirSync(dirname(path), {recursive: true})
    const index = createCatalogIndex({path, destinations: placeDestinations})
    let imports = 0
    let invalidStamp = ''
    const revisions = new Map<string, number>()

    function close() { index.close() }

    let metadata: ReturnType<typeof initializePhotoIndex>
    function findPhoto(hotel: Pick<SupplyHotel, 'id' | 'wikidataId'>): SupplyPhoto | null {
        const direct = metadata.imageById.get(hotel.id)
        const entity = hotel.wikidataId && 'wikidata:' + hotel.wikidataId
        const row = direct ?? (entity && entity != hotel.id ? metadata.imageById.get(entity) : undefined)
        return row ? JSON.parse(String(row.image)) : null
    }

    function photosCurrent() {
        const stamp = manifestStamp(photos.path)
        return !stamp || stamp == invalidStamp || metadata.readStamp.get()?.stamp == stamp
    }

    function syncPhotos() {
        if (photosCurrent()) return
        index.withPublication(function importManifest() {
            const current = manifestStamp(photos.path)
            if (!current || metadata.readStamp.get()?.stamp == current) return
            let entries
            try {
                entries = photos.readManifest()
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code == 'ENOENT') return
                // A malformed replacement does not revoke previously verified photos, including across restarts.
                if (!metadata.readStamp.get()) throw error
                invalidStamp = current
                console.error('Сохраняем последнюю проверенную версию фотографий:', error)
                return
            }
            // The next poll observes an atomic rename that races this read.
            if (manifestStamp(photos.path) != current) return
            const prior = new Map(metadata.previous.all().map(row => [String(row.id), String(row.image)]))
            const changed: string[] = []
            for (const [id, photo] of entries) {
                const text = JSON.stringify(photo)
                if (prior.get(id) != text) {
                    metadata.put.run(id, text)
                    changed.push(id)
                }
                prior.delete(id)
            }
            for (const id of prior.keys()) {
                metadata.remove.run(id)
                changed.push(id)
            }
            if (changed.length) index.applyPhotos(changed, findPhoto)
            metadata.publishStamp.run(current)
        })
    }

    function sourceCurrent(destination: string, source: string) {
        const reference = snapshotReference(destination, source)
        return index.meta(destination, source)?.generation == reference.generation
    }

    function syncSource(destination: string, source: string) {
        if (sourceCurrent(destination, source)) return false
        return index.withPublication(function importSource() {
            // Re-select under the writer lock so a second server cannot restore an older generation.
            for (let attempt = 0; attempt < 3; attempt++) {
                const current = snapshotReference(destination, source)
                if (index.meta(destination, source)?.generation == current.generation) return false
                try {
                    const data = current.read()
                    imports++
                    return index.replaceSource(destination, source, data, findPhoto, current.generation).changed
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
                }
            }
            throw new Error('Снимок каталога менялся во время подготовки индекса')
        })
    }

    function pollChanges() {
        const changed: string[] = []
        for (const {id} of placeDestinations) {
            const next = index.revision(id)
            if (revisions.has(id) && revisions.get(id) != next) changed.push(id)
            revisions.set(id, next)
        }
        return changed
    }

    try {
        metadata = index.withPublication(initializePhotoIndex)
        if (prepare) {
            syncPhotos()
            for (const region of placeDestinations) {
                for (const source of region.sourceIds) syncSource(region.id, source)
            }
            pollChanges()
        }
        return {index, syncSource, syncPhotos, sourceCurrent, photosCurrent, pollChanges, close, importedSources: () => imports}
    } catch (error) {
        close()
        throw error
    }
}
