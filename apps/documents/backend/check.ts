import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createDocumentRuntime, type DocumentDefinition} from './runtime'
import {createProcess} from './process-resource'

async function waitFor(label: string, check: () => boolean) {
    const until = Date.now() + 18000
    while (!check()) {
        assert(Date.now() < until, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 30))
    }
}

async function main() {
    const started = Date.now()
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'documents-network-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const definition = createDocumentRuntime().definition
    const nodes: ReturnType<typeof createProcess>[] = []
    const clients: ServiceClient<DocumentDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []
    async function client(account: string) {
        const answer = await fetch(url + '/api/documents/login', {method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({args: [{account, password: account + '-pass'}]})}).then(response => response.json())
        assert(answer.ok, JSON.stringify(answer))
        const session = createServiceClient<DocumentDefinition>({definition: describeService(definition), url,
            auth: {token: answer.value.token}, placement: {rng: () => 0}})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    async function processor(session: ServiceClient<DocumentDefinition>) {
        const resource = session.resources.open('processor')
        resources.push(resource)
        await waitFor('processor resource ready', () => resource.status.state.phase == 'ready')
        return resource
    }
    try {
        for (const id of ['documents-a', 'documents-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_NODE_ID: id, SERVICE_UPSTREAM: url}})
            nodes.push(node)
            await node.ready
        }
        const customer = await client('customer'), reviewer = await client('reviewer'), outsider = await client('outsider')
        const resource = await processor(customer), remote = resource.current()!.remote
        const outside = await processor(outsider)
        const orgId = 'northstar', bytes = Buffer.from('name,amount\nConsulting,42\nHosting,7')
        const uploaded = await remote.control.upload({orgId, name: 'invoice.csv', bytes})
        await waitFor('reviewer sees live upload', () => reviewer.views.workspace.store.state.documents.some(item => item.id == uploaded.id))
        assert.equal(outsider.views.workspace.store.state.documents.length, 0)
        await assert.rejects(outside.current()!.remote.control.download({orgId, id: uploaded.id}))
        const runInput = {requestId: 'parse-invoice', kind: 'extract', resourceIds: [uploaded.id],
            input: {orgId, documentId: uploaded.id, revision: uploaded.revision, processor: 'node'}}
        const run = await remote.ai.createRun(runInput)
        const item = () => customer.views.workspace.store.state.documents.find(item => item.id == uploaded.id)!
        await waitFor('real CSV completed', () => item()?.status == 'review' || item()?.status == 'failed')
        assert.equal(item().status, 'review')
        assert.equal((await remote.ai.createRun(runInput)).id, run.id, 'run receipt deduplicates')
        const reviewResource = await processor(reviewer)
        const detail = await reviewResource.current()!.remote.control.detail({orgId, id: uploaded.id, revision: item().revision})
        assert.deepEqual(detail.table.rows, [['Consulting', '42'], ['Hosting', '7']])
        const editInput = {orgId, id: uploaded.id, revision: item().revision, index: 0, values: ['Consulting', '43'], comment: 'Сверено с договором'}
        const edited = await reviewer.commands.documentRow('checked-amount', editInput)
        const approved = await reviewer.commands.documentApprove('approve-invoice', {orgId, id: uploaded.id, revision: edited.revision})
        const exported = await remote.control.export({orgId, id: uploaded.id, revision: approved.revision, format: 'json'})
        assert.equal(JSON.parse(Buffer.from(exported.bytes).toString()).rows[0][1], '43')
        const endpoint = customer.view.endpoint()!
        assert(endpoint.nodeId != 'leader')
        const store = customer.views.workspace.store
        await nodes[endpoint.nodeId == 'documents-a' ? 0 : 1].control.stop(true)
        await waitFor('serving failover', () => !!customer.view.endpoint() && customer.view.endpoint()!.nodeId != endpoint.nodeId)
        await waitFor('processing resource available', () => resource.status.state.phase == 'ready')
        assert.equal(customer.views.workspace.store, store)
        assert.deepEqual(Buffer.from((await resource.current()!.remote.control.download({orgId, id: uploaded.id})).bytes), bytes)
        for (const resource of resources) await resource.close()
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restored = await client('reviewer'), restoredResource = await processor(restored)
        const restoredItem = restored.views.workspace.store.state.documents.find(item => item.id == uploaded.id)!
        assert.equal(restoredItem.status, 'approved')
        assert.equal(restoredItem.revision, approved.revision)
        assert.deepEqual(await restored.commands.documentRow('checked-amount', editInput), edited)
        const restoredExport = await restoredResource.current()!.remote.control.export({orgId, id: uploaded.id, revision: approved.revision, format: 'json'})
        assert.equal(JSON.parse(Buffer.from(restoredExport.bytes).toString()).rows[0][1], '43')
        assert.deepEqual(Buffer.from((await restoredResource.current()!.remote.control.download({orgId, id: uploaded.id})).bytes), bytes)
        console.log('PASS documents: authority + 2 serving processes, binary upload, real extraction, tenant isolation, review/export, node failover and durable restart (' + (Date.now() - started) + ' ms)')
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const client of clients) client.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('documents-network-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
