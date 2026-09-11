import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import type {FormsDefinition} from './runtime'
import {createProcess} from './process-resource'

async function waitFor(label: string, check: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 15000
    while (!await check()) {assert(Date.now() < deadline, 'Timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 20))}
}
async function main() {
    const started = performance.now(), temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'forms-network-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, 'authority'),
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    const nodes: ReturnType<typeof createProcess>[] = [], clients: ServiceClient<FormsDefinition>[] = [], resources: {close(): Promise<void>}[] = []
    async function client(account: string, password = account + '-pass', rng = 0) {
        const definition = await fetch(url + '/api/client').then(response => response.json()) as ReturnType<typeof describeService<FormsDefinition>>
        const session = createServiceClient<FormsDefinition>({definition, url, auth: {credentials: {account, password}}, placement: {rng: () => rng}})
        clients.push(session)
        await session.ready()
        if (account != 'respondent') await session.views.workspace.ready
        return session
    }
    async function resource<K extends keyof FormsDefinition['resources']>(client: ServiceClient<FormsDefinition>, name: K) {
        const handle = client.resources.open(name)
        resources.push(handle)
        await waitFor(name + ' ready', () => handle.status.state.phase == 'ready')
        return handle
    }
    async function stop() {
        for (const resource of resources.splice(0)) await resource.close().catch(() => {})
        for (const client of clients.splice(0)) client.close()
        for (const node of nodes.splice(0)) await node.control.stop()
        await host.control.stop()
    }
    const orgId = 'northstar', id = 'form-feedback'
    try {
        for (const nodeId of ['forms-a', 'forms-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_DATA_DIR: path.join(directory, nodeId), SERVICE_NODE_ID: nodeId, SERVICE_UPSTREAM: url}})
            nodes.push(node)
            await node.ready
        }
        const owner = await client('owner'), analyst = await client('analyst', 'analyst-pass', 0.999), outsider = await client('outsider')
        await waitFor('two different serving nodes', () => owner.view.endpoint()?.nodeId != 'leader' && analyst.view.endpoint()?.nodeId != 'leader' && owner.view.endpoint()?.nodeId != analyst.view.endpoint()?.nodeId)
        const endpoints = [owner.view.endpoint()!.nodeId, analyst.view.endpoint()!.nodeId]
        const editor = await resource(owner, 'editor')
        const published = await editor.current()!.remote.control.publish({orgId, id, revision: 1, requestId: 'network-publication'})
        assert(published.token)
        const a = await client('respondent', published.token), b = await client('respondent', published.token, 0.999)
        const formA = await resource(a, 'publicform'), formB = await resource(b, 'publicform')
        const startedBatch = performance.now(), latencies: number[] = []
        const outputs = await Promise.all(Array.from({length: 20}, async (_, index) => {
            const start = performance.now()
            const result = await (index % 2 ? formA : formB).current()!.remote.control.submit({version: 1, nonce: 'measured-response-' + index,
                answers: {rating: index % 5 + 1, recommend: false, details: 'PRIVATE_MEASURED_RESPONSE_' + index}})
            latencies.push(performance.now() - start)
            return result
        }))
        const elapsed = performance.now() - startedBatch
        latencies.sort((a, b) => a - b)
        await waitFor('both aggregate replicas', () => owner.views.workspace.store.state.aggregates[0]?.count == 20 && analyst.views.workspace.store.state.aggregates[0]?.count == 20)
        assert.equal(owner.views.workspace.store.state.aggregates[0].fields.find(field => field.id == 'rating')!.sum, 60)
        assert.equal(outsider.views.workspace.store.state.aggregates.length, 0)
        assert.equal(JSON.stringify(analyst.views.workspace.store.snapshot()).includes('PRIVATE_MEASURED_RESPONSE'), false)
        const duplicate = await formB.current()!.remote.control.submit({version: 1, nonce: 'measured-response-0', answers: {rating: 1, recommend: false, details: 'PRIVATE_MEASURED_RESPONSE_0'}})
        assert.equal(duplicate.duplicate, true)
        assert.equal(new Set(outputs.map(value => value.id)).size, 20)
        const before = owner.view.endpoint()!, mirror = owner.views.workspace.store
        await nodes[before.nodeId == 'forms-a' ? 0 : 1].control.stop(true)
        await waitFor('serving node failover', () => !!owner.view.endpoint() && owner.view.endpoint()!.nodeId != before.nodeId)
        assert.equal(owner.views.workspace.store, mirror)
        await waitFor('resource remains available', () => formA.status.state.phase == 'ready')
        await formA.current()!.remote.control.submit({version: 1, nonce: 'after-serving-failure', answers: {rating: 5, recommend: true}})
        await waitFor('accepted after failover', () => owner.views.workspace.store.state.aggregates[0]?.count == 21)
        const answers = await resource(analyst, 'answers')
        assert.equal((await answers.current()!.remote.control.list({orgId, formId: id, version: 0, offset: 0, limit: 100})).total, 21)
        await owner.commands.answerDelete('network-delete', {orgId, formId: id, id: outputs[0].id})
        await waitFor('erasure compacted', () => !readFileSync(path.join(env.SERVICE_DATA_DIR, 'forms.jsonl'), 'utf8').includes('PRIVATE_MEASURED_RESPONSE_0'))
        const retained = answers.current()!.remote
        await owner.commands.memberRole('revoke-live-analyst', {orgId, revision: 1, account: 'analyst', role: 'none'})
        await assert.rejects(retained.control.list({orgId, formId: id, version: 0, offset: 0, limit: 100}))
        await stop()
        host = createProcess({script: 'server.ts', env}); url = await host.ready
        const restored = await client('owner'), restoredRespondent = await client('respondent', published.token)
        assert.equal(restored.views.workspace.store.state.aggregates[0].count, 20)
        assert.equal(restored.views.workspace.store.state.aggregates[0].fields.find(field => field.id == 'rating')!.sum, 64)
        const restoredPublic = await resource(restoredRespondent, 'publicform')
        assert.equal((await restoredPublic.current()!.remote.control.submit({version: 1, nonce: 'measured-response-0', answers: {rating: 1, recommend: false, details: 'PRIVATE_MEASURED_RESPONSE_0'}})).deleted, true)
        const restoredEditor = await resource(restored, 'editor')
        assert.equal((await restoredEditor.current()!.remote.control.publish({orgId, id, revision: 1, requestId: 'network-publication'})).token, null)
        console.log(JSON.stringify({check: 'forms measured local batch', responses: 20, clients: 2, servingNodes: endpoints, elapsedMs: Math.round(elapsed), responsesPerSecond: Number((20000 / elapsed).toFixed(1)), p50Ms: Math.round(latencies[9]), p95Ms: Math.round(latencies[18]), scope: 'small local acceptance sample, not a production benchmark'}))
        console.log('PASS forms network: authority + 2 serving nodes, small concurrent response stream, live aggregate convergence/privacy, node failover, staff revoke, durable restart and compacted deletion (' + Math.round(performance.now() - started) + ' ms)')
    } finally {
        await stop()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('forms-network-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
