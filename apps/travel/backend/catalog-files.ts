import {readdirSync, statSync} from 'node:fs'
import {snapshotRegion} from './places/index.mjs'

interface FileUpdates {
    photoPath: string
    snapshotDirectory: string
    reloadPhotos: () => void
    reloadSnapshot: (destination: string, source: string) => void
}

// Polling the parent covers atomic renames, directory creation after startup and dropped OS watch notifications.
export function observeCatalogFiles(deps: FileUpdates) {
    function photoStamp() {
        try {
            const stat = statSync(deps.photoPath, {bigint: true})
            return [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code == 'ENOENT') return ''
            throw err
        }
    }

    function generations() {
        const latest = new Map<string, {filename: string, destination: string, source: string}>()
        let files: string[]
        try { files = readdirSync(deps.snapshotDirectory) } catch (error) {
            if ((error as NodeJS.ErrnoException).code == 'ENOENT') return latest
            throw error
        }
        for (const filename of files) {
            const region = snapshotRegion(filename)
            if (!region) continue
            const key = region.destinationId + ':' + region.sourceId
            if (filename <= (latest.get(key)?.filename ?? '')) continue
            latest.set(key, {filename, destination: region.destinationId, source: region.sourceId})
        }
        return latest
    }

    let photo = photoStamp()
    let snapshots = generations()
    // Reconcile an external rename between the initial manifest read and watcher setup.
    if (photo) deps.reloadPhotos()
    function check() {
        const stamp = photoStamp()
        if (stamp != photo) {
            deps.reloadPhotos()
            photo = stamp
        }
        const latest = generations()
        const dirty = new Set([...latest.keys(), ...snapshots.keys()])
        for (const key of dirty) {
            const before = snapshots.get(key)
            const after = latest.get(key)
            if (before?.filename == after?.filename) continue
            const changed = after ?? before!
            deps.reloadSnapshot(changed.destination, changed.source)
        }
        snapshots = latest
    }
    const timer = setInterval(() => {
        try { check() } catch (error) { console.error('Не удалось перечитать файлы каталога:', error) }
    }, 1_200)
    timer.unref()
    return () => clearInterval(timer)
}
