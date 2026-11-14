import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setImmediate} from 'node:timers/promises'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'

test('six active supplier requests queue another, deduplicate its readers and skip an abandoned queued request', {timeout: 2500}, async t => {
    const requests: {url: string, release: () => void, signal: AbortSignal | null | undefined}[] = []
    let active = 0
    let maximum = 0
    const fetcher = (async function supplier(input, init) {
        active++
        maximum = Math.max(maximum, active)
        return new Promise<Response>((resolve, reject) => {
            let finished = false
            const signal = init?.signal
            function finish(response?: Response) {
                if (finished) return
                finished = true
                active--
                signal?.removeEventListener('abort', aborted)
                if (response) resolve(response)
                else reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
            }
            function aborted() { finish() }
            function release() {
                finish(new Response(JSON.stringify({success: true, data: [], info: [['More results', false]]}),
                    {headers: {'Content-Type': 'application/json'}}))
            }
            requests.push({url: String(input), release, signal})
            signal?.addEventListener('abort', aborted, {once: true})
        })
    }) as typeof fetch
    t.after(() => requests.forEach(request => request.release()))
    const provider = createTezInventory({fetch: fetcher, now: () => new Date('2030-01-01T00:00:00Z')})
    function trip(day: number) {
        const date = '2030-01-' + String(day).padStart(2, '0')
        return {destinationId: 'hurghada', first: date, last: date, nights: 7, adults: 2, minTotal: 0, maxTotal: 500_000}
    }
    const first = Array.from({length: 6}, (_, index) => provider.window(trip(index + 1)))
    await setImmediate()
    assert.equal(requests.length, 6)
    const queued = provider.window(trip(7))
    const duplicate = new AbortController()
    const duplicateRead = provider.window(trip(7), duplicate.signal)
    duplicate.abort()
    await assert.rejects(duplicateRead, {name: 'AbortError'})
    const abandoned = new AbortController()
    const abandonedRead = provider.window(trip(8), abandoned.signal)
    abandoned.abort()
    await assert.rejects(abandonedRead, {name: 'AbortError'})
    assert.equal(requests.length, 6)
    requests[0].release()
    await setImmediate()
    assert.equal(requests.length, 7)
    assert.equal(requests[6].signal?.aborted, false)
    requests.forEach(request => request.release())
    const results = await Promise.all([...first, queued])
    assert.ok(results.every(result => result.source.status == 'live'))
    assert.equal(maximum, 6)
    assert.equal(requests.length, 7)
    const cached = await provider.window(trip(7))
    assert.equal(cached.source.status, 'cached')
    assert.equal(requests.length, 7)
    const retry = provider.window(trip(8))
    await setImmediate()
    assert.equal(requests.length, 8)
    requests[7].release()
    assert.equal((await retry).source.status, 'live')
})
