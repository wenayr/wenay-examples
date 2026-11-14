import {localStorageCache} from 'wenay-react2/persist'
import {restoreTrip, type TripState} from './model.ts'

const key = 'wenay.travel.trip.v1'
export function createTripStorage(notify: (state: TripState, temporary: boolean) => void) {
    let current = restoreTrip(null)
    let temporary = false
    let queue = Promise.resolve()
    async function read() {
        try {
            if (!temporary) current = restoreTrip(await localStorageCache.get(key))
        } catch {
            temporary = true
        }
    }
    function refresh() {
        queue = queue.then(async () => {
            await read()
            notify(current, temporary)
        })
    }
    function edit(change: (state: TripState) => TripState) {
        async function write() {
            await read()
            current = change(current)
            try {
                temporary = !await localStorageCache.set(key, current)
            } catch {
                temporary = true
            }
            notify(current, temporary)
        }
        queue = queue.then(async () => {
            if (navigator.locks) {
                try {
                    await navigator.locks.request(key, write)
                    return
                } catch {
                    // Some frames can access localStorage but have no permission to acquire browser locks.
                }
            }
            await write()
        })
    }
    function changed(event: StorageEvent) {
        if (event.key == key || event.key === null) refresh()
    }
    return {refresh, edit, changed}
}
