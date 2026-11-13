import {readdirSync, statSync} from 'node:fs'
import {placeDestinations, snapshotRegion} from './places/index.mjs'

interface FileUpdates {
    photoPath: string
    snapshotDirectory: string
    afterCheck: () => void
    reloadPhotos: () => Promise<void>
    reloadSnapshot: (destination: string, source: string) => Promise<void>
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

    let photo: string | undefined
    let snapshots: ReturnType<typeof generations> | undefined
    let pending = false
    let stopped = false
    async function check() {
        const stamp = photoStamp()
        const latest = generations()
        if (stamp != photo) {
            await deps.reloadPhotos()
            photo = stamp
        }
        if (!snapshots) {
            // Close the gap between initial preparation and observing external publications.
            for (const region of placeDestinations) {
                for (const source of region.sourceIds) {
                    if (stopped) return
                    await deps.reloadSnapshot(region.id, source)
                }
            }
        } else {
            const dirty = new Set([...latest.keys(), ...snapshots.keys()])
            for (const key of dirty) {
                if (stopped) return
                const before = snapshots.get(key)
                const after = latest.get(key)
                if (before?.filename == after?.filename) continue
                const changed = after ?? before!
                await deps.reloadSnapshot(changed.destination, changed.source)
            }
        }
        snapshots = latest
    }

    function failed(error: unknown) {
        if (!stopped) console.error('Не удалось перечитать файлы каталога:', error)
    }
    function poll() {
        if (pending) {
            try { deps.afterCheck() } catch (error) { failed(error) }
            return
        }
        pending = true
        void check().then(() => {
            if (!stopped) deps.afterCheck()
        }).catch(failed).finally(() => { pending = false })
    }
    poll()
    const timer = setInterval(poll, 1_200)
    timer.unref()
    return () => {
        stopped = true
        clearInterval(timer)
    }
}
