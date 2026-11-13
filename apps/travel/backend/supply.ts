import {createPlaceCatalog} from './catalog.ts'
import {createSupplyMiddleware} from './middleware.ts'
import {placeDestinations, placeSources, readPlaceSnapshot, refreshAndSavePlaceDestination, runtimeSnapshotDirectory} from './places/index.mjs'
import {getPartnerOptions} from './partners/index.ts'
import {createPropertyPhotos} from './property-photos.ts'
import {createCatalogEvents} from './catalog-events.ts'
import {observeCatalogFiles} from './catalog-files.ts'

export function createTravelSupply() {
    const photos = createPropertyPhotos({})
    const events = createCatalogEvents()
    const catalog = createPlaceCatalog({
        destinations: placeDestinations, sources: placeSources, onChange: events.changed,
        readSnapshot: readPlaceSnapshot, photo: photos.find,
        refresh: process.env.TRAVEL_REFRESH_MODE == 'manual' ? undefined : refreshAndSavePlaceDestination,
    })
    const unwatch = observeCatalogFiles({
        photoPath: photos.path, snapshotDirectory: runtimeSnapshotDirectory(),
        reloadPhotos: () => catalog.invalidatePhotos(photos.reload()), reloadSnapshot: catalog.reloadSnapshot,
    })
    const refresh = setInterval(() => {
        for (const destination of events.activeDestinations()) catalog.refreshActive(destination)
    }, 60_000)
    refresh.unref()
    function shutdown() {
        unwatch()
        clearInterval(refresh)
        events.close()
        catalog.shutdown()
    }
    return {middleware: createSupplyMiddleware({catalog, events, partners: getPartnerOptions}), shutdown}
}
