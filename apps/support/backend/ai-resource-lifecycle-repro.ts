import assert from 'node:assert/strict'
import {createAiRunClient, createAiRunHost, type AiRunStore, type AiRunRemote} from 'wenay-common2/ai'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import type {ServiceResourceContext, tServiceDefinition} from 'wenay-common2/service'

async function waitFor(check: () => boolean) {
    const until = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < until, 'SC1 lifecycle timeout')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

// Run in its own process: an unexpected library timer throw must remain visible.
async function main() {
    const runs = createAiRunHost({runner: {run({run}) {
        if (run.kind != 'slow') return {result: {done: true}}
        return new Promise<{result: {done: boolean}}>(function later(resolve) {
            setTimeout(() => resolve({result: {done: true}}), 25)
        })
    }}})
    const definition = {
        name: 'ai-resource-lifecycle', storeId: 'lifecycle', originId: 'authority',
        initial: {allowed: true as boolean}, commands: {},
        access: {rolesOf: (state: {allowed: boolean}) => state.allowed ? ['member'] : []},
        resources: {assistant: {allow: ['member'], placement: 'authority', open(ctx: ServiceResourceContext) {
            const connection = runs.connection(ctx.principal.account)
            return {facade: {ai: connection.fragment}, close: connection.close}
        }}},
    } satisfies tServiceDefinition<{allowed: boolean}>
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1'}, rest: false})
    const session = createServiceClient({definition: describeService(definition), url: host.url,
        auth: {token: host.leader.identity.login('worker').token}})
    const resource = session.resources.open('assistant')
    let client: Pick<ReturnType<typeof createAiRunClient>, 'store' | 'ready' | 'createRun' | 'cancelRun' | 'close'> | undefined
    const failures: unknown[] = []
    function safeStateClient(remote: AiRunRemote) {
        const store = createStore<AiRunStore>({runs: {}, approvals: {}, inputs: {}})
        const sync = syncStoreReplay(store, remote.state, {onError(error) {
            failures.push(error)
            store.replace({runs: {}, approvals: {}, inputs: {}})
        }})
        return {store, ready: sync.ready, close: sync,
            async createRun(input: Parameters<AiRunRemote['createRun']>[0]) {return remote.createRun(input)},
            async cancelRun(id: string, reason?: string) {return remote.cancelRun(id, reason)}}
    }
    const offStatus = resource.status.on(function changed(status) {
        if (process.argv.includes('--dispose-on-status') && status.phase != 'ready') client?.close()
    })
    try {
        await waitFor(() => resource.status.state.phase == 'ready')
        const remote = resource.current()!.remote.ai
        client = process.argv.includes('--safe-state')
            ? safeStateClient(remote)
            : createAiRunClient({remote})
        await client.ready
        const run = await client.createRun({requestId: 'first', kind: 'fixture', input: null})
        await waitFor(() => client!.store.state.runs[run.id]?.state == 'completed')
        if (process.argv.includes('--dispose-before-revoke')) client.close()
        console.log('Revoking resource; client ready was already awaited')
        host.leader.line.control.store.state.allowed = false
        await waitFor(() => resource.status.state.phase == 'denied')
        await new Promise(resolve => setTimeout(resolve, 50))
        if (process.argv.includes('--safe-state')) {
            assert(failures.length > 0, 'Late replay failure must reach the explicit error handler')
            assert.deepEqual(client.store.state.runs, {}, 'Revoked projection is cleared')
            const generation = resource.status.state.generation
            client.close()
            host.leader.line.control.store.state.allowed = true
            await waitFor(() => resource.status.state.phase == 'ready' && resource.status.state.generation > generation)
            client = safeStateClient(resource.current()!.remote.ai)
            await client.ready
            assert.equal(client.store.state.runs[run.id]?.state, 'completed', 'New SC1 generation restores allowed state')
            const pending = await client.createRun({requestId: 'cancel-after-regrant', kind: 'slow', input: null})
            await client.cancelRun(pending.id, 'User cancelled')
            await waitFor(() => client!.store.state.runs[pending.id]?.state == 'cancelled')
            await new Promise(resolve => setTimeout(resolve, 50))
            assert.equal(client.store.state.runs[pending.id]?.state, 'cancelled', 'Late runner result stays cancelled')
            console.log('PASS state-only public replay: explicit error, cleared state, new SC1 generation, cancellation')
        }
        console.log('PASS resource revoke completed without an uncaught replay error')
    } finally {
        offStatus()
        client?.close()
        await resource.close()
        session.close()
        await host.close()
        runs.close()
    }
}

void main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
