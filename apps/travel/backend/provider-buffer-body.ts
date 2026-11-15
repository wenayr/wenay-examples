export async function withProviderSignal<T>(run: () => Promise<T>, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (!signal) return run()
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_, reject) => {rejectAbort = reject})
    function abort() { rejectAbort(signal!.reason) }
    signal.addEventListener('abort', abort, {once: true})
    try { return await Promise.race([run(), aborted]) }
    finally { signal.removeEventListener('abort', abort) }
}

export async function readBoundedProviderText(input: {
    size?: number, body?: ReadableStream<Uint8Array> | null, text: () => Promise<string>,
}, maxBytes: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (input.size != null && input.size > maxBytes) throw new Error('Превышен размер ответа источника.')
    if (!input.body) {
        const text = await withProviderSignal(() => input.text(), signal)
        if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Превышен размер ответа источника.')
        return text
    }
    const reader = input.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    try {
        while (true) {
            const chunk = await withProviderSignal(() => reader.read(), signal)
            if (chunk.done) return text + decoder.decode()
            bytes += chunk.value.byteLength
            if (bytes > maxBytes) throw new Error('Превышен размер ответа источника.')
            text += decoder.decode(chunk.value, {stream: true})
        }
    } catch (error) {
        void reader.cancel().catch(() => {})
        throw error
    } finally { reader.releaseLock() }
}
