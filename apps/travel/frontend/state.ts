import {createStore} from 'wenay-common2/observe'
import {createPreferences, initialSelection} from './preferences.ts'
import type {TravelSelection} from './preferences.ts'

export function createTravelSearch(
    initial = initialSelection(),
    preferences = createPreferences(),
) {
    const store = createStore(initial)

    function select(next: TravelSelection) {
        store.node.search.replace(next.search)
        store.node.hotelId.set(next.hotelId)
        store.node.offerId.set(next.offerId)
        void preferences.save(next)
    }

    function reset() {
        const fresh = initialSelection()
        store.node.search.replace(fresh.search)
        store.node.hotelId.set('')
        store.node.offerId.set('')
        void preferences.clear()
    }

    return {node: store.node, select, reset}
}
