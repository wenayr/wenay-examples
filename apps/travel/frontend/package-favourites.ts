import {useEffect} from 'react'
import {createStore} from 'wenay-common2/observe'
import {useStoreNode} from 'wenay-react2/react'
import {localStorageCache, type CacheStorage} from 'wenay-react2/persist'

export const packageFavouriteLevels = {
    0: {label: 'Без отметки', color: '#73827c'},
    1: {label: 'Интересно', color: '#24758a'},
    2: {label: 'Нравится', color: '#aa6a1b'},
    3: {label: 'Приоритет', color: '#a23e61'},
} as const satisfies Record<number, {label: string, color: string}>

export type tPackageFavouriteLevel = keyof typeof packageFavouriteLevels
export interface PackageFavouriteState {version: 1, levels: Record<string, tPackageFavouriteLevel>}
const storageKey = 'wenay.travel.package-favourites.v1'

function object(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value == 'object' && !Array.isArray(value)
}

function hotelKey(value: string) {
    return /^[a-z][a-z0-9-]{0,39}:[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value)
}

function savedLevel(value: unknown): value is tPackageFavouriteLevel {
    if (typeof value != 'number' || !Number.isInteger(value)) return false
    return value >= 1 && value <= 3
}

export function restorePackageFavourites(raw: unknown): PackageFavouriteState {
    if (!object(raw) || raw.version != 1 || !object(raw.levels)) return {version: 1, levels: {}}
    const entries = Object.entries(raw.levels).filter(([id, level]) => hotelKey(id) && savedLevel(level))
    return {version: 1, levels: Object.fromEntries(entries) as PackageFavouriteState['levels']}
}

export function setPackageFavourite(state: PackageFavouriteState, hotelId: string, level: tPackageFavouriteLevel): PackageFavouriteState {
    if (!hotelKey(hotelId) || !Object.hasOwn(packageFavouriteLevels, level)) return state
    if ((state.levels[hotelId] ?? 0) == level) return state
    const levels = {...state.levels}
    if (level) levels[hotelId] = level
    else delete levels[hotelId]
    return {...state, levels}
}

export function createPackageFavourites(deps: {
    storage: Pick<CacheStorage, 'get' | 'set'>
    lock?: (write: () => Promise<void>) => Promise<void>
}) {
    let current = restorePackageFavourites(null)
    let temporary = false
    let queue = Promise.resolve()
    const store = createStore({levels: current.levels, ready: false, temporary})

    function publish() {
        store.node.replace({levels: current.levels, ready: true, temporary})
    }

    async function read() {
        if (temporary) return
        try {
            current = restorePackageFavourites(await deps.storage.get(storageKey))
        } catch {
            temporary = true
        }
    }

    function refresh() {
        async function load() {
            await read()
            publish()
        }
        queue = queue.then(load, load)
        return queue
    }

    function setLevel(hotelId: string, level: tPackageFavouriteLevel) {
        async function write() {
            await read()
            current = setPackageFavourite(current, hotelId, level)
            try {
                temporary = !await deps.storage.set(storageKey, current)
            } catch {
                temporary = true
            }
            publish()
        }
        async function change() {
            if (deps.lock) await deps.lock(write)
            else await write()
        }
        queue = queue.then(change, change)
        return queue
    }

    function changed(event: Pick<StorageEvent, 'key'>) {
        if (event.key == storageKey || event.key == null) void refresh()
    }

    return {node: store.node, refresh, setLevel, changed}
}

async function browserLock(write: () => Promise<void>) {
    if (!navigator.locks) return write()
    let started = false
    try {
        await navigator.locks.request(storageKey, async function locked() {
            started = true
            await write()
        })
    } catch (error) {
        if (started) throw error
        await write()
    }
}

const favourites = createPackageFavourites({storage: localStorageCache, lock: browserLock})

export function usePackageFavourites() {
    const view = useStoreNode(favourites.node, {mode: 'snapshot'}).value
    useEffect(() => {
        void favourites.refresh()
        window.addEventListener('storage', favourites.changed)
        return () => window.removeEventListener('storage', favourites.changed)
    }, [])
    return {...view, setLevel: favourites.setLevel}
}
