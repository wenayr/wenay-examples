import assert from 'node:assert/strict'
import {createAsyncQueue} from 'wenay-common2'
import {createStore} from 'wenay-common2/observe'
import {installServiceSignals} from 'wenay-common2/service/host'

async function main() {
    const store = createStore({active: 'old', operations: ['old']})
    const live = store.state
    const snapshot = store.snapshot()
    await Promise.resolve().then(function update() {
        store.state.active = 'new'
        store.state.operations.push('new')
    })
    assert.equal(live.active, 'new')
    assert.deepEqual(live.operations, ['old', 'new'])
    assert.equal(snapshot.active, 'old')
    assert.deepEqual(snapshot.operations, ['old'])
    console.log('PASS existing Store.snapshot isolates an async pass; state remains live by design')

    const queue = createAsyncQueue(1)
    let calls = 0
    const results = Array.from({length: 10}, ()=>queue.add(async function run() {
        calls++
        await Promise.resolve()
        return calls
    }))
    await Promise.all(results)
    await queue.onIdle()
    assert.equal(calls, 10)
    assert.equal(queue.size, 0)
    console.log('PASS existing async queue executes all queued tasks; no coalescing is implied')

    const before = ['SIGTERM', 'SIGINT', 'message'].map(event=>process.listenerCount(event))
    let closes = 0
    const signals = installServiceSignals({async close() {
        closes++
        await Promise.resolve()
    }})
    await Promise.all([signals.close(), signals.close()])
    assert.equal(closes, 1)
    assert.deepEqual(['SIGTERM', 'SIGINT', 'message'].map(event=>process.listenerCount(event)), before)
    console.log('PASS existing signal lifecycle closes once and removes its handlers')
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
