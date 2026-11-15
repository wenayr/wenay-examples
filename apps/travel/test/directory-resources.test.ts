import assert from 'node:assert/strict'
import test from 'node:test'
import {setImmediate} from 'node:timers/promises'
import {createDirectoryResources} from '../frontend/directory-resources.ts'
import {canonicalDirectoryResource, packageLiveDemand, packageLiveResources} from '../src/package-live-contract.ts'

function connection() {
    const target = new EventTarget()
    let closed = false
    const stream = {
        close: () => { closed = true },
        addEventListener: (type: string, listener: (event: Event) => void) => target.addEventListener(type, listener),
        onopen: null as ((event: Event) => unknown) | null,
        onerror: null as ((event: Event) => unknown) | null,
    }
    return {
        stream,
        closed: () => closed,
        emit: (type: string, value: unknown) => target.dispatchEvent(new MessageEvent(type, {data: JSON.stringify(value)})),
    }
}

async function settled() {
    await setImmediate()
    await setImmediate()
}

const capability = {transport: 'sse', profile: 'demand', heartbeatMs: 20_000, pollIntervalMs: 10_000}

test('same canonical resource shares one fetch and keeps the remaining subscriber alive', async t => {
    let calls = 0
    let signal: AbortSignal | undefined
    let release: (response: Response) => void = () => {}
    const resources = createDirectoryResources({fetch: async (_input, init) => {
        calls++
        signal = init?.signal ?? undefined
        return new Promise(resolve => { release = resolve })
    }})
    t.after(() => resources.resource.close())
    const first = resources.source.resource('/api/travel/packages?b=2&a=1')
    const second = resources.source.resource('/api/travel/packages?a=1&b=2&refresh=1')
    const one = first.events.on(() => {})
    const two = second.events.on(() => {})
    await settled()
    assert.equal(calls, 1)
    one()
    assert.equal(signal?.aborted, false)
    release(Response.json({source: {updatedAt: new Date().toISOString()}, value: 42}))
    await settled()
    assert.equal((second.view.snapshot().data as {value: number}).value, 42)
    assert.equal(calls, 1)
    two()
    await settled()
    assert.equal(resources.health.active().length, 0)
    assert.equal(resources.health.transport().mode, 'inactive')
})

test('one stream multiplexes visible resources, validates live messages and applies reset to the latest shared state', async t => {
    const stream = connection()
    let streams = 0
    let calls = 0
    let value = 1
    let descriptor = ''
    const resources = createDirectoryResources({
        connect: url => {
            streams++
            descriptor = new URL(url, 'https://travel.example').searchParams.get('demand')!
            return stream.stream
        },
        fetch: async () => {
            calls++
            return Response.json({source: {updatedAt: new Date().toISOString()}, value})
        },
    })
    t.after(() => resources.resource.close())
    const keys = Array.from({length: 20}, (_, index) => '/api/travel/package-matrix?hotelId=tez:1&nightsValues=7&date=' + index)
    const handles = keys.map(key => resources.source.resource(key))
    const off = handles.map(handle => handle.events.on(() => {}))
    await settled()
    assert.equal(streams, 1)
    assert.equal(packageLiveResources(JSON.parse(descriptor)).length, 20)
    assert.equal(calls, 20)
    stream.stream.onopen?.(new Event('open'))
    await settled()
    assert.equal(resources.health.transport().mode, 'connecting')
    stream.emit('capability', {transport: 'sse'})
    assert.equal(resources.health.transport().mode, 'connecting')
    stream.emit('capability', capability)
    assert.equal(resources.health.transport().mode, 'sse')
    value = 2
    const key = handles[0].view.snapshot().key
    stream.emit('resource', {key, version: '2'})
    stream.emit('resource', {key, version: '2'})
    await settled()
    assert.equal(calls, 21)
    assert.equal((handles[0].view.snapshot().data as {value: number}).value, 2)
    value = 3
    stream.emit('reset', {epoch: 'other-isolate'})
    await settled()
    assert.equal(calls, 41)
    assert.equal(resources.health.transport().epoch, 'other-isolate')
    assert.equal(resources.health.transport().resets, 1)
    assert.equal((handles[19].view.snapshot().data as {value: number}).value, 3)
    for (const dispose of off) dispose()
    await settled()
    assert.equal(stream.closed(), true)
    assert.equal(resources.health.transport().mode, 'inactive')
})

test('failed streaming switches to one coalesced HTTP owner after closing EventSource', async t => {
    let clock = Date.parse('2030-01-01T00:00:00Z')
    const stream = connection()
    let calls = 0
    const resources = createDirectoryResources({
        now: () => clock,
        connect: () => stream.stream,
        fetch: async () => {
            calls++
            if (calls > 1) assert.equal(stream.closed(), true)
            return Response.json({source: {updatedAt: new Date(clock).toISOString()}, value: calls}, {
                headers: {'x-travel-update-profile': 'demand', 'x-travel-shared-check-ms': '10000'},
            })
        },
    })
    t.after(() => resources.resource.close())
    const first = resources.source.resource('/api/travel/packages?a=1')
    const second = resources.source.resource('/api/travel/packages?a=1')
    const off = [first.events.on(() => {}), second.events.on(() => {})]
    await settled()
    assert.equal(calls, 1)
    clock += 130_000
    stream.stream.onerror?.(new Event('error'))
    await settled()
    assert.equal(resources.health.transport().mode, 'http-fallback')
    assert.equal(resources.health.transport().reason, 'stream-unavailable')
    assert.equal(calls, 2)
    assert.equal((second.view.snapshot().data as {value: number}).value, 2)
    off.forEach(dispose => dispose())
})

test('multiplex descriptor enforces whitelist and bounds without exposing arbitrary fetch URLs', () => {
    assert.equal(canonicalDirectoryResource('/api/travel/packages?a=first&a=last&refresh=1'), '/api/travel/packages?a=first')
    const keys = ['/api/travel/packages?agency=public&b=2&a=1', '/api/travel/package-matrix?agency=public&nightsValues=7']
    const demand = packageLiveDemand(keys)
    assert.equal(demand.common.agency, 'public')
    assert.deepEqual(packageLiveResources(demand), [...keys].map(key => {
        const url = new URL(key, 'https://travel.example')
        url.searchParams.sort()
        return url.pathname + url.search
    }).sort())
    assert.throws(() => packageLiveResources({version: 1, common: {}, resources: [{path: 'agency', query: {}}]}), RangeError)
    assert.throws(() => packageLiveResources({version: 1, common: {q: 'x'.repeat(13_000)}, resources: []}), RangeError)
    assert.throws(() => packageLiveDemand(Array.from({length: 49}, (_, i) => '/api/travel/packages?offset=' + i)), RangeError)
})

test('oversized stream URL retains every active resource in coalesced HTTP fallback', async t => {
    let streams = 0
    let calls = 0
    const resources = createDirectoryResources({
        connect: () => {
            streams++
            return connection().stream
        },
        fetch: async () => {
            calls++
            return Response.json({source: {updatedAt: new Date().toISOString()}})
        },
    })
    t.after(() => resources.resource.close())
    const keys = Array.from({length: 16}, (_, index) => '/api/travel/packages?q=' + String(index).repeat(400) + '&offset=' + index)
    const query = new URLSearchParams({demand: JSON.stringify(packageLiveDemand(keys))})
    assert.ok(('/api/travel/package-events?' + query).length > 8_000)
    const off = keys.map(key => resources.source.resource(key).events.on(() => {}))
    await settled()
    assert.equal(streams, 0)
    assert.equal(resources.health.transport().mode, 'http-fallback')
    assert.equal(resources.health.transport().reason, 'demand-limit')
    assert.equal(resources.health.active().length, 16)
    assert.equal(calls, 16)
    off.forEach(dispose => dispose())
})

for (const profile of ['request-only', 'unknown']) {
    test('REST policy ' + profile + ' disables automatic fallback requests without SSE frames', async t => {
        let clock = Date.parse('2030-01-01T00:00:00Z')
        let calls = 0
        const resources = createDirectoryResources({
            now: () => clock,
            connect: () => null,
            fetch: async () => {
                calls++
                const headers: Record<string, string> = {}
                if (profile != 'unknown') headers['x-travel-update-profile'] = profile
                return Response.json({source: {updatedAt: new Date(clock).toISOString()}}, {headers})
            },
        })
        t.after(() => resources.resource.close())
        const off = resources.source.resource('/api/travel/packages?a=1').events.on(() => {})
        await settled()
        assert.equal(calls, 1)
        assert.equal(resources.health.transport().profile, profile)
        clock += 130_000
        resources.control.visible(false)
        await settled()
        resources.control.visible(true)
        await settled()
        assert.equal(calls, 1)
        off()
    })
}

for (const event of ['resource', 'reset']) {
    test(event + ' during the initial fetch preserves one reconciliation with the latest state', async t => {
        const stream = connection()
        let calls = 0
        let release: (response: Response) => void = () => {}
        const resources = createDirectoryResources({
            connect: () => stream.stream,
            fetch: async () => {
                calls++
                if (calls == 1) return new Promise(resolve => { release = resolve })
                return Response.json({source: {updatedAt: new Date().toISOString()}, value: 2})
            },
        })
        t.after(() => resources.resource.close())
        const resource = resources.source.resource('/api/travel/packages?a=1')
        const off = resource.events.on(() => {})
        await settled()
        stream.emit('capability', capability)
        const data = event == 'resource' ? {key: resource.view.snapshot().key, version: 'new'} : {epoch: 'new-isolate'}
        stream.emit(event, data)
        release(Response.json({source: {updatedAt: new Date().toISOString()}, value: 1}))
        await settled()
        assert.equal(calls, 2)
        assert.equal((resource.view.snapshot().data as {value: number}).value, 2)
        off()
    })
}

test('a real context change unsubscribes the old key and ignores its late response', async t => {
    let release: (response: Response) => void = () => {}
    let oldSignal: AbortSignal | null | undefined
    const streams: ReturnType<typeof connection>[] = []
    let demand: unknown
    const resources = createDirectoryResources({
        connect: url => {
            demand = JSON.parse(new URL(url, 'https://travel.example').searchParams.get('demand')!)
            const stream = connection()
            streams.push(stream)
            return stream.stream
        },
        fetch: async (input, init) => {
            if (String(input).includes('destination=old')) {
                oldSignal = init?.signal
                return new Promise(resolve => { release = resolve })
            }
            return Response.json({source: {updatedAt: new Date().toISOString()}, value: 'new'})
        },
    })
    t.after(() => resources.resource.close())
    const previous = resources.source.resource('/api/travel/packages?destination=old')
    const stopPrevious = previous.events.on(() => {})
    await settled()
    stopPrevious()
    const current = resources.source.resource('/api/travel/packages?destination=new')
    const stopCurrent = current.events.on(() => {})
    await settled()
    assert.equal(oldSignal?.aborted, true)
    assert.equal(streams[0].closed(), true)
    assert.deepEqual(packageLiveResources(demand), ['/api/travel/packages?destination=new'])
    release(Response.json({value: 'old'}))
    await settled()
    assert.equal(previous.view.snapshot().data, undefined)
    assert.equal((current.view.snapshot().data as {value: string}).value, 'new')
    stopCurrent()
    await settled()
    assert.equal(streams.at(-1)?.closed(), true)
    assert.equal(resources.health.active().length, 0)
})
