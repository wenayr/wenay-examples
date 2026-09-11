import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createMonitoringRuntime} from './runtime'
import {monitoringWorkspace, publicStatus} from './domain'

async function main() {
    let clock = Date.now()
    const runtime = createMonitoringRuntime({now: () => clock, minIntervalMs: 1000, takeoverMs: 500, presets: [{id: 'support', name: 'Support'}]})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const owner = leader.corridor.fragment('owner')
    const oncall = leader.corridor.fragment('oncall')
    const probe = leader.corridor.fragment('probe-a')
    const backup = leader.corridor.fragment('probe-b')
    const observer = leader.corridor.fragment('observer')
    const state = () => leader.line.control.store.snapshot(), orgId = 'northstar'
    try {
        const input = {
            orgId, id: '', revision: 0, name: 'Support', presetId: 'support', preferred: 'probe-a',
            public: true, paused: false, intervalMs: 1000, timeoutMs: 200,
            downThreshold: 2, upThreshold: 2
        }
        await assert.rejects(observer.monitorSave('unauthorized', input), /forbidden/)
        await assert.rejects(owner.monitorSave('other-org', {...input, orgId: 'harbor'}), /доступа/)
        const {id} = await owner.monitorSave('create', input)
        const target = () => state().monitors[id], ref = () => ({orgId, id, revision: target().revision})
        await assert.rejects(owner.monitorSave('wrong-endpoint', {...input, id, revision: 1, presetId: 'http://private/'}), /разрешённую/)
        const raced = await Promise.all([probe.probeClaim('claim-a', ref()), probe.probeClaim('claim-b', ref())])
        assert.equal(raced.filter(result => result.claim).length, 1)
        const attempt = raced.find(result => result.claim)!.claim!.attempt
        await assert.rejects(owner.probeReport('owner-forges-result', {...ref(), attempt, outcome: 'up', latencyMs: 1, code: 200, detail: ''}), /forbidden/)
        assert.equal((await backup.probeReport('wrong-worker', {...ref(), attempt, outcome: 'up', latencyMs: 1, code: 200, detail: ''})).accepted, false)
        await probe.probeReport('down-1', {...ref(), attempt, outcome: 'down', latencyMs: 3, code: 503, detail: 'HTTP 503'})
        assert.equal(Object.keys(state().incidents).length, 0)
        clock += 1001
        const second = await probe.probeClaim('claim-2', ref())
        const report = {...ref(), attempt: second.claim!.attempt, outcome: 'down' as const, latencyMs: 3, code: 503, detail: 'HTTP 503'}
        await probe.probeReport('down-2', report)
        await probe.probeReport('down-2', report)
        assert.equal(Object.keys(state().incidents).length, 1)
        assert.equal(Object.keys(state().workspaces!.northstar.tasks).length, 1)
        assert.equal(state().notices.length, 2)
        assert.equal(target().status, 'down')
        const incident = state().incidents[target().incidentId]
        await oncall.incidentAcknowledge('ack', {orgId, id: incident.id, revision: 1, body: 'Смотрю на факты.'})
        assert.equal(state().incidents[incident.id].status, 'acknowledged')
        assert.equal(publicStatus(state()).incidents.length, 1)
        assert(!JSON.stringify(publicStatus(state())).includes('Смотрю на факты'))
        assert(!JSON.stringify(monitoringWorkspace(state(), {account: 'observer', roles: ['owner']})).includes('HTTP 503'))
        clock += 1001
        const interrupted = await probe.probeClaim('interrupted', ref())
        clock += 2300
        const takenOver = await backup.probeClaim('takeover', ref())
        assert(takenOver.claim && takenOver.claim.attempt > interrupted.claim!.attempt)
        assert.equal(target().history.at(-1)!.outcome, 'unknown')
        const late = await probe.probeReport('late', {
            ...ref(), attempt: interrupted.claim!.attempt, outcome: 'up',
            latencyMs: 1, code: 200, detail: ''
        })
        assert.equal(late.accepted, false)
        await backup.probeReport('restored-1', {...ref(), attempt: takenOver.claim.attempt, outcome: 'up', latencyMs: 2, code: 200, detail: ''})
        assert.equal(target().status, 'down')
        clock += 1001
        const restored = await probe.probeClaim('restored-2', ref())
        await probe.probeReport('restored-report-2', {...ref(), attempt: restored.claim!.attempt, outcome: 'up', latencyMs: 2, code: 200, detail: ''})
        assert.equal(target().status, 'up')
        assert.equal(state().incidents[incident.id].status, 'resolved')
        assert.equal(state().notices.length, 4)
        assert.equal(Object.keys(state().workspaces!.northstar.tasks).length, 1)
        await owner.monitorSave('private', {...input, ...ref(), public: false})
        assert.equal(publicStatus(state()).services.length, 0)
        assert.equal(publicStatus(state()).incidents.length, 0)
        await owner.memberRole('revoke', {orgId, revision: 1, account: 'oncall', role: 'none'})
        assert.equal(monitoringWorkspace(state(), {account: 'oncall', roles: ['owner']}).monitors.length, 0)
        const beforeConfig = target().revision
        await leader.corridor.system.configurePresets('remove-preset', {presets: [{id: 'documents', name: 'Documents'}]})
        assert.equal(target().paused, true)
        assert.equal(target().status, 'unknown')
        assert.equal(target().claim, null)
        assert.equal(target().revision, beforeConfig + 1)
        await assert.rejects(owner.monitorSave('removed-preset', {...input, ...ref()}), /разрешённую/)
        console.log('PASS monitoring domain: roles, whitelisted preset, atomic claim, threshold/dedup incident/task/notices, acknowledge, observer/public filtering, expired-worker takeover and late-result fence, recovery threshold, visibility removal and revoke')
    } finally {leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
