import {createReconciler} from 'wenay-common2/client'
import {listenStore} from 'wenay-common2/listen'
import {replayListen} from 'wenay-common2/replay'
import {canonicalDirectoryResource, packageLiveLimits, packageLiveResources, packageLiveRoute,
    type PackageLiveCapability, type PackageLiveChange} from '../src/package-live-contract.ts'
import type {ProviderBufferConfig} from './provider-buffer-config.ts'

interface ResourceSnapshot {change: PackageLiveChange | null, signature: string | null}
interface ResourceEntry {
    key: string
    request: Request
    refs: number
    snapshot: ResourceSnapshot
    emit: (snapshot: ResourceSnapshot) => void
    line: ReturnType<typeof listenStore<[ResourceSnapshot]>>[1]
    work: ReturnType<typeof createReconciler<string>> | null
}
interface StreamSink {send: (name: string, data: unknown, id?: string) => void, close: () => void}
interface Channel {
    id: string
    scope: string
    keys: string[]
    request: Request
    push: ReturnType<typeof replayListen<[PackageLiveChange]>>[0]
    line: ReturnType<typeof replayListen<[PackageLiveChange]>>[1]
    clients: Set<StreamSink>
    off: (() => void)[]
    heartbeat: ReturnType<typeof setInterval> | null
    touchedAt: number
}

const endpoint = '/api/travel/package-events'
const maxClients = 128
const maxResources = 192
const maxChannels = 32
const heartbeatMs = 20_000
const encoder = new TextEncoder()
class LiveCapacityError extends Error {}

async function digest(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

function retryAt(value: unknown) {
    if (!value || typeof value != 'object') return null
    const source = 'source' in value ? value.source : null
    if (!source || typeof source != 'object' || !('retryAt' in source)) return null
    const date = source.retryAt
    return typeof date == 'string' && Number.isFinite(Date.parse(date)) ? date : null
}

function json(status: number, error: string, headers: Record<string, string> = {}) {
    return Response.json({error}, {status, headers: {'cache-control': 'no-store', ...headers}})
}

function projectionRequest(key: string, request: Request) {
    const headers = new Headers()
    const owner = request.headers.get('oai-authenticated-user-id')?.trim()
    if (owner && owner.length <= 512) headers.set('oai-authenticated-user-id', owner)
    return new Request(new URL(key, request.url), {headers})
}

// This owner supplies only public price-resource invalidations. Agency records, leads and
// supplier credentials are never a subscription payload or part of an exported health trace.
export function createPackageLive(deps: {
    read: (request: Request) => Promise<Response | null>
    scope: (request: Request) => Promise<string>
    config: ProviderBufferConfig
    now?: () => number
    limits?: {clients?: number, resources?: number, channels?: number}
}) {
    const now = deps.now ?? Date.now
    const epoch = crypto.randomUUID()
    const capacity = {
        clients: Math.min(maxClients, deps.limits?.clients ?? maxClients),
        resources: Math.min(maxResources, deps.limits?.resources ?? maxResources),
        channels: Math.min(maxChannels, deps.limits?.channels ?? maxChannels),
    }
    const resources = new Map<string, ResourceEntry>()
    const channels = new Map<string, Channel>()
    let clients = 0
    let openingClients = 0
    let reads = 0
    let errors = 0
    let changes = 0

    function resourceKey(scope: string, key: string) { return scope + '\n' + key }

    async function commit(entry: ResourceEntry, response: Response) {
        const text = await response.text()
        let value: unknown = null
        try { value = JSON.parse(text) } catch { /* An HTTP failure still invalidates the resource. */ }
        // A retry estimate can move by milliseconds on a read while another replica owns
        // the lease. Coarse hints prevent an invalidation -> HTTP -> invalidation loop.
        // Original timestamps and exact hints in the HTTP payload are unchanged.
        const semantic = JSON.stringify(value, function fingerprint(key, item) {
            if (key == 'retryAt' && typeof item == 'string' && Number.isFinite(Date.parse(item))) {
                const step = Math.max(1_000, deps.config.sharedCheckMs)
                return Math.ceil(Date.parse(item) / step) * step
            }
            if (key == 'status' && (item == 'live' || item == 'cached')) return 'observed'
            return item
        })
        const signature = await digest(response.status + ':' + (semantic ?? text))
        if (signature == entry.snapshot.signature) return
        const change = {key: entry.key, version: signature, retryAt: retryAt(value)} satisfies PackageLiveChange
        entry.snapshot = {signature, change}
        changes++
        entry.emit(entry.snapshot)
    }

    function trimResources(required = 1) {
        if (resources.size + required <= capacity.resources) return
        for (const [key, entry] of resources) {
            if (entry.refs) continue
            entry.line.close()
            resources.delete(key)
            if (resources.size + required <= capacity.resources) return
        }
        throw new LiveCapacityError('Слишком много активных областей обновления цен.')
    }

    function entryFor(scope: string, key: string, request: Request) {
        const identity = resourceKey(scope, key)
        const existing = resources.get(identity)
        if (existing) {
            existing.request = projectionRequest(key, request)
            return existing
        }
        trimResources()
        const snapshot: ResourceSnapshot = {change: null, signature: null}
        const [emit, line] = listenStore<[ResourceSnapshot]>({current: () => [entry.snapshot]})
        const entry: ResourceEntry = {
            key, request: projectionRequest(key, request), refs: 0, snapshot, emit, line, work: null,
        }
        resources.set(identity, entry)
        return entry
    }

    function start(entry: ResourceEntry) {
        if (entry.work) return
        const work = createReconciler({
            read: () => entry.key,
            async run(_key, context) {
                try {
                    reads++
                    const request = new Request(entry.request, {signal: context.signal})
                    const response = await deps.read(request)
                    if (response && !context.signal.aborted) await commit(entry, response)
                } catch (error) {
                    if (!context.signal.aborted) errors++
                } finally {
                    if (deps.config.automatic && entry.refs && !context.signal.aborted) {
                        context.retry('shared-snapshot', deps.config.sharedCheckMs)
                    }
                }
            },
        })
        entry.work = work
        work.control.request()
    }

    function subscribe(scope: string, key: string, request: Request, callback: (change: PackageLiveChange) => void) {
        const entry = entryFor(scope, key, request)
        entry.refs++
        const off = entry.line.on(snapshot => { if (snapshot.change) callback(snapshot.change) }, {current: true})
        start(entry)
        let closed = false
        return function unsubscribe() {
            if (closed) return
            closed = true
            off()
            entry.refs--
            if (entry.refs || !entry.work) return
            const work = entry.work
            entry.work = null
            entry.request = new Request(new URL(entry.key, entry.request.url))
            void work.close()
        }
    }

    function trimChannels() {
        if (channels.size < capacity.channels) return
        for (const [id, channel] of channels) {
            if (channel.clients.size) continue
            channel.line.close()
            channels.delete(id)
            if (channels.size < capacity.channels) return
        }
        throw new LiveCapacityError('Слишком много разных подписок на цены.')
    }

    async function channelFor(request: Request, keys: string[], scope: string) {
        const id = await digest(scope + '\n' + keys.join('\n'))
        const found = channels.get(id)
        if (found) {
            found.request = projectionRequest(endpoint, request)
            return found
        }
        trimChannels()
        const [push, line] = replayListen<[PackageLiveChange]>({history: 96, keepBytes: 256_000})
        const channel: Channel = {id, scope, keys, request: projectionRequest(endpoint, request),
            push, line, clients: new Set(), off: [], heartbeat: null, touchedAt: now()}
        channels.set(id, channel)
        return channel
    }

    function cursor(channel: Channel, seq: number) { return epoch + ':' + channel.id + ':' + seq }

    function attach(channel: Channel, sink: StreamSink, since: string | null) {
        channel.clients.add(sink)
        clients++
        channel.touchedAt = now()
        const capability = {transport: 'sse', profile: deps.config.profile, pollIntervalMs: deps.config.sharedCheckMs,
            heartbeatMs} satisfies PackageLiveCapability
        sink.send('capability', capability)
        const prefix = epoch + ':' + channel.id + ':'
        const value = since?.startsWith(prefix) ? since.slice(prefix.length) : ''
        const seq = /^(0|[1-9]\d*)$/.test(value) ? Number(value) : -1
        const tail = seq >= 0 ? channel.line.getSince(seq) : null
        if (tail) {
            for (const event of tail) {
                sink.send('resource', event.event[0], cursor(channel, event.seq))
            }
        } else sink.send('reset', {epoch}, cursor(channel, channel.line.head()))
        const off = channel.line.line.on(event => {
            sink.send('resource', event.event[0], cursor(channel, event.seq))
        })
        try {
            if (channel.clients.size == 1) {
                for (const key of channel.keys) channel.off.push(subscribe(channel.scope, key, channel.request, channel.push))
                channel.heartbeat = setInterval(() => {
                    for (const client of channel.clients) client.send('heartbeat', {now: now()})
                }, heartbeatMs)
            }
        } catch (error) {
            off()
            channel.clients.delete(sink)
            clients--
            if (!channel.clients.size) for (const dispose of channel.off.splice(0)) dispose()
            throw error
        }
        let closed = false
        return function detach() {
            if (closed) return
            closed = true
            off()
            channel.clients.delete(sink)
            clients--
            channel.touchedAt = now()
            if (channel.clients.size) return
            if (channel.heartbeat) clearInterval(channel.heartbeat)
            channel.heartbeat = null
            for (const dispose of channel.off.splice(0)) dispose()
            channel.request = new Request('https://travel.invalid/')
        }
    }

    async function handle(request: Request, onClose?: () => void): Promise<Response | null> {
        const url = new URL(request.url)
        if (url.pathname != endpoint) return null
        if (request.method != 'GET') return json(405, 'Используйте GET.', {allow: 'GET'})
        if (clients + openingClients >= capacity.clients) return json(503, 'Подписки временно заняты.', {'retry-after': '5'})
        if (encoder.encode(request.url).byteLength >= 8_000) return json(413, 'Описание подписки слишком длинное.')
        openingClients++
        try {
            const demand = url.searchParams.get('demand')
            if (!demand || encodeURIComponent(demand).length > packageLiveLimits.descriptorBytes) {
                return json(400, 'Проверьте размер описания подписки.')
            }
            const keys = packageLiveResources(JSON.parse(demand))
            const scope = await deps.scope(request)
            const channel = await channelFor(request, keys, scope)
            const missing = keys.filter(key => !resources.has(resourceKey(scope, key))).length
            trimResources(missing)
            let detach = () => {}
            let controller: ReadableStreamDefaultController<Uint8Array> | null = null
            let closed = false
            const pending = new Map<string, string>()
            function flush() {
                if (!controller || closed) return
                if (!pending.size || (controller.desiredSize ?? 0) <= 0) return
                const [key, value] = pending.entries().next().value!
                pending.delete(key)
                controller.enqueue(encoder.encode(value))
            }
            function send(name: string, data: unknown, id?: string) {
                if (closed) return
                const identity = name == 'resource' ? name + ':' + (data as PackageLiveChange).key : name
                const frame = (id ? 'id: ' + id + '\n' : '') + 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n'
                pending.set(identity, frame)
                flush()
            }
            function close() {
                if (closed) return
                closed = true
                detach()
                pending.clear()
                request.signal.removeEventListener('abort', close)
                try { controller?.close() } catch { /* A cancelled stream is already closed. */ }
                onClose?.()
            }
            const body = new ReadableStream<Uint8Array>({
                start(target) {
                    controller = target
                    send('heartbeat', {now: now()})
                    detach = attach(channel, {send, close}, request.headers.get('last-event-id'))
                    request.signal.addEventListener('abort', close, {once: true})
                    if (request.signal.aborted) close()
                },
                pull: flush,
                cancel: close,
            })
            return new Response(body, {headers: {
                'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
                'x-accel-buffering': 'no',
            }})
        } catch (error) {
            if (error instanceof LiveCapacityError) return json(503, error.message, {'retry-after': '5'})
            if (error instanceof RangeError || error instanceof SyntaxError) return json(400, error.message)
            errors++
            return json(503, 'Не удалось открыть подписку на цены.', {'retry-after': '5'})
        } finally {
            openingClients--
        }
    }

    async function observed(request: Request, response: Response) {
        if (!packageLiveRoute(request.url) || !response.ok) return
        const key = canonicalDirectoryResource(request.url)
        if (![...resources.values()].some(entry => entry.key == key && entry.refs)) return
        const scope = await deps.scope(request)
        const entry = resources.get(resourceKey(scope, key))
        if (entry?.refs) await commit(entry, response.clone())
    }

    function close() {
        for (const channel of channels.values()) for (const client of [...channel.clients]) client.close()
        for (const entry of resources.values()) {
            void entry.work?.close()
            entry.line.close()
        }
        for (const channel of channels.values()) channel.line.close()
        resources.clear()
        channels.clear()
    }
    return {handle, source: {observed}, resource: {close}, health: {snapshot: () => ({
        transport: 'sse-invalidations', providerUpdates: 'demand-poll', profile: deps.config.profile,
        automatic: deps.config.automatic, sharedCheckMs: deps.config.sharedCheckMs, heartbeatMs,
        activeClients: clients, activeResources: [...resources.values()].filter(entry => entry.refs).length,
        resourceReads: reads, resourceChanges: changes, errors, capacity,
    })}}
}
