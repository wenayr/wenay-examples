import {readBoundedProviderText, withProviderSignal} from './provider-buffer-body.ts'
import {createAsyncQueue} from 'wenay-common2/client'

export interface ProviderBucketObject {
    etag: string
    text: () => Promise<string>
    customMetadata?: Record<string, string>
    size?: number
    body?: ReadableStream<Uint8Array>
}
export interface ProviderBucket {
    get: (key: string) => Promise<ProviderBucketObject | null>
    head?: (key: string) => Promise<{etag: string, customMetadata?: Record<string, string>} | null>
    put: (key: string, value: string, options: {
        onlyIf: Headers, httpMetadata: {contentType: string}, customMetadata?: Record<string, string>
    }) => Promise<{etag: string} | null>
}

export async function providerBufferHash(value: string) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function conditionalHeaders(etag: string | null) {
    return etag ? new Headers({'if-match': '"' + etag + '"'}) : new Headers({'if-none-match': '*'})
}

export function createProviderStorage(deps: {bucket: ProviderBucket, prefix: string, maxBytes: number, maxSharedReads?: number}) {
    const reads = createAsyncQueue(deps.maxSharedReads ?? 4)
    async function load<T>(suffix: string, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const key = deps.prefix + '/' + suffix
        const entry = await withProviderSignal(() => deps.bucket.get(key), signal)
        if (!entry) return {value: null, etag: null}
        const text = await readBoundedProviderText(entry, deps.maxBytes, signal)
        return {value: JSON.parse(text) as T, etag: entry.etag}
    }
    async function queued<T>(run: () => Promise<T>, signal?: AbortSignal) {
        signal?.throwIfAborted()
        try { return await reads.add(() => withProviderSignal(run, signal)) }
        finally {
            // Queue capacity is released by its task.finally reaction before this owner settles.
            await Promise.resolve()
        }
    }
    function read<T>(suffix: string, signal?: AbortSignal) { return queued(() => load<T>(suffix, signal), signal) }
    async function write(suffix: string, value: unknown, etag: string | null, sequence?: number, providerRetryAt = 0, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const text = JSON.stringify(value)
        if (new TextEncoder().encode(text).byteLength > deps.maxBytes) throw new Error('Превышен размер общего снимка цен.')
        return withProviderSignal(() => deps.bucket.put(deps.prefix + '/' + suffix, text, {
            onlyIf: conditionalHeaders(etag), httpMetadata: {contentType: 'application/json'},
            customMetadata: sequence == null ? undefined : {sequence: String(sequence), providerRetryAt: String(providerRetryAt)},
        }), signal)
    }
    async function completion(suffix: string, sequence: number, signal?: AbortSignal) {
        if (deps.bucket.head) {
            const entry = await queued(() => deps.bucket.head!(deps.prefix + '/' + suffix), signal)
            const published = Number(entry?.customMetadata?.sequence)
            const complete = Number.isSafeInteger(published) && published >= sequence
            const retryAt = complete ? Number(entry?.customMetadata?.providerRetryAt ?? 0) : 0
            return {complete, retryAt: Number.isFinite(retryAt) ? retryAt : 0}
        }
        const entry = await read<{sequence?: number, providerCooldownUntil?: number}>(suffix, signal)
        const complete = Number.isSafeInteger(entry.value?.sequence) && entry.value!.sequence! >= sequence
        return {complete, retryAt: complete ? entry.value?.providerCooldownUntil ?? 0 : 0}
    }
    return {read, write, completion}
}
