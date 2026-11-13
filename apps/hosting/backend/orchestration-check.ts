import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdtemp, realpath, rm, access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createReconciler, createResourceScope, ResourceCloseTimeoutError} from 'wenay-common2'
import {startDockerAgent} from './agent'
import {startLxdAgent} from './lxd-agent'

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function reconcilerCheck() {
    let value = 0
    let notify = () => {}
    let unsubscribed = 0
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const snapshots: number[] = []
    let active = 0
    const worker = createReconciler({
        read: () => value,
        subscribe(request) {
            notify = request
            return function off() {unsubscribed++}
        },
        async run(snapshot) {
            assert.equal(++active, 1, 'passes must be serial')
            snapshots.push(snapshot)
            if (snapshots.length == 1) {
                entered.resolve()
                await release.promise
            }
            active--
        },
    })
    try {
        for (let i = 0; i < 100; i++) notify()
        await entered.promise
        value = 1
        for (let i = 0; i < 100; i++) notify()
        release.resolve()
        await worker.control.idle()
        assert.deepEqual(snapshots, [0, 1], 'burst during IO becomes one fresh pass')
        const closing = worker.close()
        assert.equal(worker.close(), closing)
        await closing
        notify()
        await worker.control.idle()
        assert.equal(unsubscribed, 1)
        assert.equal(snapshots.length, 2)
    } finally {release.resolve()
    await worker.close()}

    let passes = 0
    let mode: 'retry' | 'ok' | 'fail' = 'retry'
    const failure = new Error('provider unavailable')
    const retryEntered = Promise.withResolvers<void>()
    const errors: unknown[] = []
    const retrying = createReconciler({read: () => mode,
        run(snapshot, {retry}) {
            passes++
            if (snapshot == 'retry') {
                retry('operation', 30)
                retry('operation', 30)
                if (passes == 2) retryEntered.resolve()
            }
            if (snapshot == 'fail') throw failure
        },
    })
    const off = retrying.events.errors(error => errors.push(error))
    try {
        retrying.control.request()
        await retryEntered.promise
        await retrying.control.idle()
        mode = 'ok'
        retrying.control.request()
        await retrying.control.idle()
        const successful = passes
        await pause(70)
        assert.equal(passes, successful, 'fresh successful pass cancels obsolete retry')
        mode = 'fail'
        retrying.control.request()
        await retrying.control.idle()
        assert.deepEqual(errors, [failure])
        assert.equal(retrying.view.error(), failure)
        mode = 'retry'
        retrying.control.request()
        await retrying.control.idle()
        await retrying.close()
        const closed = passes
        await pause(70)
        assert.equal(passes, closed, 'close clears pending retries')
    } finally {await retrying.close()
    off()}

    const started = Promise.withResolvers<void>()
    const finishing = Promise.withResolvers<void>()
    let aborted = false
    let complete = false
    const cancellable = createReconciler({read: () => null,
        async run(_snapshot, {signal}) {
            signal.addEventListener('abort', function abort() {aborted = true}, {once: true})
            started.resolve()
            await finishing.promise
        },
    })
    try {
        cancellable.control.request()
        await started.promise
        const close = cancellable.close().then(function closed() {complete = true})
        await Promise.resolve()
        assert(aborted, 'close signals active IO immediately')
        assert.equal(complete, false, 'close awaits the actual pass completion')
        finishing.resolve()
        await close
    } finally {finishing.resolve()
    await cancellable.close()}
    console.log('PASS H1 public reconciler: bursts across IO, fresh reads, serial passes, keyed retry, obsolete timer removal, errors, shared close and unsubscribe')
}

async function ownershipCheck() {
    const scope = createResourceScope()
    const closed: string[] = []
    const original = new Error('startup failed')
    const disposal = new Error('close failed')
    scope.resource.own(function lock() {closed.push('lock')})
    scope.resource.own(function client() {
        closed.push('client')
        throw disposal
    })
    await assert.rejects(scope.start(async function start() {throw original}), error => error == original)
    assert.deepEqual(closed, ['client', 'lock'], 'cleanup continues after a failed disposer')
    await assert.rejects(scope.settled(), AggregateError)

    const late = createResourceScope({closeTimeoutMs: 10})
    const opening = Promise.withResolvers<void>()
    const resource = Promise.withResolvers<string>()
    let freed = false
    late.resource.own(function releaseLock() {assert(freed, 'lock waits for the late dependent resource')})
    const acquired = late.resource.acquire({
        async open() {
            opening.resolve()
            return resource.promise
        },
        close(value) {
            assert.equal(value, 'connection')
            freed = true
        },
    })
    const rejected = assert.rejects(acquired)
    await opening.promise
    const closing = late.close()
    assert.equal(late.close(), closing)
    await assert.rejects(closing, ResourceCloseTimeoutError)
    assert.equal(freed, false, 'deadline is not actual termination')
    resource.resolve('connection')
    await rejected
    await late.settled()
    assert(freed)

    const group = createResourceScope()
    const finished = Promise.withResolvers<void>()
    let transportClosed = false
    group.resource.own(function releaseLock() {assert(transportClosed)})
    group.resource.parallel([
        async function pass() {
            await finished.promise
            assert(transportClosed)
        },
        function transport() {
            transportClosed = true
            finished.resolve()
        },
    ])
    await group.close()
    console.log('PASS H2 public ownership: original startup error, continued reverse cleanup, late acquisition, shared deadline/actual settlement and parallel IO shutdown before lock release')
}

async function partialAgentStart() {
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'hosting-start-check-'))
    const server = http.createServer(function unavailable(_request, response) {
        response.writeHead(503)
        response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + (server.address() as {port: number}).port
    const deps = {url, account: 'fixture-agent', password: 'fixture-only', socketPath: 'unused', directory}
    try {
        for (let i = 0; i < 2; i++) {
            await assert.rejects(startDockerAgent(deps), /control service descriptor unavailable/)
            await assert.rejects(access(path.join(directory, 'agent.lock')), {code: 'ENOENT'})
            await assert.rejects(startLxdAgent({...deps, project: 'test', pool: 'test', network: 'test'}), /control service descriptor unavailable/)
            await assert.rejects(access(path.join(directory, 'agent.lock')), {code: 'ENOENT'})
        }
        console.log('PASS both real agent factories: failed descriptor startup releases lock and preserves cause; repeated start reaches the original failure again')
    } finally {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

async function main() {
    await reconcilerCheck()
    await ownershipCheck()
    await partialAgentStart()
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
