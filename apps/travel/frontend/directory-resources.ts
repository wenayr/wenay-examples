import {createReconciler} from 'wenay-common2/client'
import {LISTEN_DISPATCH_ERROR, listenStore} from 'wenay-common2/listen'
import {
    canonicalDirectoryResource, packageLiveDemand, packageLiveRoute, packageLiveLimits,
    type PackageLiveCapability, type PackageLiveChange,
} from '../src/package-live-contract.ts'

export interface DirectoryResourceState {key: string, data?: unknown, error?: string, loading: boolean}
interface EventConnection {
    close: () => void
    addEventListener: (type: string, listener: (event: Event) => void) => void
    onopen: ((event: Event) => unknown) | null
    onerror: ((event: Event) => unknown) | null
}
interface ResourceEntry {
    state: DirectoryResourceState
    refs: number
    checked: number
    nextAt: number
    version: string | null
    force: boolean
    owner?: ReturnType<typeof createReconciler<boolean>>
    emit: (state: DirectoryResourceState) => void
    changes: ReturnType<typeof listenStore<[DirectoryResourceState]>>[1]
}

const defaultFreshness = 120_000
function responseSchedule(data: unknown, now: number) {
    if (!data || typeof data != 'object') return now + defaultFreshness
    const value = data as {source?: {retryAt?: string, updatedAt?: string, status?: string, stale?: boolean},
        cells?: {retryAt?: string, checkedAt?: string, status?: string}[]}
    const retries = [value.source?.retryAt, ...(value.cells ?? []).map(cell => cell.retryAt)]
    const retryTimes = retries.map(time => Date.parse(time ?? '')).filter(time => Number.isFinite(time) && time > now)
    if (retryTimes.length) return Math.max(...retryTimes)
    const incomplete = value.source?.status == 'unavailable' || value.source?.stale
        || value.cells?.some(cell => cell.status == 'unknown' || cell.status == 'failed')
    if (incomplete) return now + 10_000
    const checked = [value.source?.updatedAt, ...(value.cells ?? []).map(cell => cell.checkedAt)]
    const times = checked.map(time => Date.parse(time ?? '')).filter(Number.isFinite)
    return times.length ? Math.max(now + 1_000, Math.min(...times) + defaultFreshness) : now + defaultFreshness
}

function errorMessage(body: unknown, status: number) {
    const hasMessage = body && typeof body == 'object' && 'error' in body && typeof body.error == 'string'
    if (hasMessage) return body.error as string
    return 'Не удалось получить данные каталога. HTTP ' + status
}

export function createDirectoryResources(deps: {
    fetch: typeof fetch
    connect?: (url: string) => EventConnection | null
    now?: () => number
    maxEntries?: number
}) {
    const now = deps.now ?? Date.now
    const entries = new Map<string, ResourceEntry>()
    const maxEntries = deps.maxEntries ?? 96
    let visible = true
    let online = true
    let closed = false
    let connection: EventConnection | null = null
    let descriptor = ''
    let openedAt = 0
    let lastEventAt = 0
    let nextProbeAt = 0
    let heartbeatMs = 20_000
    let pollIntervalMs = 10_000
    let transportState = {mode: 'inactive', reason: '', resources: 0, resets: 0, epoch: '', profile: 'unknown'}
    let listenerErrors = 0
    function listenerFailed() { listenerErrors++ }
    const [emitTransport, transportChanges] = listenStore<[typeof transportState]>({
        current: () => [transportState], [LISTEN_DISPATCH_ERROR]: listenerFailed,
    })

    function mode(mode: string, reason = '') {
        const resources = activeKeys().length
        const unchanged = transportState.mode == mode && transportState.reason == reason && transportState.resources == resources
        if (unchanged) return
        transportState = {...transportState, mode, reason, resources}
        emitTransport(transportState)
    }
    function activeKeys() {
        if (!visible || !online || closed) return []
        return [...entries].filter(([key, entry]) => entry.refs > 0 && Boolean(packageLiveRoute(key))).map(([key]) => key).sort()
    }
    function disconnect() {
        connection?.close()
        connection = null
        descriptor = ''
    }
    function update(entry: ResourceEntry, patch: Partial<DirectoryResourceState>) {
        entry.state = {...entry.state, ...patch}
        entry.emit(entry.state)
    }
    function request(entry: ResourceEntry, force = false) {
        if (force) entry.force = true
        entry.owner?.control.request()
    }
    function automatic() {
        return transportState.profile == 'demand' || transportState.profile == 'economy'
    }
    function restPolicy(response: Response) {
        const profile = response.headers.get('x-travel-update-profile')
        if (profile == null) return
        const known = ['demand', 'request-only', 'economy'].some(value => value == profile)
        const interval = Number(response.headers.get('x-travel-shared-check-ms'))
        if (Number.isFinite(interval) && interval > 0) pollIntervalMs = Math.max(1_000, Math.min(120_000, interval))
        transportState = {...transportState, profile: known ? profile : 'unknown'}
        emitTransport(transportState)
    }
    function eventData(event: Event): unknown {
        try { return JSON.parse((event as MessageEvent<string>).data ?? '') } catch { return null }
    }
    function received() {
        lastEventAt = now()
        mode('sse')
        transport.control.request()
    }
    function changed(event: Event) {
        const data = eventData(event) as Partial<PackageLiveChange> | null
        if (!data || typeof data.key != 'string' || typeof data.version != 'string') return
        if (data.key.length > 4_000 || data.version.length > 160) return
        let key: string
        try { key = canonicalDirectoryResource(data.key) } catch { return }
        const entry = entries.get(key)
        if (!entry || !entry.refs || entry.version == data.version) return
        entry.version = data.version
        request(entry)
        received()
    }
    function reset(event: Event) {
        const data = eventData(event) as {epoch?: unknown} | null
        if (!data || typeof data.epoch != 'string' || data.epoch.length > 160) return
        transportState = {...transportState, resets: transportState.resets + 1, epoch: data.epoch}
        emitTransport(transportState)
        for (const key of activeKeys()) {
            const entry = entries.get(key)!
            entry.version = null
            request(entry)
        }
        transport.control.request()
    }
    function heartbeat(event: Event) {
        const data = eventData(event) as {now?: unknown} | null
        if (!data || typeof data.now != 'number' || !Number.isFinite(data.now)) return
        received()
    }
    function capability(event: Event) {
        const data = eventData(event) as Partial<PackageLiveCapability> | null
        const validProfile = data && ['demand', 'request-only', 'economy'].some(profile => data.profile == profile)
        const validTimes = data && Number.isFinite(data.heartbeatMs) && Number.isFinite(data.pollIntervalMs)
        const validCapability = data && data.transport == 'sse' && validProfile && validTimes
        if (!validCapability) return
        heartbeatMs = Math.max(5_000, Math.min(60_000, data.heartbeatMs!))
        pollIntervalMs = Math.max(1_000, Math.min(120_000, data.pollIntervalMs!))
        transportState = {...transportState, profile: data.profile!}
        emitTransport(transportState)
        received()
        mode('sse')
    }
    function fallback(reason: string) {
        disconnect()
        nextProbeAt = now() + 60_000
        mode('http-fallback', reason)
    }

    const transport = createReconciler({
        read: activeKeys,
        run: async function reconcile(keys, {retry}) {
            if (!keys.length) {
                disconnect()
                mode(online ? 'inactive' : 'offline')
                return
            }
            let nextDescriptor: string
            try {
                nextDescriptor = JSON.stringify(packageLiveDemand(keys))
            } catch {
                fallback('demand-limit')
                nextDescriptor = ''
            }
            const timestamp = now()
            const probeDue = transportState.mode != 'http-fallback' || timestamp >= nextProbeAt
            const needsConnection = nextDescriptor && probeDue && (!connection || descriptor != nextDescriptor)
            if (needsConnection) {
                disconnect()
                const query = new URLSearchParams({demand: nextDescriptor})
                const streamUrl = '/api/travel/package-events?' + query
                const permitted = streamUrl.length < packageLiveLimits.urlBytes
                const stream = permitted ? deps.connect?.(streamUrl) ?? null : null
                if (stream) {
                    connection = stream
                    descriptor = nextDescriptor
                    openedAt = timestamp
                    lastEventAt = 0
                    mode('connecting')
                    stream.onopen = function opened() {
                        if (connection != stream) return
                        transport.control.request()
                    }
                    stream.onerror = function interrupted() {
                        if (connection == stream) transport.control.request()
                    }
                    function listen(type: string, listener: (event: Event) => void) {
                        stream!.addEventListener(type, function currentConnection(event) {
                            if (connection == stream) listener(event)
                        })
                    }
                    listen('resource', changed)
                    listen('reset', reset)
                    listen('capability', capability)
                    listen('heartbeat', heartbeat)
                } else fallback(permitted ? 'eventsource-unavailable' : 'demand-limit')
            }
            if (connection) {
                const deadline = lastEventAt ? lastEventAt + heartbeatMs * 2 + 5_000 : openedAt + 8_000
                if (timestamp >= deadline) fallback('stream-unavailable')
                else {
                    retry('transport', Math.max(1, deadline - timestamp))
                    return
                }
            }
            if (transportState.mode == 'http-fallback') {
                let nextAt = automatic() ? Math.min(nextProbeAt, timestamp + pollIntervalMs) : nextProbeAt
                for (const key of keys) {
                    const entry = entries.get(key)!
                    const due = !entry.state.loading && entry.nextAt <= timestamp && automatic()
                    if (due) request(entry)
                    if (automatic()) nextAt = Math.min(nextAt, Math.max(timestamp + 1_000, entry.nextAt))
                }
                retry('transport', Math.max(1, nextAt - timestamp))
            }
        },
    })

    function prune() {
        for (const [key, entry] of entries) {
            if (entries.size < maxEntries) break
            if (entry.refs) continue
            entry.changes.close()
            entries.delete(key)
        }
    }
    function entryFor(input: string) {
        const key = canonicalDirectoryResource(input)
        let entry = entries.get(key)
        if (entry) return entry
        prune()
        let state: DirectoryResourceState = {key, loading: true}
        const [emit, changes] = listenStore<[DirectoryResourceState]>({current: () => [state], [LISTEN_DISPATCH_ERROR]: listenerFailed})
        entry = {state, refs: 0, checked: 0, nextAt: 0, version: null, force: false, changes,
            emit: function commit(value) {
                state = value
                emit(value)
            }}
        entries.set(key, entry)
        return entry
    }
    function activate(entry: ResourceEntry) {
        const key = entry.state.key
        const owner = createReconciler({
            read: () => entry.force,
            run: async function load(force, {signal}) {
                entry.force = false
                update(entry, {loading: true, error: undefined})
                const separator = key.includes('?') ? '&' : '?'
                const url = force ? key + separator + 'refresh=1' : key
                try {
                    const response = await deps.fetch(url, {signal})
                    const body: unknown = await response.json().catch(() => null)
                    if (signal.aborted || entry.owner != owner) return
                    restPolicy(response)
                    if (!response.ok || body == null) {
                        entry.nextAt = now() + 10_000
                        update(entry, {error: errorMessage(body, response.status), loading: false})
                    } else {
                        entry.checked = now()
                        entry.nextAt = responseSchedule(body, entry.checked)
                        update(entry, {data: body, error: undefined, loading: false})
                    }
                } catch {
                    if (signal.aborted || entry.owner != owner) return
                    entry.nextAt = now() + 10_000
                    update(entry, {error: 'Не удалось получить данные каталога.', loading: false})
                }
                transport.control.request()
            },
        })
        entry.owner = owner
        const due = !entry.checked || entry.nextAt <= now() || entry.state.loading
        if (due) request(entry)
    }
    function resource(input: string) {
        const entry = entryFor(input)
        function on(...[callback, options]: Parameters<typeof entry.changes.on>) {
            if (closed) return () => {}
            entry.refs++
            if (entry.refs == 1) activate(entry)
            const off = entry.changes.on(callback, options)
            transport.control.request()
            let active = true
            return function unsubscribe() {
                if (!active) return
                active = false
                off()
                entry.refs--
                if (!entry.refs) {
                    const owner = entry.owner
                    entry.owner = undefined
                    void owner?.close()
                }
                transport.control.request()
            }
        }
        return {
            view: {snapshot: () => entry.state},
            events: {on},
            control: {retry: () => request(entry), refresh: () => request(entry, true)},
        }
    }
    function setVisible(value: boolean) {
        if (visible == value) return
        visible = value
        if (value && automatic()) {
            for (const entry of entries.values()) if (entry.refs && entry.nextAt <= now()) request(entry)
        }
        transport.control.request()
    }
    async function close() {
        closed = true
        disconnect()
        await transport.close()
        await Promise.all([...entries.values()].map(entry => entry.owner?.close()))
        for (const entry of entries.values()) entry.changes.close()
        entries.clear()
        transportChanges.close()
    }
    function setOnline(value: boolean) {
        if (online == value) return
        online = value
        if (value) nextProbeAt = 0
        transport.control.request()
    }
    return {
        source: {resource},
        control: {visible: setVisible, online: setOnline},
        events: {transport: transportChanges.on},
        health: {transport: () => transportState, active: activeKeys, listenerErrors: () => listenerErrors},
        resource: {close},
    }
}
export type DirectoryResources = ReturnType<typeof createDirectoryResources>
