import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createCrmRuntime, type CrmDefinition} from './runtime'
import {createProcess} from './process-resource'

async function waitFor(label: string, check: () => boolean) {
    const end = Date.now() + 18000
    while (!check()) {
        assert(Date.now() < end, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'crm-network-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    const descriptor = describeService(createCrmRuntime().definition)
    const nodes: ReturnType<typeof createProcess>[] = [], clients: ServiceClient<CrmDefinition>[] = []
    const handles: {close(): Promise<void>}[] = []
    async function login(account: string) {
        const answer = await fetch(url + '/api/crm/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({args: [{account, password: account + '-pass'}]})
        }).then(response => response.json())
        assert(answer.ok, JSON.stringify(answer))
        const client = createServiceClient<CrmDefinition>({definition: descriptor, url, auth: {token: answer.value.token}, placement: {rng: () => 0}})
        clients.push(client)
        await client.ready()
        await client.views.workspace.ready
        return client
    }
    async function crm(client: ServiceClient<CrmDefinition>) {
        const handle = client.resources.open('crm')
        handles.push(handle)
        await waitFor('crm ready', () => handle.status.state.phase == 'ready')
        return handle
    }
    try {
        for (const id of ['crm-a', 'crm-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_NODE_ID: id, SERVICE_UPSTREAM: url}})
            nodes.push(node)
            await node.ready
        }
        const manager = await login('manager'), customer = await login('customer'), owner = await login('owner'), outsider = await login('outsider')
        const managerResource = await crm(manager), customerResource = await crm(customer), outsideResource = await crm(outsider)
        const orgId = 'northstar', id = 'deal-aurora'
        async function detail() {return managerResource.current()!.remote.control.detail({orgId, id})}
        assert.equal(customer.views.workspace.store.state.deals.length, 1)
        assert(outsider.views.workspace.store.state.deals.every(deal => deal.orgId == 'harbor'))
        await assert.rejects(outsideResource.current()!.remote.control.detail({orgId, id}))
        const initial = (await detail()).deal.revision
        const race = await Promise.allSettled([
            manager.commands.interactionAdd('race-a', {orgId, id, revision: initial, body: 'Internal A', private: true}),
            manager.commands.interactionAdd('race-b', {orgId, id, revision: initial, body: 'Internal B', private: true})
        ])
        assert.equal(race.filter(result => result.status == 'fulfilled').length, 1)
        assert(!(await customerResource.current()!.remote.control.detail({orgId, id})).deal.interactions.some(item => item.body.startsWith('Internal')))
        await manager.commands.proposalSave('draft', {
            orgId,
            id,
            revision: (await detail()).deal.revision,
            title: 'Пилот',
            body: 'Две недели с согласованием.',
            amount: 190000
        })
        assert.equal((await customerResource.current()!.remote.control.detail({orgId, id})).deal.draft, null)
        const published = await manager.commands.proposalPublish('publish', {orgId, id, revision: (await detail()).deal.revision})
        const approval = {orgId, id, revision: (await detail()).deal.revision, version: published.version, decision: 'accept' as const, body: ''}
        const accepted = await customer.commands.proposalRespond('accept', approval)
        await manager.views.taskBoards.ready
        await waitFor('accepted proposal creates live task', function linked() {
            const boards = manager.views.taskBoards.store.state.boards
            return boards.some(board => board.tasks.some(task => task.source?.kind == 'deal'))
        })
        assert.deepEqual(await customer.commands.proposalRespond('accept', approval), accepted)
        const imported = manager.resources.open('imports')
        handles.push(imported)
        await waitFor('imports ready', () => imported.status.state.phase == 'ready')
        const upload = await imported.current()!.remote.control.upload({
            orgId,
            companyId: 'company-aurora',
            name: 'network.csv',
            bytes: Buffer.from('name,email\nNetwork,network@example.com')
        })
        await imported.current()!.remote.ai.createRun({
            requestId: 'network-import',
            kind: 'import',
            resourceIds: [upload.id],
            input: {orgId, importId: upload.id, revision: upload.revision}
        })
        await manager.views.imports.ready
        await waitFor('import completed over RPC', function completed() {
            return manager.views.imports.store.state.imports.some(function done(item) {
                return item.id == upload.id && item.status == 'completed'
            })
        })
        const importRevision = manager.views.imports.store.state.imports.find(item => item.id == upload.id)!.revision
        const endpoint = customer.view.endpoint()!
        assert(endpoint.nodeId != 'leader')
        const store = customer.views.workspace.store
        await nodes[endpoint.nodeId == 'crm-a' ? 0 : 1].control.stop(true)
        await waitFor('view failover', () => !!customer.view.endpoint() && customer.view.endpoint()!.nodeId != endpoint.nodeId)
        assert.equal(customer.views.workspace.store, store)
        assert.equal((await customerResource.current()!.remote.control.detail({orgId, id})).deal.proposals.length, 1)
        const org = owner.views.workspace.store.state.organizations.find(org => org.id == orgId)!
        await owner.commands.memberRole('revoke', {orgId, revision: org.revision, account: 'customer', role: 'none'})
        await waitFor('revocation clears view', () => (customer.views.workspace.store.state.deals ?? []).length == 0)
        await assert.rejects(customerResource.current()?.remote.control.detail({orgId, id}) ?? Promise.reject(new Error('Resource revoked')))
        for (const handle of handles) await handle.close()
        for (const client of clients) client.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restored = await login('manager'), restoredCrm = await crm(restored)
        assert.equal((await restoredCrm.current()!.remote.control.detail({orgId, id})).deal.decisions[0].decision, 'accept')
        await restored.views.taskBoards.ready
        assert.equal(restored.views.taskBoards.store.state.boards.flatMap(board => board.tasks).filter(task => task.source?.kind == 'deal').length, 1)
        const restoredImports = restored.resources.open('imports')
        handles.push(restoredImports)
        await waitFor('restored import ready', () => restoredImports.status.state.phase == 'ready')
        const saved = await restoredImports.current()!.remote.control.detail({orgId, id: upload.id, revision: importRevision})
        assert.equal(saved.rows[0].status, 'imported')
        assert.equal(restored.views.workspace.store.state.contacts.filter(contact => contact.email == 'network@example.com').length, 1)
        console.log('PASS CRM network: authority + 2 serving nodes, revision race, private projections, accepted proposal/task, CSV import, view failover, immediate revoke and durable proposals/tasks/contact import restart')
    } finally {
        for (const handle of handles) await handle.close().catch(() => {})
        for (const client of clients) client.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('crm-network-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
