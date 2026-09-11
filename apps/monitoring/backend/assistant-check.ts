import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createMonitoringRuntime} from './runtime'
async function waitFor(check: () => boolean) {
    const end = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < end)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}
async function main() {
    const pending: {signal: AbortSignal, resolve: (value: {text: string, steps: string[]}) => void}[] = []
    const provider = {
        summarize(input: {signal: AbortSignal}) {
            return new Promise<{text: string, steps: string[]}>(function hold(resolve) {
                pending.push({signal: input.signal, resolve})
            })
        }
    }
    const runtime = createMonitoringRuntime({
        presets: [{id: 'fixture', name: 'Local'}],
        timeoutMs: 100,
        provider
    })
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount(leader.line.control.store), owner = leader.corridor.fragment('owner'), probe = leader.corridor.fragment('probe-a')
    const state = () => leader.line.control.store.snapshot()
    const orgId = 'northstar'
    const opened = runtime.definition.resources.assistant.open({
        principal: {account: 'oncall', roles: ['oncall']},
        sessionId: 'oncall',
        resourceId: 'assistant',
        signal: new AbortController().signal
    })
    const view = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}}), replay = syncStoreReplay(view, opened.facade.ai.state)
    try {
        await replay.ready
        const {id} = await owner.monitorSave('create', {
            orgId, id: '', revision: 0, name: 'Local', presetId: 'fixture', preferred: 'probe-a',
            public: true, paused: false, intervalMs: 15000, timeoutMs: 200,
            downThreshold: 1, upThreshold: 1
        })
        const request = (requestId: string) => ({requestId, kind: 'summary', resourceIds: [id], input: {orgId, id, revision: state().monitors[id].revision}})
        const first = opened.facade.ai.createRun(request('first'))
        await waitFor(() => pending.length == 1)
        pending[0].resolve({text: 'PRIVATE_FACTS', steps: ['Проверьте журнал приложения.']})
        await waitFor(() => view.state.runs[first.id]?.state == 'completed')
        assert.equal(opened.facade.control.result(first.id).text, 'PRIVATE_FACTS')
        assert(!JSON.stringify(await opened.facade.ai.state.keyframe()).includes('PRIVATE_FACTS'))
        const claim = await probe.probeClaim('claim', {orgId, id, revision: 1})
        await probe.probeReport('report', {orgId, id, revision: 1, attempt: claim.claim!.attempt, outcome: 'down', latencyMs: 1, code: 500, detail: 'HTTP 500'})
        assert.throws(() => opened.facade.control.result(first.id), /новые факты/)
        const cancelled = opened.facade.ai.createRun(request('cancel'))
        await waitFor(() => pending.length == 2)
        opened.facade.ai.cancelRun(cancelled.id)
        pending[1].resolve({text: 'LATE', steps: []})
        await waitFor(() => view.state.runs[cancelled.id]?.state == 'cancelled')
        assert(pending[1].signal.aborted)
        assert.throws(() => opened.facade.control.result(cancelled.id), /недоступен/)
        const timeout = opened.facade.ai.createRun(request('timeout'))
        await waitFor(() => view.state.runs[timeout.id]?.state == 'failed')
        const revoked = opened.facade.ai.createRun(request('revoke'))
        await waitFor(() => pending.length == 4)
        await owner.memberRole('revoke-user', {orgId, revision: 1, account: 'oncall', role: 'none'})
        pending[3].resolve({text: 'REVOKED', steps: []})
        await waitFor(() => view.state.runs[revoked.id]?.state == 'failed')
        assert.throws(() => opened.facade.control.result(first.id), /доступа/)
        console.log('PASS monitoring assistant: source freshness after measurement, private results only, cancellation/timeout/late response, role revocation and no automatic hosting action')
    } finally {replay()
    opened.close()
    close()
    leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
