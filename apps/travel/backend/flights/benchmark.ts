import type {FlightBenchmark} from '../../src/flight-contract.ts'

/** Compute each result against the other observations of the same group, without sorting for each candidate. */
export function comparePrices<T>(items: T[], group: (v: T) => string | null, price: (v: T) => number) {
    const groups = new Map<string, T[]>()
    for (const item of items) {
        const key = group(item)
        if (key === null) continue
        const peers = groups.get(key)
        if (peers) peers.push(item)
        else groups.set(key, [item])
    }
    const results = new Map<T, FlightBenchmark>()
    for (const peers of groups.values()) {
        const count = peers.length - 1
        if (count < 2) continue
        peers.sort((a, b) => price(a) - price(b))
        peers.forEach((item, index) => {
            const other = (rank: number) => price(peers[rank < index ? rank : rank + 1])
            const median = Math.round((other(Math.floor((count - 1) / 2)) + other(Math.floor(count / 2))) / 2)
            if (price(item) < median) results.set(item, {median, count, saving: median - price(item)})
        })
    }
    return results
}
