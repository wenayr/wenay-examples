import {createPlaceCatalog} from './catalog.ts'
import {createSupplyMiddleware} from './middleware.ts'
import {placeDestinations, placeSources, runtimeSnapshotDirectory} from './places/index.mjs'
import {getPartnerOptions} from './partners/index.ts'
import {createPropertyPhotos} from './property-photos.ts'
import {createCatalogEvents} from './catalog-events.ts'
import {observeCatalogFiles} from './catalog-files.ts'
import {openCatalogStorage} from './catalog-storage.ts'
import {createCatalogImporter} from './catalog-import.ts'

export function createTravelSupply() {
    const photos = createPropertyPhotos({lazy: true})
    const storage = openCatalogStorage({photos})
    const importer = createCatalogImporter()
    const events = createCatalogEvents()
    let stopped = false
    function notify() {
        if (stopped) return
        for (const destination of storage.pollChanges()) events.changed(destination)
    }
    const catalog = createPlaceCatalog({
        destinations: placeDestinations, sources: placeSources, index: storage.index, photo: photos.find,
        afterRefresh: notify, refresh: process.env.TRAVEL_REFRESH_MODE == 'manual' ? undefined : importer.refresh,
    })
    async function reloadSnapshot(destination: string, source: string) {
        if (!storage.sourceCurrent(destination, source)) await importer.syncSource(destination, source)
        if (stopped) return
        catalog.reloadSnapshot(destination, source)
    }
    async function reloadPhotos() {
        if (!storage.photosCurrent()) await importer.syncPhotos()
    }
    const unwatch = observeCatalogFiles({
        photoPath: photos.path, snapshotDirectory: runtimeSnapshotDirectory(),
        reloadPhotos, reloadSnapshot, afterCheck: notify,
    })
    const refresh = setInterval(() => {
        for (const destination of events.activeDestinations()) catalog.refreshActive(destination)
    }, 60_000)
    refresh.unref()
    function shutdown() {
        if (stopped) return
        stopped = true
        unwatch()
        clearInterval(refresh)
        events.close()
        catalog.shutdown()
        storage.close()
        return importer.shutdown()
    }
    function diagnostics() {
        const stats = storage.index.stats()
        return {...stats, writes: stats.writes + importer.writes()}
    }
    return {middleware: createSupplyMiddleware({catalog, events, partners: getPartnerOptions}), diagnostics, shutdown}
}
