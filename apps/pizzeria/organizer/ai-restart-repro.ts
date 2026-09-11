import assert from 'node:assert/strict'
import {createAiRunHost} from 'wenay-common2/ai'

async function main() {
    let calls = 0
    const deps = {runner: {run() {calls++; return {result: 'fixture'}}}}
    let host = createAiRunHost(deps)
    let session = host.connection('worker')
    const request = {requestId: 'one-intent', kind: 'fixture', input: {text: 'hello'}}
    try {
        session.fragment.createRun(request)
        await new Promise(resolve => setTimeout(resolve, 10))
        session.fragment.createRun(request)
        assert.equal(calls, 1)
        session.close()
        host.close()
        host = createAiRunHost(deps)
        session = host.connection('worker')
        session.fragment.createRun(request)
        await new Promise(resolve => setTimeout(resolve, 10))
        assert.equal(calls, 2)
        console.log('REPRODUCED A1: same owner/request deduplicated within host but invoked again after recreation; no published initial/persistence port, no paid calls')
    } finally {session.close(); host.close()}
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
