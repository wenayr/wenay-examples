import {useEffect} from 'react'
import {createStore} from 'wenay-common2/observe'
import {useStoreNode} from 'wenay-react2/react'
import {localStorageCache, type CacheStorage} from 'wenay-react2/persist'

const storageKey = 'wenay.travel.map-display.v1'

export function restoreMapDisplayPreferences(raw: unknown) {
    const state = {version: 1 as const, showLabels: false}
    if (!raw || typeof raw != 'object') return state
    if ('version' in raw && raw.version != 1) return state
    if ('showLabels' in raw && typeof raw.showLabels == 'boolean') state.showLabels = raw.showLabels
    return state
}

export function createMapDisplayPreferences(deps: {storage: Pick<CacheStorage, 'get' | 'set'>}) {
    let current = restoreMapDisplayPreferences(null)
    let temporary = false
    let queue = Promise.resolve()
    const store = createStore({showLabels: current.showLabels, ready: false, temporary})

    function publish() {
        store.node.replace({showLabels: current.showLabels, ready: true, temporary})
    }

    function refresh() {
        async function read() {
            if (!temporary) {
                try {
                    current = restoreMapDisplayPreferences(await deps.storage.get(storageKey))
                } catch {
                    temporary = true
                }
            }
            publish()
        }
        queue = queue.then(read, read)
        return queue
    }

    function setShowLabels(showLabels: boolean) {
        async function write() {
            current = {...current, showLabels}
            try {
                temporary = !await deps.storage.set(storageKey, current)
            } catch {
                temporary = true
            }
            publish()
        }
        queue = queue.then(write, write)
        return queue
    }

    function changed(event: Pick<StorageEvent, 'key'>) {
        if (event.key == storageKey || event.key == null) void refresh()
    }

    return {node: store.node, refresh, setShowLabels, changed}
}

const preferences = createMapDisplayPreferences({storage: localStorageCache})

export function useMapDisplayPreferences() {
    const state = useStoreNode(preferences.node, {mode: 'snapshot'}).value
    useEffect(() => {
        void preferences.refresh()
        window.addEventListener('storage', preferences.changed)
        return () => window.removeEventListener('storage', preferences.changed)
    }, [])
    return {...state, setShowLabels: preferences.setShowLabels}
}
