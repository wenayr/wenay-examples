import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createMonitoringRuntime} from './runtime'
import {createEmbeddedProbeWorker} from './probe-worker'

async function waitFor(check: () => boolean) {
    const until = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < until, 'Embedded probe timeout')
        await delay(5)
    }
}
async function main() {
    let requests = 0, release = () => {}
    const http = createServer(function request(_request, response) {
        requests++
        release = () => response.writeHead(200).end('local')
    })
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
    const targets = [{id: 'local', name: 'Local', url: 'http://127.0.0.1:' + (http.address() as {port: number}).port + '/health', address: '127.0.0.1'}]
    const runtime = createMonitoringRuntime({presets: targets, minIntervalMs: 1000})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://external-gateway.invalid'})
    const owner = leader.corridor.fragment('owner')
    let worker: ReturnType<typeof createEmbeddedProbeWorker> | undefined
    try {
        assert.throws(() => createEmbeddedProbeWorker({leader, targets, account: 'probe-a', password: 'wrong'}), /login refused/)
        assert.throws(() => createEmbeddedProbeWorker({leader, targets, account: 'owner', password: 'owner-pass'}), /forbidden/)
        worker = createEmbeddedProbeWorker({leader, targets, account: 'probe-a', password: 'probe-a-pass'})
        const created = await owner.monitorSave('monitor', {
            orgId: 'northstar', id: '', revision: 0, name: 'Embedded', presetId: 'local',
            preferred: 'probe-a', public: false, paused: false, intervalMs: 1000, timeoutMs: 500,
            downThreshold: 1, upThreshold: 1
        })
        await waitFor(() => requests == 1)
        release()
        const monitor = () => leader.line.control.store.state.monitors[created.id]
        await waitFor(() => monitor().history.length == 1)
        assert.equal(monitor().history[0].code, 200)
        assert.equal(monitor().lastWorker, 'probe-a')
        await waitFor(() => requests == 2)
        // Technical credentials are operator-managed; simulate that operator revoking membership.
        delete leader.line.control.store.state.organizations.northstar.members['probe-a']
        release()
        await delay(30)
        assert.equal(monitor().history.length, 1, 'revoked embedded worker cannot commit its late HTTP result')
        const claim = {orgId: 'northstar', id: created.id, revision: monitor().revision}
        const revoked = leader.corridor.fragment('probe-a').probeClaim('revoked', claim)
        await assert.rejects(revoked, /forbidden/)
        console.log('PASS embedded probe: public credential login, technical assignment role, actual local HTTP with unreachable advertised gateway, shared loop, fresh membership prevents late report')
    } finally {
        await worker?.close()
        leader.control.close()
        http.closeAllConnections()
        await new Promise<void>(resolve => http.close(() => resolve()))
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
