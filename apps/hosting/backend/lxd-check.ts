import assert from 'node:assert/strict'
import http from 'node:http'
import {randomBytes, generateKeyPairSync} from 'node:crypto'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as pause} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createHostingDefinition, type HostingState} from './service'
import {createLxdResource} from './lxd'
import {startLxdAgent} from './lxd-agent'
import {machineIdentity, type MachineSpec} from './machine-spec'

async function waitFor(check: ()=>boolean) {
    const deadline = Date.now()+10_000
    while (!check()) {if (Date.now() > deadline) throw new Error('machine did not reconcile'); await pause(20)}
}

async function main() {
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'hosting-lxd-check-'))
    const socketPath = process.platform == 'win32' ? '\\\\.\\pipe\\hosting-lxd-'+randomBytes(8).toString('hex') : path.join(directory, 'lxd.sock')
    type Instance = {name: string, type: string, profiles: string[], config: Record<string, string>, devices: Record<string, Record<string, string>>, status_code: number}
    const instances = new Map<string, Instance>()
    const operations = new Map<string, ()=>number>()
    let creates = 0
    let changes = 0
    let loseCreate = false
    let failChange = false
    let supportsVm = true
    const image = 'a'.repeat(64)
    const key = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).subarray(-32)
    const sshKey = 'ssh-ed25519 '+Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020', 'hex'), key]).toString('base64')
    const spec: MachineSpec = {kind: 'container', image, cpus: 1, memoryMiB: 512, diskGiB: 4, sshKey}
    const fixture = http.createServer(async function lxd(request, response) {
        try {
            const url = new URL(request.url!, 'http://localhost')
            assert.equal(url.searchParams.get('project'), 'hosting-test', 'every request stays in the configured LXD project')
            response.setHeader('content-type', 'application/json')
            function reply(metadata: unknown, status = 200) {response.writeHead(status); response.end(JSON.stringify({type: status >= 400 ? 'error' : 'sync', status_code: status, error_code: status >= 400 ? status : undefined, metadata}))}
            function operation(apply: ()=>number) {
                const id = randomBytes(16).toString('hex')
                operations.set(id, apply)
                response.writeHead(202)
                response.end(JSON.stringify({type: 'async', status_code: 100, operation: '/1.0/operations/'+id, metadata: {id}}))
            }
            if (url.pathname == '/1.0') {reply({auth: 'trusted', environment: {instance_types: supportsVm ? ['container', 'virtual-machine'] : ['container']}}); return}
            if (url.pathname.startsWith('/1.0/storage-pools/')) {reply({}); return}
            if (url.pathname.startsWith('/1.0/networks/')) {reply({managed: true, type: 'bridge'}); return}
            if (url.pathname.startsWith('/1.0/images/')) {reply({fingerprint: image, type: 'container'}); return}
            if (url.pathname.startsWith('/1.0/operations/')) {reply({status_code: operations.get(url.pathname.split('/')[3])!()}); return}
            const chunks = []
            for await (const chunk of request) chunks.push(chunk)
            const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
            if (request.method == 'POST' && url.pathname == '/1.0/instances') {
                if (instances.has(body.name)) {reply({}, 409); return}
                creates++
                assert.deepEqual(body.profiles, [])
                assert.equal(body.source.fingerprint, image)
                const instance: Instance = {...body, status_code: 102, config: {...body.config, 'volatile.base_image': image}}
                instances.set(body.name, instance)
                if (loseCreate) {loseCreate = false; request.socket.destroy(); return}
                operation(()=>200)
                return
            }
            const instance = instances.get(url.pathname.split('/')[3])
            if (!instance) {reply({}, 404); return}
            if (request.method == 'PUT') {
                changes++
                assert.equal(body.force, false, 'shutdown must not force power off')
                operation(function complete() {
                    if (failChange) return 400
                    instance!.status_code = body.action == 'start' ? 103 : 102
                    return 200
                })
                return
            }
            reply(instance)
        } catch (error) {response.destroy(error as Error)}
    })
    await new Promise<void>(resolve=>fixture.listen(socketPath, resolve))
    const config = {socketPath, owner: 'agent', project: 'hosting-test', pool: 'pool', network: 'bridge', timeoutMs: 3000}
    const resource = createLxdResource(config)
    const machine = {id: 'recovery', project: 'demo', spec}
    const password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [
        {account: 'admin', role: 'admin', projects: [], password},
        {account: 'agent', role: 'agent', projects: ['demo'], password},
        {account: 'peer', role: 'agent', projects: ['demo'], password},
        {account: 'outsider', role: 'owner', projects: ['other'], password},
        {account: 'observer', role: 'observer', projects: ['demo'], password},
    ]})
    const env = {SERVICE_PORT: '0', SERVICE_DATA_DIR: path.join(directory, 'control'), SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    // A v1 archive really lacks the new collections; exercise the library migration on restart.
    const {machines: _machines, machineOperations: _operations, ...legacy} = definition.initial
    let host = await createServiceLeaderHost({definition: {...definition, version: 1, initial: legacy as HostingState,
        views: {dashboard: definition.views.dashboard, assignments: definition.views.assignments},
    }, env})
    let protocolVersion = 1
    function connect(account: string) {return createServiceClient({definition: describeService({...definition, version: protocolVersion}), url: host.url, auth: {credentials: {account, password}}})}
    let admin = connect('admin')
    const clients: ReturnType<typeof connect>[] = []
    let agent: Awaited<ReturnType<typeof startLxdAgent>> | undefined
    try {
        await assert.rejects(resource.control.ensure({...machine, id: 'missing'}, 'stopped'), /explicit recovery/)
        await assert.rejects(resource.control.ensure({...machine, id: 'missing', providerName: 'previous-instance'}, 'running'), /explicit recovery/)
        assert.equal(creates, 0, 'stop or recovery of a missing machine must not create a replacement')
        loseCreate = true
        await assert.rejects(resource.control.ensure(machine, 'running'))
        const result = await resource.control.ensure(machine, 'running')
        assert.equal(creates, 1, 'lost create reply reuses the same machine')
        assert.equal(result.preparation, 'unverified')
        const before = changes
        await resource.control.ensure(machine, 'running')
        assert.equal(changes, before, 'desired state produces no repeated start')
        failChange = true
        await assert.rejects(resource.control.ensure(machine, 'stopped'), /operation failed/, 'HTTP 200 with failed operation is not success')
        failChange = false
        await resource.control.ensure(machine, 'stopped')
        instances.get(result.providerName)!.config['user.wenay.owner'] = 'foreign'
        const beforeConflict = changes
        await assert.rejects(resource.control.ensure(machine, 'running'), /identity or configuration/)
        assert.equal(changes, beforeConflict, 'foreign resources cannot be started or stopped')
        supportsVm = false
        await assert.rejects(resource.control.ensure({...machine, id: 'vm', spec: {...spec, kind: 'virtual-machine'}}, 'running'), /does not support/)
        supportsVm = true
        await admin.ready()
        await admin.commands.createProject('project', {id: 'demo', title: 'Retained through migration'})
        admin.close()
        await host.close()
        host = await createServiceLeaderHost({definition, env, mount({app}) {app.get('/api/client', (_request, response)=>response.json(describeService(definition)))}})
        protocolVersion = 2
        admin = connect('admin')
        await admin.ready()
        await admin.views.dashboard.ready
        assert.equal(admin.views.dashboard.store.state.projects[0].title, 'Retained through migration')
        const created = await admin.commands.createMachine('create', {id: 'worker', project: 'demo', agent: 'agent', ...spec})
        const repeated = await admin.commands.createMachine('create', {id: 'worker', project: 'demo', agent: 'agent', ...spec})
        assert.equal(repeated.id, created.id)
        const outsider = connect('outsider')
        const observer = connect('observer')
        const peer = connect('peer')
        clients.push(outsider, observer, peer)
        await Promise.all(clients.map(client=>client.ready()))
        await outsider.views.machineDashboard.ready
        assert.deepEqual(outsider.views.machineDashboard.store.state.machines, [])
        await assert.rejects(outsider.commands.setMachinePower('foreign-stop', {machine: 'worker', revision: 1, target: 'stopped'}))
        await assert.rejects(peer.commands.claimMachineOperation('foreign-claim', {operation: created.id, revision: 0}))
        const denied = await fetch(host.url+'/api/hosting/commands/setMachinePower', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer '+observer.identity.token()}, body: JSON.stringify({args: ['observer-stop', {machine: 'worker', revision: 1, target: 'stopped'}]})})
        assert.equal((await denied.json()).ok, false)
        await assert.rejects(admin.commands.setMachinePower('busy', {machine: 'worker', revision: 1, target: 'stopped'}))
        const agentDeps = {...config, url: host.url, account: 'agent', password, directory: path.join(directory, 'agent')}
        agent = await startLxdAgent(agentDeps)
        await assert.rejects(startLxdAgent(agentDeps), /EEXIST/)
        await admin.views.machineDashboard.ready
        await waitFor(()=>admin.views.machineDashboard.store.state.machines[0]?.power == 'running')
        assert.equal(admin.views.machineDashboard.store.state.machines[0].preparation, 'unverified')
        await Promise.all([agent.close(), agent.close()])
        const snapshot = admin.views.machineDashboard.store.state.machines[0]
        await assert.rejects(admin.commands.setMachinePower('stale', {machine: 'worker', revision: snapshot.revision-1, target: 'stopped'}))
        await admin.commands.setMachinePower('stop', {machine: 'worker', revision: snapshot.revision, target: 'stopped'})
        agent = await startLxdAgent(agentDeps)
        await waitFor(()=>admin.views.machineDashboard.store.state.machines[0]?.power == 'stopped')
        assert.equal(instances.get(machineIdentity({id: 'worker', project: 'demo', spec, owner: 'agent'}).name)?.status_code, 102)
        await agent.close()
        admin.close()
        for (const client of clients) client.close()
        await host.close()
        host = await createServiceLeaderHost({definition, env})
        admin = connect('admin')
        await admin.ready()
        await admin.views.machineDashboard.ready
        assert.equal(admin.views.machineDashboard.store.state.machines[0].power, 'stopped', 'machine state survives control restart')
        assert.equal((await admin.commands.createMachine('create', {id: 'worker', project: 'demo', agent: 'agent', ...spec})).id, created.id, 'machine receipt survives control restart')
        console.log('PASS LXD HTTP fixture: lost reply, async failure, ownership, capability; real common2 RPC: v1 archive migration, roles, project isolation, receipts, power lifecycle and agent restart. No real VM was started.')
    } finally {
        await agent?.close()
        admin.close()
        for (const client of clients) client.close()
        await host.close()
        fixture.closeAllConnections()
        await new Promise<void>(resolve=>fixture.close(()=>resolve()))
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {console.error(error); process.exitCode = 1})
