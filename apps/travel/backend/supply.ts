import {createPlaceCatalog} from './catalog.ts'
import {createSupplyMiddleware} from './middleware.ts'
import {placeDestinations, placeSources, readPlaceSnapshot, refreshPlaceDestination} from './places/index.mjs'
import {getPartnerOptions} from './partners/index.ts'
import {findPropertyPhoto} from './property-photos.ts'

export function createTravelSupply() {
    const catalog = createPlaceCatalog({
        destinations: placeDestinations, sources: placeSources,
        readSnapshot: readPlaceSnapshot, refresh: refreshPlaceDestination, photo: findPropertyPhoto,
    })
    return {middleware: createSupplyMiddleware({catalog, partners: getPartnerOptions}), shutdown: catalog.shutdown}
}
