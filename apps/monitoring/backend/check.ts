import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createMonitoringRuntime, type MonitoringDefinition} from './runtime'
import {createProcess} from './process-resource'
async function waitFor(label: string, check: () => boolean) {
    const end = Date.now() + 25000
    while (!check()) {assert(Date.now() < end, 'Timeout: ' + label); await new Promise(resolve => setTimeout(resolve, 30))}
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'monitor-network-'))
    let failing = false
    const fixture = createServer(function health(_request, response) {response.writeHead(failing ? 503 : 200).end('local fixture')})
    await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
    const targetUrl = 'http://127.0.0.1:' + (fixture.address() as {port: number}).port + '/health'
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory, SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex'),
        MONITOR_TARGETS_JSON: JSON.stringify([{id: 'fixture', name: 'Local test', url: targetUrl, address: '127.0.0.1'}]), MONITOR_EMBEDDED_PROBE: '0', MONITOR_MIN_INTERVAL_MS: '1000'}
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    const nodes: ReturnType<typeof createProcess>[] = [], probes: ReturnType<typeof createProcess>[] = [], clients: ServiceClient<MonitoringDefinition>[] = []
    async function client(account?: string) {
        const session = createServiceClient<MonitoringDefinition>({definition: describeService(createMonitoringRuntime().definition), url, ...(account ? {auth: {credentials: {account, password: account + '-pass'}}} : {}), placement: {rng: () => 0}})
        clients.push(session); await session.ready()
        if (account) await session.views.workspace.ready
        else await session.views.status.ready
        return session
    }
    try {
        for (const id of ['monitor-a', 'monitor-b']) {const node = createProcess({script: 'node.ts', env: {...env, SERVICE_UPSTREAM: url, SERVICE_NODE_ID: id}}); nodes.push(node); await node.ready}
        const owner = await client('owner'), observer = await client(), outsider = await client('outsider')
        const input = {orgId: 'northstar', id: '', revision: 0, name: 'Local A', presetId: 'fixture', preferred: 'probe-a', public: true, paused: false, intervalMs: 1000, timeoutMs: 200, downThreshold: 1, upThreshold: 1}
        const a = await owner.commands.monitorSave('a', input), b = await owner.commands.monitorSave('b', {...input, name: 'Local B', preferred: 'probe-b'})
        for (const account of ['probe-a', 'probe-b']) {const probe = createProcess({script: 'probe-main.ts', env: {...env, SERVICE_UPSTREAM: url, PROBE_ACCOUNT: account, PROBE_PASSWORD: account + '-pass'}}); probes.push(probe); await probe.ready}
        const target = (id: string) => owner.views.workspace.store.state.monitors?.find(item => item.id == id)
        await waitFor('both workers perform real checks', () => target(a.id)?.lastWorker == 'probe-a' && target(b.id)?.lastWorker == 'probe-b')
        assert.equal(target(a.id)!.status, 'up')
        assert.equal(outsider.views.workspace.store.state.monitors.length, 0)
        await waitFor('public state available', () => observer.views.status.store.state.services.length == 2)
        assert(!JSON.stringify(observer.views.status.store.state).includes(targetUrl))
        failing = true
        await waitFor('two live incidents', () => owner.views.workspace.store.state.incidents.filter(item => item.status == 'open').length == 2)
        await owner.views.taskBoards.ready
        await waitFor('one task for each incident', () => owner.views.taskBoards.store.state.boards.flatMap(board => board.tasks).length == 2)
        await probes[0].control.stop(true)
        await waitFor('worker B takes over A', () => target(a.id)?.lastWorker == 'probe-b')
        assert.equal(owner.views.workspace.store.state.incidents.length, 2)
        failing = false
        await waitFor('recovery without extra incident', () => target(a.id)?.status == 'up' && target(b.id)?.status == 'up')
        assert(owner.views.workspace.store.state.incidents.every(item => item.status == 'resolved'))
        const endpoint = owner.view.endpoint()!, stable = owner.views.workspace.store
        assert(endpoint.nodeId != 'leader')
        await nodes[endpoint.nodeId == 'monitor-a' ? 0 : 1].control.stop(true)
        await waitFor('view node failover', () => !!owner.view.endpoint() && owner.view.endpoint()!.nodeId != endpoint.nodeId)
        assert.equal(owner.views.workspace.store, stable)
        const count = target(a.id)!.attempt
        for (const probe of probes) await probe.control.stop()
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env}); url = await host.ready
        const restored = await client('owner')
        assert.equal(restored.views.workspace.store.state.incidents.length, 2)
        const nextProbe = createProcess({script: 'probe-main.ts', env: {...env, SERVICE_UPSTREAM: url, PROBE_ACCOUNT: 'probe-b', PROBE_PASSWORD: 'probe-b-pass'}}); probes.push(nextProbe); await nextProbe.ready
        await waitFor('schedule continues after restart', () => (restored.views.workspace.store.state.monitors.find(item => item.id == a.id)?.attempt ?? 0) > count)
        assert.equal(restored.views.workspace.store.state.incidents.length, 2)
        console.log('PASS monitoring network: authority +2 serving nodes +2 probe processes, real bounded HTTP, partitioned work and takeover, incident/task dedup and recovery, anonymous status isolation, node loss and durable schedule restart')
    } finally {
        for (const probe of probes) await probe.control.stop()
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()))
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('monitor-network-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
