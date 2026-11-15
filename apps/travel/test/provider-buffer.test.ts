import assert from 'node:assert/strict'
import test from 'node:test'
import {createProviderBuffer, ProviderRateLimitError} from '../backend/provider-buffer.ts'
import {resolveProviderBufferConfig} from '../backend/provider-buffer-config.ts'
import {createProviderStorage, type ProviderBucket} from '../backend/provider-buffer-storage.ts'
import type {ProviderBufferConfig} from '../backend/provider-buffer-config.ts'
import {readBoundedProviderText} from '../backend/provider-buffer-body.ts'
import {createTravelWorker} from '../backend/worker.ts'
import {createDefaultInventory, createPackages} from '../backend/packages.ts'

interface Value {price: number, checkedAt: number, stale?: boolean, retryAt?: number, missing?: boolean}

function setup() {
    let clock = 1_000_000
    let version = 0
    let failWrites = ''
    let failReads = false
    let readAdvanceMs = 0
    let reads = 0
    let snapshotReads = 0
    let readGate: Promise<void> | null = null
    let beginRead: () => void = () => {}
    const readStarted = new Promise<void>(resolve => {beginRead = resolve})
    const entries = new Map<string, {body: string, etag: string, metadata?: Record<string, string>}>()
    const writes = new Map<string, number>()
    const bucket = {
        async get(key: string) {
            reads++
            beginRead()
            if (key.includes('/snapshots/')) snapshotReads++
            if (readGate) await readGate
            clock += readAdvanceMs
            if (failReads) throw new Error('R2 read unavailable')
            const value = entries.get(key)
            return value ? {etag: value.etag, customMetadata: value.metadata, text: async () => value.body} : null
        },
        async head(key: string) {
            clock += readAdvanceMs
            if (failReads) throw new Error('R2 head unavailable')
            const value = entries.get(key)
            return value ? {etag: value.etag, customMetadata: value.metadata} : null
        },
        async put(key: string, body: string, options: Parameters<ProviderBucket['put']>[2]) {
            if (failWrites && key.includes(failWrites)) throw new Error('R2 write unavailable')
            const value = entries.get(key)
            const expected = options.onlyIf.get('if-match')?.replace(/^"|"$/g, '')
            if (options.onlyIf.get('if-none-match') == '*' && value) return null
            if (expected && expected != value?.etag) return null
            const previous = writes.get(key)
            assert.ok(previous == null || clock - previous >= 1_000, 'same R2 key must not be written twice within one second')
            const etag = String(++version)
            entries.set(key, {body, etag, metadata: options.customMetadata})
            writes.set(key, clock)
            return {etag}
        },
    } satisfies ProviderBucket
    const jobs: Promise<unknown>[] = []
    function replica(override: Partial<ProviderBufferConfig> = {}) {
        const config = {...resolveProviderBufferConfig(), sharedCheckMs: 0, ...override}
        return createProviderBuffer<Value>({
            providerId: 'test', accountScope: 'public', memoryScope: {}, bucket, config, now: () => clock,
            waitUntil: job => {jobs.push(job)}, pause: async ms => {clock += ms},
            codec: {encode: value => value, decode: value => value as Value},
            traits: {
                checkedAt: value => value.checkedAt,
                negative: () => false,
                cached: value => ({...value}),
                deferred: (value, retryAt) => ({...value, retryAt}),
                stale: (value, retryAt) => ({...value, stale: true, retryAt}),
                missing: retryAt => ({price: 0, checkedAt: 0, missing: true, retryAt}),
            },
        })
    }
    return {replica, entries, jobs, bucket, readStarted, now: () => clock, advance: (ms: number) => {clock += ms},
        failWrites: (suffix: string) => {failWrites = suffix}, failReads: (value: boolean) => {failReads = value},
        readLatency: (ms: number) => {readAdvanceMs = ms}, readCounts: () => ({reads, snapshotReads}),
        holdReads() {
            let release: () => void = () => {}
            readGate = new Promise<void>(resolve => {release = resolve})
            return release
        }}
}

test('two replicas admit one supplier request and a disconnected first reader does not cancel shared work', async () => {
    const env = setup()
    const first = env.replica()
    const second = env.replica()
    let release: (value: Value) => void = () => {}
    let begin: () => void = () => {}
    const started = new Promise<void>(resolve => {begin = resolve})
    let calls = 0
    let supplierSignal: AbortSignal | undefined
    async function load(signal: AbortSignal) {
        calls++
        supplierSignal = signal
        begin()
        return new Promise<Value>(resolve => {release = resolve})
    }
    const abort = new AbortController()
    const one = first.source.read({key: 'same', load, signal: abort.signal})
    await started
    const pending = await second.source.read({key: 'same', load})
    assert.equal(pending.missing, true)
    assert.equal(calls, 1)
    abort.abort()
    await assert.rejects(one, {name: 'AbortError'})
    assert.equal(supplierSignal?.aborted, false)
    const checkedAt = env.now()
    release({price: 123, checkedAt})
    await Promise.all(env.jobs)
    const received = await second.source.read({key: 'same', load})
    assert.deepEqual(received, {price: 123, checkedAt})
    assert.equal(calls, 1)
})

test('429 cooldown from one source key blocks another key on a different replica', async () => {
    const env = setup()
    const first = env.replica()
    const second = env.replica()
    const retryAt = env.now() + 60_000
    await first.source.read({key: 'a', load: async () => {throw new ProviderRateLimitError(retryAt)}})
    env.advance(2_000)
    let calls = 0
    const denied = await second.source.read({key: 'b', load: async () => {
        calls++
        return {price: 200, checkedAt: env.now()}
    }})
    assert.equal(calls, 0)
    assert.equal(denied.retryAt, retryAt)
    env.advance(60_000)
    const resumed = await second.source.read({key: 'b', load: async () => ({price: 200, checkedAt: env.now()})})
    assert.equal(resumed.price, 200)
})

test('failure of the cooldown object still publishes provider-wide cooldown evidence through the lease snapshot', async () => {
    const env = setup()
    const first = env.replica()
    const second = env.replica()
    env.failWrites('/cooldown')
    const retryAt = env.now() + 60_000
    await first.source.read({key: 'a', load: async () => {throw new ProviderRateLimitError(retryAt)}})
    env.advance(30_000)
    let calls = 0
    const denied = await second.source.read({key: 'b', load: async () => {
        calls++
        return {price: 200, checkedAt: env.now()}
    }})
    assert.equal(calls, 0)
    assert.equal(denied.retryAt, retryAt)
})

test('R2 admission and read failures fail closed and preserve original last-good timestamps', async () => {
    const env = setup()
    const source = env.replica()
    let calls = 0
    async function load() {
        calls++
        return {price: 500, checkedAt: env.now()}
    }
    const fresh = await source.source.read({key: 'a', load})
    env.advance(130_000)
    env.failReads(true)
    const stale = await source.source.read({key: 'a', load})
    assert.equal(stale.stale, true)
    assert.equal(stale.checkedAt, fresh.checkedAt)
    assert.equal(calls, 1)
    env.failReads(false)
    env.failWrites('/gate')
    const failed = await env.replica().source.read({key: 'b', load})
    assert.equal(failed.missing, true)
    assert.equal(calls, 1)
    assert.equal(source.health.snapshot().mode, 'r2-shared')
})

test('late expired owner cannot replace a newer fenced snapshot', async () => {
    const env = setup()
    const first = env.replica()
    const second = env.replica()
    let release: (value: Value) => void = () => {}
    let begin: () => void = () => {}
    const started = new Promise<void>(resolve => {begin = resolve})
    const old = first.source.read({key: 'same', load: async () => {
        begin()
        return new Promise<Value>(resolve => {release = resolve})
    }})
    await started
    const oldTime = env.now()
    env.advance(30_000)
    const newer = await second.source.read({key: 'same', load: async () => ({price: 222, checkedAt: env.now()})})
    release({price: 111, checkedAt: oldTime})
    await old
    const final = await env.replica().source.read({key: 'same', load: async () => {throw new Error('must not refetch')}})
    assert.equal(final.price, 222)
    assert.equal(final.checkedAt, newer.checkedAt)
})

test('failed refresh never renews freshness and last-good data expires at its retention boundary', async () => {
    const env = setup()
    const source = env.replica()
    const original = await source.source.read({key: 'a', load: async () => ({price: 321, checkedAt: env.now()})})
    env.advance(130_000)
    const stale = await source.source.read({key: 'a', load: async () => {throw new Error('supplier unavailable')}})
    assert.equal(stale.price, 321)
    assert.equal(stale.checkedAt, original.checkedAt)
    assert.equal(stale.stale, true)
    env.advance(800_000)
    const expired = await source.source.read({key: 'a', load: async () => {throw new Error('supplier unavailable')}})
    assert.equal(expired.missing, true)
    assert.equal(expired.price, 0)
})

test('resident source memory is bounded and eviction reads a fresh shared snapshot without repeating supplier work', async () => {
    const env = setup()
    const source = env.replica({maxResidentBytes: 1_000})
    let calls = 0
    async function load() {
        calls++
        return {price: 100, checkedAt: env.now()}
    }
    for (const key of ['a', 'b', 'c']) {
        await source.source.read({key, load})
        env.advance(2_000)
    }
    assert.ok(source.health.snapshot().residentBytes <= 1_000)
    assert.ok(source.health.snapshot().entries < 3)
    await source.source.read({key: 'a', load})
    assert.equal(calls, 3)
})

test('an oversized stream is cancelled before JSON parsing and throwing listeners cannot invalidate a committed observation', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(17)) },
        cancel() { cancelled = true },
    })
    await assert.rejects(readBoundedProviderText({body, text: async () => {throw new Error('must use the stream')}}, 16))
    assert.equal(cancelled, true)
    const env = setup()
    const source = env.replica()
    source.events.on(() => {throw new Error('consumer failed')})
    const observed = await source.source.read({key: 'a', load: async () => ({price: 42, checkedAt: env.now()})})
    assert.equal(observed.price, 42)
    assert.equal(observed.stale, undefined)
    assert.equal(source.health.snapshot().counters.callbackErrors, 1)
})

test('hosted manual refresh reuses a recent original observation and respects its own minimum gap', async () => {
    const env = setup()
    const source = env.replica()
    let calls = 0
    async function load() {
        calls++
        return {price: 111, checkedAt: env.now()}
    }
    const original = await source.source.read({key: 'a', load})
    env.advance(2_000)
    const deferred = await source.source.read({key: 'a', load, refresh: true})
    assert.equal(calls, 1)
    assert.equal(deferred.checkedAt, original.checkedAt)
    assert.equal(deferred.retryAt, original.checkedAt + 15_000)
    assert.equal(deferred.stale, undefined)
    env.advance(14_000)
    await source.source.read({key: 'a', load, refresh: true})
    assert.equal(calls, 2)
})

test('hosted manual refresh obeys the stored error pause even after the provider admission gap elapsed', async () => {
    const env = setup()
    const source = env.replica()
    let calls = 0
    let fail = false
    async function load() {
        calls++
        if (fail) throw new Error('supplier unavailable')
        return {price: 111, checkedAt: env.now()}
    }
    await source.source.read({key: 'a', load})
    env.advance(16_000)
    fail = true
    const failed = await source.source.read({key: 'a', load, refresh: true})
    env.advance(2_000)
    const paused = await source.source.read({key: 'a', load, refresh: true})
    assert.equal(calls, 2)
    assert.equal(paused.retryAt, failed.retryAt)
    assert.equal(paused.stale, true)
    env.advance(10_000)
    fail = false
    await source.source.read({key: 'a', load, refresh: true})
    assert.equal(calls, 3)
})

test('slow R2 reads and completion HEADs do not consume the admission gap before its CAS', async () => {
    const env = setup()
    const source = env.replica()
    await source.source.read({key: 'a', load: async () => ({price: 1, checkedAt: env.now()})})
    env.readLatency(750)
    let admittedAt = 0
    await source.source.read({key: 'b', load: async () => {
        admittedAt = env.now()
        return {price: 2, checkedAt: admittedAt}
    }})
    const gateEntry = [...env.entries].find(([key]) => key.endsWith('/gate'))
    assert.ok(gateEntry)
    const gate = JSON.parse(gateEntry[1].body)
    assert.equal(gate.starts.at(-1), admittedAt)
    assert.equal(gate.nextStartAt, admittedAt + 2_000)
    env.readLatency(0)
    let calls = 0
    const denied = await source.source.read({key: 'c', load: async () => {
        calls++
        return {price: 3, checkedAt: env.now()}
    }})
    assert.equal(calls, 0)
    assert.equal(denied.retryAt, admittedAt + 2_000)
})

test('concurrent identical misses share the lookup before admission and supplier work', async () => {
    const env = setup()
    const source = env.replica()
    let calls = 0
    let begin: () => void = () => {}
    let release: (value: Value) => void = () => {}
    const started = new Promise<void>(resolve => {begin = resolve})
    async function load() {
        calls++
        begin()
        return new Promise<Value>(resolve => {release = resolve})
    }
    const readers = Array.from({length: 20}, () => source.source.read({key: 'same', load}))
    await started
    assert.equal(env.readCounts().snapshotReads, 1)
    assert.equal(calls, 1)
    release({price: 222, checkedAt: env.now()})
    const results = await Promise.all(readers)
    assert.ok(results.every(value => value.price == 222))
})

test('pending distinct keys are bounded before additional R2 reads or queued supplier work', async () => {
    const env = setup()
    const source = env.replica({maxPendingKeys: 2})
    const release = env.holdReads()
    async function load() { return {price: 1, checkedAt: env.now()} }
    const first = source.source.read({key: 'a', load})
    const second = source.source.read({key: 'b', load})
    const denied = await source.source.read({key: 'c', load})
    assert.equal(denied.missing, true)
    assert.equal(source.health.snapshot().pendingKeys, 2)
    assert.equal(source.health.snapshot().counters.loads, 0)
    release()
    await Promise.all([first, second])
    assert.equal(env.readCounts().snapshotReads <= 3, true)
    assert.equal(source.health.snapshot().pendingKeys, 0)
})

test('shared storage bounds simultaneous body reads independently from the provider work queue', async () => {
    let active = 0
    let maximum = 0
    let calls = 0
    let release: () => void = () => {}
    let begin: () => void = () => {}
    const held = new Promise<void>(resolve => {release = resolve})
    const started = new Promise<void>(resolve => {begin = resolve})
    const bucket = {
        async get() {
            calls++
            active++
            maximum = Math.max(maximum, active)
            if (active == 2) begin()
            await held
            active--
            return null
        },
        put: async () => ({etag: 'unused'}),
    } satisfies ProviderBucket
    const storage = createProviderStorage({bucket, prefix: 'test', maxBytes: 1_000, maxSharedReads: 2})
    const reads = Array.from({length: 8}, (_, index) => storage.read(String(index)))
    await started
    assert.equal(calls, 2)
    release()
    await Promise.all(reads)
    assert.equal(maximum, 2)
    assert.equal(calls, 8)
})

test('cold static and destination requests do not start source initialization before a price operation', async () => {
    const env = setup()
    let digests = 0
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest')
    Object.defineProperty(crypto.subtle, 'digest', {configurable: true,
        value: (...args: Parameters<typeof digest>) => {
            digests++
            return digest(...args)
        }})
    try {
        const inventory = createDefaultInventory({bucket: env.bucket, now: () => new Date('2030-01-01T00:00:00Z'),
            fetch: async () => Response.json({success: true, data: [], info: [['More results', 'false']]})})
        const worker = createTravelWorker({packages: createPackages(inventory),
            assets: {'/index.html': {body: btoa('<html></html>'), type: 'text/html'}}})
        assert.equal((await worker.fetch(new Request('https://test.example/'))).status, 200)
        assert.equal((await worker.fetch(new Request('https://test.example/api/travel/destinations'))).status, 200)
        assert.equal(digests, 0)
        assert.equal(env.readCounts().reads, 0)
        const result = await inventory.window({destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-24',
            nights: 7, adults: 2, minTotal: 0, maxTotal: 500_000})
        assert.equal(result.source.status, 'live')
        assert.ok(digests > 0)
    } finally {
        if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor)
        else Reflect.deleteProperty(crypto.subtle, 'digest')
    }
})

test('the whole hosted lookup is registered before its I/O and survives the first reader disconnect', async () => {
    const env = setup()
    const source = env.replica()
    const release = env.holdReads()
    const abort = new AbortController()
    async function load() { return {price: 789, checkedAt: env.now()} }
    const first = source.source.read({key: 'same', load, signal: abort.signal})
    assert.equal(env.jobs.length, 1)
    assert.equal(env.readCounts().reads, 0)
    await env.readStarted
    abort.abort()
    await assert.rejects(first, {name: 'AbortError'})
    const second = source.source.read({key: 'same', load})
    assert.equal(env.jobs.length, 2)
    release()
    assert.equal((await second).price, 789)
    await Promise.all(env.jobs)
    assert.equal(source.health.snapshot().pendingKeys, 0)
})

test('an aborted queued storage I/O releases capacity for the next operation', async () => {
    let calls = 0
    let begin: () => void = () => {}
    const started = new Promise<void>(resolve => {begin = resolve})
    const bucket = {get: async () => {
        calls++
        if (calls == 1) {
            begin()
            return new Promise<null>(() => {})
        }
        return null
    }, put: async () => ({etag: 'unused'})} satisfies ProviderBucket
    const storage = createProviderStorage({bucket, prefix: 'test', maxBytes: 1_000, maxSharedReads: 1})
    const deadline = new AbortController()
    const first = storage.read('first', deadline.signal)
    await started
    const next = storage.read('next')
    deadline.abort(new DOMException('Operation deadline', 'TimeoutError'))
    await assert.rejects(first, {name: 'TimeoutError'})
    assert.equal((await next).value, null)
    assert.equal(calls, 2)
})
