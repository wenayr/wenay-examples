export function estimatedCacheBytes(value: unknown) {
    // Covers object/Map/array indexes beyond their wire representation, without retaining that representation.
    return new TextEncoder().encode(JSON.stringify(value)).byteLength * 4
}

export function createBoundedCache<T>(deps: {maxEntries: number, maxBytes: number}) {
    const entries = new Map<string, {value: T, bytes: number}>()
    let bytes = 0
    function remove(key: string) {
        const previous = entries.get(key)
        if (!previous) return
        bytes -= previous.bytes
        entries.delete(key)
    }
    function get(key: string) {
        const entry = entries.get(key)
        if (!entry) return undefined
        entries.delete(key)
        entries.set(key, entry)
        return entry.value
    }
    function set(input: {key: string, value: T, bytes: number}) {
        remove(input.key)
        const weight = input.bytes + new TextEncoder().encode(input.key).byteLength * 2 + 128
        if (!Number.isFinite(weight) || weight > deps.maxBytes) return
        function exceedsBudget() { return entries.size >= deps.maxEntries || bytes + weight > deps.maxBytes }
        while (entries.size && exceedsBudget()) remove(entries.keys().next().value!)
        entries.set(input.key, {value: input.value, bytes: weight})
        bytes += weight
    }
    return {view: {get}, control: {set}, health: {snapshot: () => ({entries: entries.size, bytes, maxBytes: deps.maxBytes})}}
}
