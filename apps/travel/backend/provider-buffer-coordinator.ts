import type {ProviderBufferConfig} from './provider-buffer-config.ts'
import {createProviderStorage, providerBufferHash, type ProviderBucket} from './provider-buffer-storage.ts'
import {withProviderSignal} from './provider-buffer-body.ts'

interface Lease {key: string, sequence: number, expiresAt: number}
interface Gate {schema: 1, sequence: number, nextStartAt: number, starts: number[], leases: Lease[]}
interface Cooldown {schema: 1, retryAt: number, writtenAt: number, settleUntil: number}
interface Admission {allowed: boolean, sequence: number, expiresAt: number, retryAt: number}
interface MemoryState {gate: Gate, retryAt: number}
const memoryScopes = new WeakMap<object, Map<string, MemoryState>>()

function initialGate(): Gate { return {schema: 1, sequence: 0, nextStartAt: 0, starts: [], leases: []} }
function validGate(value: Gate) {
    const numbers = Number.isSafeInteger(value.sequence) && Number.isFinite(value.nextStartAt)
    const collections = Array.isArray(value.starts) && Array.isArray(value.leases)
    return value.schema == 1 && numbers && collections
}
function validCooldown(value: Cooldown) {
    const timestamps = Number.isFinite(value.retryAt) && Number.isFinite(value.writtenAt) && Number.isFinite(value.settleUntil)
    return value.schema == 1 && timestamps
}

export function createProviderCoordinator(deps: {
    providerId: string, accountScope: string, config: ProviderBufferConfig, bucket?: ProviderBucket,
    memoryScope: object, now: () => number, pause: (ms: number) => Promise<void>,
}) {
    const config = deps.config
    const mode = deps.bucket ? 'r2-shared' : 'process-memory'
    const namespace = deps.providerId + ':' + deps.accountScope
    let resolvedStorage: ReturnType<typeof createProviderStorage> | null = null
    async function storage(signal?: AbortSignal) {
        signal?.throwIfAborted()
        if (!deps.bucket) return null
        if (resolvedStorage) return resolvedStorage
        // Only resolved adapters survive a request. An unfinished crypto Promise must retain its request owner.
        const scope = await withProviderSignal(() => providerBufferHash(namespace), signal)
        signal?.throwIfAborted()
        if (!resolvedStorage) resolvedStorage = createProviderStorage({bucket: deps.bucket, prefix: 'travel-source-buffer/v1/' + scope,
            maxBytes: config.maxSnapshotBytes, maxSharedReads: config.maxSharedReads, deadlineMs: config.deadlineMs})
        return resolvedStorage
    }
    let scopes = memoryScopes.get(deps.memoryScope)
    if (!scopes) {
        scopes = new Map()
        memoryScopes.set(deps.memoryScope, scopes)
    }
    let memory = scopes.get(namespace)
    if (!memory) {
        memory = {gate: initialGate(), retryAt: 0}
        scopes.set(namespace, memory)
    }
    const local = memory
    let wantedCooldown = 0

    function reservation(gate: Gate, key: string, now: number, shared: boolean): Admission & {gate?: Gate} {
        const limits = config.limits
        const starts = gate.starts.filter(time => time > now - limits.windowMs)
        const active = gate.leases.filter(lease => lease.expiresAt > now)
        const existing = active.find(lease => lease.key == key)
        if (existing) return {allowed: false, sequence: existing.sequence, expiresAt: existing.expiresAt, retryAt: now + config.sharedCheckMs}
        const minGap = shared ? Math.max(2_000, limits.minStartGapMs) : 0
        const maxStarts = shared ? limits.startsPerWindow : 45
        const rateAt = starts.length >= maxStarts ? starts[0] + limits.windowMs : 0
        const capacityAt = active.length >= limits.maxConcurrent ? Math.min(...active.map(lease => lease.expiresAt)) : 0
        const nextAt = Math.max(rateAt, capacityAt, shared ? gate.nextStartAt : 0)
        if (nextAt > now) return {allowed: false, sequence: 0, expiresAt: 0, retryAt: nextAt}
        const sequence = gate.sequence + 1
        const lease = {key, sequence, expiresAt: now + config.leaseMs}
        return {allowed: true, sequence, expiresAt: lease.expiresAt, retryAt: 0,
            gate: {schema: 1, sequence, nextStartAt: now + minGap, starts: [...starts, now], leases: [...active, lease]}}
    }

    async function admit(key: string, signal?: AbortSignal): Promise<Admission> {
        signal?.throwIfAborted()
        const now = deps.now()
        if (local.retryAt > now) return {allowed: false, sequence: 0, expiresAt: 0, retryAt: local.retryAt}
        const store = await storage(signal)
        signal?.throwIfAborted()
        if (!store) {
            if (local.retryAt > now) return {allowed: false, sequence: 0, expiresAt: 0, retryAt: local.retryAt}
            const result = reservation(local.gate, key, now, false)
            if (result.gate) local.gate = result.gate
            return result
        }
        const cooling = await store.read<Cooldown>('cooldown', signal)
        signal?.throwIfAborted()
        if (cooling.value && !validCooldown(cooling.value)) throw new Error('Некорректная общая пауза поставщика.')
        const cooldownAt = cooling.value ? Math.max(cooling.value.retryAt, cooling.value.settleUntil) : 0
        if (cooldownAt > now) return {allowed: false, sequence: 0, expiresAt: 0, retryAt: cooldownAt}
        const current = await store.read<Gate>('gate', signal)
        signal?.throwIfAborted()
        const gate = current.value ?? initialGate()
        if (!validGate(gate)) throw new Error('Некорректный общий координатор поставщика.')
        if (gate.leases.length > config.limits.maxConcurrent) throw new Error('Превышен размер общего координатора.')
        const completed = await Promise.all(gate.leases.map(lease => store.completion('snapshots/' + lease.key, lease.sequence, signal)))
        signal?.throwIfAborted()
        const observedCooldown = Math.max(0, ...completed.map(result => result.retryAt))
        // Re-read last: earlier cooldown and time observations may be obsolete after R2/HEAD latency.
        const latestCooling = await store.read<Cooldown>('cooldown', signal)
        signal?.throwIfAborted()
        if (latestCooling.value && !validCooldown(latestCooling.value)) throw new Error('Некорректная общая пауза поставщика.')
        const sharedCooldown = latestCooling.value ? Math.max(latestCooling.value.retryAt, latestCooling.value.settleUntil) : 0
        const admissionTime = deps.now()
        const knownCooldown = Math.max(local.retryAt, wantedCooldown, observedCooldown, sharedCooldown)
        if (knownCooldown > admissionTime) return {allowed: false, sequence: 0, expiresAt: 0, retryAt: knownCooldown}
        const leases = gate.leases.filter((lease, index) => lease.expiresAt > admissionTime && !completed[index].complete)
        const result = reservation({...gate, leases}, key, admissionTime, true)
        if (!result.gate) return result
        signal?.throwIfAborted()
        // A CAS conflict denies this admission. The caller retries through its owner, never in a hot loop.
        const stored = await store.write('gate', result.gate, current.etag, undefined, 0, signal)
        return stored ? result : {allowed: false, sequence: 0, expiresAt: 0, retryAt: deps.now() + 2_000}
    }

    async function persistCooldown(signal?: AbortSignal) {
        const store = await storage(signal)
        if (!store) {
            local.retryAt = Math.max(local.retryAt, wantedCooldown)
            return
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            signal?.throwIfAborted()
            const current = await store.read<Cooldown>('cooldown', signal)
            if (current.value && !validCooldown(current.value)) throw new Error('Некорректная общая пауза поставщика.')
            if (current.value && current.value.retryAt >= wantedCooldown) return
            const earliestWrite = current.value ? current.value.writtenAt + 1_100 : 0
            if (earliestWrite > deps.now()) await withProviderSignal(() => deps.pause(earliestWrite - deps.now()), signal)
            signal?.throwIfAborted()
            const now = deps.now()
            const value = {schema: 1, retryAt: Math.max(wantedCooldown, current.value?.retryAt ?? 0), writtenAt: now,
                settleUntil: now + 2_000} satisfies Cooldown
            const stored = await store.write('cooldown', value, current.etag, undefined, 0, signal)
            if (stored && value.retryAt >= wantedCooldown) return
            await withProviderSignal(() => deps.pause(1_100), signal)
        }
        throw new Error('Не удалось сохранить общую паузу поставщика.')
    }
    async function cooldown(retryAt: number, signal?: AbortSignal) {
        wantedCooldown = Math.max(wantedCooldown, retryAt)
        local.retryAt = Math.max(local.retryAt, retryAt)
        // Conditional updates preserve the maximum retry time without awaiting another request's I/O.
        await persistCooldown(signal)
    }
    function complete(key: string, sequence: number) {
        if (deps.bucket) return
        local.gate.leases = local.gate.leases.filter(lease => lease.key != key || lease.sequence != sequence)
    }
    return {source: {admit, storage}, control: {cooldown, complete}, health: {mode}}
}
