import {createAsyncQueue} from 'wenay-common2/client'
import {LISTEN_DISPATCH_ERROR, listenStore} from 'wenay-common2/listen'
import {resolveProviderBufferConfig, type ProviderBufferConfig} from './provider-buffer-config.ts'
import {createProviderCoordinator} from './provider-buffer-coordinator.ts'
import {providerBufferHash, type ProviderBucket} from './provider-buffer-storage.ts'
import {withProviderSignal} from './provider-buffer-body.ts'

export class ProviderRateLimitError extends Error {
    retryAt: number
    constructor(retryAt: number) {
        super('Поставщик ограничил частоту запросов.')
        this.retryAt = retryAt
    }
}

export function providerRetryAt(value: string | null, now: number) {
    const seconds = value && /^\d+$/.test(value) ? Number(value) : null
    const requested = seconds == null ? Date.parse(value ?? '') : now + seconds * 1000
    return Number.isFinite(requested) && requested > now ? requested : now + 60_000
}

interface StoredSnapshot {
    schema: 1
    sequence: number
    writtenAt: number
    checkedAt: number | null
    freshUntil: number
    retainUntil: number
    nextAttemptAt: number
    value: unknown
    failure?: string
    providerCooldownUntil?: number
}
interface LocalSnapshot<T> {stored: StoredSnapshot, value: T | null, syncedAt: number, etag: string | null, bytes?: number}
interface BufferChange {version: number, checkedAt: number | null, status: 'observed' | 'failed'}

async function withinDeadline<T>(work: Promise<T>, signal: AbortSignal) {
    signal.throwIfAborted()
    let rejectAbort: (reason: unknown) => void = () => {}
    const cancelled = new Promise<never>((_, reject) => {rejectAbort = reject})
    function aborted() { rejectAbort(signal.reason) }
    signal.addEventListener('abort', aborted, {once: true})
    try { return await Promise.race([work, cancelled]) }
    finally { signal.removeEventListener('abort', aborted) }
}

export function createProviderBuffer<T>(deps: {
    providerId: string
    accountScope: string
    memoryScope: object
    bucket?: ProviderBucket
    config?: ProviderBufferConfig
    now: () => number
    waitUntil?: (work: Promise<unknown>) => void
    pause?: (ms: number) => Promise<void>
    codec: {encode: (value: T) => unknown, decode: (value: unknown) => T}
    traits: {
        checkedAt: (value: T) => number | null
        negative: (value: T) => boolean
        cached: (value: T) => T
        deferred: (value: T, retryAt: number) => T
        stale: (value: T, retryAt: number, message: string) => T
        missing: (retryAt: number, message: string, failed?: boolean) => T
    }
}) {
    const config = deps.config ?? resolveProviderBufferConfig()
    const pause = deps.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    const coordinator = createProviderCoordinator({...deps, config, pause})
    const cache = new Map<string, LocalSnapshot<T>>()
    let residentBytes = 0
    const queue = createAsyncQueue(config.limits.maxConcurrent)
    const inflight = new Map<string, {
        work: Promise<T>, users: Set<symbol>, controller: AbortController, signal: AbortSignal,
        owner?: AbortSignal, expiresAt: number,
    }>()
    const reads = new Map<string, NonNullable<ReturnType<typeof inflight.get>>>()
    const counters = {loads: 0, hits: 0, joins: 0, denied: 0, errors: 0, storageErrors: 0, callbackErrors: 0}
    let lastChange: BufferChange | undefined
    const [push, changes] = listenStore<[BufferChange]>({current: () => lastChange ? [lastChange] : undefined,
        [LISTEN_DISPATCH_ERROR]: () => {counters.callbackErrors++}})
    function emit(change: BufferChange) {
        lastChange = change
        push(change)
    }
    const hosted = Boolean(deps.bucket)

    function remember(key: string, entry: LocalSnapshot<T>) {
        const existing = cache.get(key)
        if (existing) {
            residentBytes -= existing.bytes ?? 0
            cache.delete(key)
        }
        // Includes decoded objects and the fare Map; raw and decoded quotes share their objects.
        const bytes = new TextEncoder().encode(JSON.stringify(entry.stored)).byteLength * 3
        if (bytes > config.maxResidentBytes) return
        function exceedsBudget() { return cache.size >= config.maxEntries || residentBytes + bytes > config.maxResidentBytes }
        while (cache.size && exceedsBudget()) {
            const oldest = cache.keys().next().value!
            residentBytes -= cache.get(oldest)?.bytes ?? 0
            cache.delete(oldest)
        }
        entry.bytes = bytes
        residentBytes += bytes
        cache.set(key, entry)
    }
    function usable(entry: LocalSnapshot<T> | undefined, retryAt: number, message: string, failed = false) {
        if (entry?.value != null && entry.stored.retainUntil > deps.now()) return deps.traits.stale(entry.value, retryAt, message)
        return deps.traits.missing(retryAt, message, failed)
    }
    function validSnapshot(value: StoredSnapshot) {
        const timing = Number.isFinite(value.freshUntil) && Number.isFinite(value.retainUntil) && Number.isFinite(value.nextAttemptAt)
        const revision = Number.isSafeInteger(value.sequence) && Number.isFinite(value.writtenAt)
        const checked = value.checkedAt == null ? value.freshUntil == 0 : Number.isFinite(value.checkedAt)
        const timestamps = timing && checked
        return value.schema == 1 && revision && timestamps
    }
    async function synchronize(key: string, signal: AbortSignal) {
        const store = await coordinator.source.storage(signal)
        if (!store) return cache.get(key)
        const current = await store.read<StoredSnapshot>('snapshots/' + key, signal)
        if (!current.value) return cache.get(key)
        if (!validSnapshot(current.value)) throw new Error('Некорректный общий снимок цен.')
        const local = cache.get(key)
        if (local && local.stored.sequence > current.value.sequence) return local
        const value = current.value.value == null ? null : deps.codec.decode(current.value.value)
        if (value != null && deps.traits.checkedAt(value) != current.value.checkedAt) throw new Error('Не совпадает время исходного наблюдения.')
        const entry = {stored: current.value, value, syncedAt: deps.now(), etag: current.etag}
        remember(key, entry)
        if (!local || local.stored.sequence != current.value.sequence) {
            emit({version: current.value.sequence, checkedAt: current.value.checkedAt, status: current.value.failure ? 'failed' : 'observed'})
        }
        return entry
    }
    async function publish(key: string, snapshot: StoredSnapshot, value: T | null, signal: AbortSignal) {
        signal.throwIfAborted()
        const store = await coordinator.source.storage(signal)
        let etag = cache.get(key)?.etag ?? null
        if (store) {
            for (let attempt = 0; attempt < 3; attempt++) {
                const current = await withinDeadline(store.read<StoredSnapshot>('snapshots/' + key, signal), signal)
                if (current.value && !validSnapshot(current.value)) throw new Error('Некорректный общий снимок цен.')
                if (current.value && current.value.sequence >= snapshot.sequence) {
                    await withinDeadline(synchronize(key, signal), signal)
                    return
                }
                const earliestWrite = current.value ? current.value.writtenAt + 1_100 : 0
                if (earliestWrite > deps.now()) await withinDeadline(pause(earliestWrite - deps.now()), signal)
                signal.throwIfAborted()
                const writtenAt = deps.now()
                const written = store.write('snapshots/' + key, {...snapshot, writtenAt}, current.etag,
                    snapshot.sequence, snapshot.providerCooldownUntil, signal)
                const stored = await withinDeadline(written, signal)
                if (stored) {
                    etag = stored.etag
                    snapshot = {...snapshot, writtenAt}
                    break
                }
                if (attempt == 2) throw new Error('Не удалось сохранить общий снимок цен.')
                await withinDeadline(pause(1_100), signal)
            }
        }
        remember(key, {stored: snapshot, value, syncedAt: deps.now(), etag})
        emit({version: snapshot.sequence, checkedAt: snapshot.checkedAt, status: snapshot.failure ? 'failed' : 'observed'})
    }
    async function observe(pending: NonNullable<ReturnType<typeof inflight.get>>, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const token = Symbol('source-reader')
        pending.users.add(token)
        let rejectAbort: (reason: unknown) => void = () => {}
        const cancelled = new Promise<never>((_, reject) => {rejectAbort = reject})
        function aborted() {
            pending.users.delete(token)
            if (!hosted && !pending.users.size) pending.controller.abort(signal?.reason)
            rejectAbort(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', aborted, {once: true})
        try {
            return await (signal ? Promise.race([pending.work, cancelled]) : pending.work)
        } finally {
            pending.users.delete(token)
            signal?.removeEventListener('abort', aborted)
        }
    }
    async function readSource(input: {key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, refresh?: boolean}) {
        input.signal?.throwIfAborted()
        const operationSignal = input.signal ?? AbortSignal.timeout(config.deadlineMs)
        const key = hosted ? await withProviderSignal(() => providerBufferHash(input.key), operationSignal) : input.key
        input.signal?.throwIfAborted()
        let prior = cache.get(key)
        if (prior) {
            cache.delete(key)
            cache.set(key, prior)
        }
        const sharedDue = !prior || prior.syncedAt + config.sharedCheckMs <= deps.now()
        if (hosted && (sharedDue || input.refresh)) {
            try { prior = await withinDeadline(synchronize(key, operationSignal), operationSignal) }
            catch {
                input.signal?.throwIfAborted()
                counters.storageErrors++
                return usable(prior, deps.now() + config.errorRetryMs, 'Общий буфер временно недоступен. Повторная проверка отложена.', true)
            }
        }
        const currentTime = deps.now()
        const fresh = prior && prior.stored.freshUntil > currentTime && prior.value != null
        const freshValue = fresh ? prior?.value : null
        if (!input.refresh && freshValue != null) {
            counters.hits++
            return deps.traits.cached(freshValue)
        }
        const pauseUntil = prior?.stored.nextAttemptAt ?? 0
        const obeyPause = !input.refresh || hosted
        if (obeyPause && pauseUntil > currentTime) {
            counters.denied++
            const failed = Boolean(prior?.stored.failure) && !prior?.stored.providerCooldownUntil
            return usable(prior, pauseUntil, prior?.stored.failure ?? 'Проверка продолжится после паузы.', failed)
        }
        const checkedAt = prior?.stored.checkedAt
        const manualRetryAt = checkedAt == null ? 0 : checkedAt + config.manualRefreshGapMs
        const manualPause = hosted && input.refresh && manualRetryAt > currentTime
        if (manualPause && freshValue != null) {
            counters.denied++
            return deps.traits.deferred(freshValue, manualRetryAt)
        }
        const waiting = inflight.get(key)
        if (waiting && !waiting.signal.aborted && waiting.expiresAt > deps.now()) {
            counters.joins++
            if (hosted) return joinedSnapshot(key)
            return observe(waiting, input.signal)
        }
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, operationSignal])
        const pending: NonNullable<ReturnType<typeof inflight.get>> = {
            controller, signal, users: new Set<symbol>(), expiresAt: deps.now() + config.deadlineMs,
            work: Promise.resolve(deps.traits.missing(0, 'Проверяем цены.')),
        }
        async function load() {
            let sequence = 0
            try {
                signal.throwIfAborted()
                const admission = await withinDeadline(coordinator.source.admit(key, signal), signal)
                if (!admission.allowed) {
                    counters.denied++
                    return usable(prior, admission.retryAt, 'Проверка продолжится автоматически после общей паузы.')
                }
                sequence = admission.sequence
                signal.throwIfAborted()
                counters.loads++
                const value = await withinDeadline(input.load(signal), signal)
                signal.throwIfAborted()
                if (deps.now() >= admission.expiresAt) throw new Error('Истёк срок проверки источника.')
                const checkedAt = deps.traits.checkedAt(value)
                if (checkedAt == null || !Number.isFinite(checkedAt)) throw new Error('Источник не подтвердил время наблюдения.')
                const checkedTime = checkedAt
                const freshMs = deps.traits.negative(value) ? config.negativeFreshMs : config.freshMs
                const snapshot = {schema: 1, sequence, writtenAt: deps.now(), checkedAt,
                    freshUntil: checkedTime + freshMs, retainUntil: checkedTime + config.retainMs, nextAttemptAt: 0,
                    value: deps.codec.encode(value)} satisfies StoredSnapshot
                await publish(key, snapshot, value, signal)
                return value
            } catch (error) {
                if (!hosted && controller.signal.aborted) throw controller.signal.reason
                counters.errors++
                let retryAt = deps.now() + config.errorRetryMs
                if (error instanceof ProviderRateLimitError) {
                    retryAt = error.retryAt
                    try { await withinDeadline(coordinator.control.cooldown(retryAt, signal), signal) }
                    catch { counters.storageErrors++ }
                }
                const message = error instanceof ProviderRateLimitError ? 'Источник ограничил частоту запросов.' : 'Нет свежего ответа поставщика.'
                if (sequence && !signal.aborted) {
                    const last = cache.get(key) ?? prior
                    const snapshot = {schema: 1, sequence, writtenAt: deps.now(), checkedAt: last?.stored.checkedAt ?? null,
                        freshUntil: 0, retainUntil: last?.stored.retainUntil ?? 0, nextAttemptAt: retryAt,
                        value: last?.stored.value ?? null, failure: message,
                        providerCooldownUntil: error instanceof ProviderRateLimitError ? retryAt : 0} satisfies StoredSnapshot
                    try { await publish(key, snapshot, last?.value ?? null, signal) }
                    catch { counters.storageErrors++ }
                } else if (hosted) counters.storageErrors++
                return usable(cache.get(key) ?? prior, retryAt, message, !(error instanceof ProviderRateLimitError))
            } finally {
                if (sequence) coordinator.control.complete(key, sequence)
                if (inflight.get(key) == pending) inflight.delete(key)
            }
        }
        inflight.set(key, pending)
        // Hosted concurrency is admitted by the R2 gate. An isolate queue could run another request's I/O.
        pending.work = hosted ? load() : queue.add(load)
        return observe(pending, input.signal)
    }
    function joinedSnapshot(key: string) {
        const entry = cache.get(key)
        const now = deps.now()
        if (entry?.value != null && entry.stored.freshUntil > now) return deps.traits.cached(entry.value)
        const retryAt = Math.max(now + config.sharedCheckMs, entry?.stored.nextAttemptAt ?? 0)
        return usable(entry, retryAt, 'Цены обновляются автоматически.')
    }
    async function read(input: Parameters<typeof readSource>[0]) {
        input.signal?.throwIfAborted()
        const active = reads.get(input.key)
        if (active && !active.signal.aborted && active.expiresAt > deps.now()) {
            counters.joins++
            if (hosted && (!input.signal || active.owner != input.signal)) {
                // Other Workers invocations can share completed data and the R2 lease, never in-flight I/O.
                const key = await withProviderSignal(() => providerBufferHash(input.key), input.signal)
                return joinedSnapshot(key)
            }
            return observe(active, input.signal)
        }
        if (hosted && Math.max(reads.size, inflight.size) >= config.maxPendingKeys) {
            for (const [key, pending] of reads) if (pending.expiresAt <= deps.now()) reads.delete(key)
            for (const [key, pending] of inflight) if (pending.expiresAt <= deps.now()) inflight.delete(key)
        }
        if (reads.size >= config.maxPendingKeys) {
            counters.denied++
            return deps.traits.missing(deps.now() + config.errorRetryMs, 'Слишком много разных проверок. Повторите после паузы.')
        }
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.deadlineMs)])
        const pending: NonNullable<ReturnType<typeof inflight.get>> = {
            controller, signal, owner: input.signal, expiresAt: deps.now() + config.deadlineMs,
            users: new Set(), work: Promise.resolve(deps.traits.missing(0, 'Проверяем цены.')),
        }
        reads.set(input.key, pending)
        // Register the whole operation before its first crypto/R2 call, including queue cleanup.
        pending.work = Promise.resolve().then(() => readSource({...input, signal})).finally(() => {
            if (reads.get(input.key) == pending) reads.delete(input.key)
        })
        if (hosted) deps.waitUntil?.(pending.work.catch(() => {}))
        return observe(pending, input.signal)
    }
    return {
        source: {read}, events: {on: changes.on},
        health: {snapshot: () => ({mode: coordinator.health.mode, profile: config.profile, providerMode: 'server-poll',
            pushAvailable: false, automatic: config.automatic, freshMs: config.freshMs, retainMs: config.retainMs,
            sharedCheckMs: config.sharedCheckMs, limits: hosted ? {...config.limits} : {...config.limits, minStartGapMs: 0, startsPerWindow: 45},
            manualRefreshGapMs: hosted ? config.manualRefreshGapMs : 0,
            entries: cache.size, residentBytes, maxResidentBytes: config.maxResidentBytes,
            pendingKeys: reads.size, maxPendingKeys: config.maxPendingKeys, maxSharedReads: config.maxSharedReads,
            inflight: inflight.size, counters: {...counters}})},
    }
}
