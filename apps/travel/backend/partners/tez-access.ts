// Both the public package search and the price calendar use the same supplier quota per process.
const limiters = new WeakMap<typeof fetch, number[]>()
function recentStarts(request: typeof fetch, now: number) {
    let starts = limiters.get(request)
    if (!starts) {
        starts = []
        limiters.set(request, starts)
    }
    while (starts.length && starts[0] <= now - 60_000) starts.shift()
    return starts
}

export function tezSearchRetryAt(request: typeof fetch, now: number) {
    const starts = recentStarts(request, now)
    return starts.length >= 45 ? starts[0] + 60_000 : null
}

export function allowTezSearch(request: typeof fetch, now: number) {
    const starts = recentStarts(request, now)
    if (starts.length >= 45) return false
    starts.push(now)
    return true
}
