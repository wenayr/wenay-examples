import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createCrmService} from './service'
import {createCrmAssistant, type SummaryProvider, type SummaryFact} from './assistant-resource'

async function waitFor(check: () => boolean) {
    const deadline = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < deadline, 'Condition timeout')
        await delay(10)
    }
}

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'crm-assistant-check-'))
    const leader = createServiceLeader({definition: createCrmService().definition, selfUrl: () => 'http://localhost'})
    const pending: {
        facts: SummaryFact[],
        signal: AbortSignal,
        finish: (value: {text: string, nextAction: string}) => void,
        reject: (error: Error) => void
    }[] = []
    const provider: SummaryProvider = {summarize(input) {return new Promise((finish, reject) => pending.push({...input, finish, reject}))}}
    const owner = leader.corridor.fragment('owner')
    const snapshot = () => leader.line.control.store.snapshot()
    const revision = () => snapshot().deals['deal-aurora'].revision
    const context = (account: string) => ({
        principal: {account, roles: ['owner']},
        sessionId: account,
        resourceId: 'assistant',
        signal: new AbortController().signal
    })
    function start(customProvider: SummaryProvider | undefined = provider) {
        const assistant = createCrmAssistant({directory, provider: customProvider, timeoutMs: 300})
        const close = assistant.mount(leader.line.control.store)
        return {assistant, close}
    }
    let running = start()
    const stops: (() => void)[] = []
    async function open(account: string) {
        const connection = running.assistant.resource.open(context(account))
        const view = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}})
        const mirror = syncStoreReplay(view, connection.facade.ai.state)
        await mirror.ready
        stops.push(mirror, connection.close)
        return {...connection.facade, view}
    }
    function request(requestId: string, id = 'deal-aurora', orgId = 'northstar') {
        return {kind: 'summary', requestId, resourceIds: [id], input: {orgId, id, revision: snapshot().deals[id]?.revision ?? 1}}
    }
    try {
        let meteredProviderCalls = 0
        const gated = createCrmAssistant({
            timeoutMs: 30,
            usage: {
                async run() {
                    await delay(90)
                    throw new Error('No quota acknowledgement')
                }
            },
            provider: {
                async summarize() {
                    meteredProviderCalls++
                    return {text: 'Never', nextAction: 'Never'}
                }
            }
        })
        const closeGated = gated.mount(leader.line.control.store)
        const gatedConnection = gated.resource.open(context('owner'))
        const gatedView = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}})
        const gatedReplay = syncStoreReplay(gatedView, gatedConnection.facade.ai.state)
        try {
            await gatedReplay.ready
            const attempt = gatedConnection.facade.ai.createRun(request('quota-before-provider'))
            await waitFor(() => gatedView.state.runs[attempt.id]?.state == 'failed')
            assert.equal(meteredProviderCalls, 0, 'timeout while reserving quota must not start provider or reject an unattached abort promise')
        } finally {gatedReplay()
        gatedConnection.close()
        closeGated()}
        const manager = await open('manager'), customer = await open('customer'), outsider = await open('outsider')
        assert.throws(() => customer.ai.createRun(request('customer')), /forbidden/)
        assert.throws(() => outsider.ai.createRun(request('other-tenant')), /forbidden/)
        assert.throws(() => manager.ai.createRun({...request('wrong-resource'), resourceIds: ['deal-harbor']}), /forbidden/)
        const first = manager.ai.createRun(request('first'))
        await waitFor(() => pending.length == 1)
        assert(pending[0].facts.some(fact => fact.kind == 'interaction' && fact.label == 'Внутренняя заметка'))
        assert(!pending[0].facts.some(fact => fact.id.includes('harbor') || fact.id.includes('expansion')))
        assert.throws(() => manager.ai.createRun(request('same-deal-active')), /forbidden/)
        pending[0].finish({text: 'PRIVATE_SUMMARY_RESULT', nextAction: 'Уточнить требования.'})
        await waitFor(() => manager.view.state.runs[first.id]?.state == 'completed')
        assert.equal(manager.control.result(first.id).text, 'PRIVATE_SUMMARY_RESULT')
        assert.equal(manager.control.result(first.id).demo, false)
        assert.equal(JSON.stringify(await manager.ai.state.keyframe()).includes('PRIVATE_SUMMARY_RESULT'), false)
        assert.throws(() => outsider.control.result(first.id), /недоступен/)
        await owner.companySave('change-source', {orgId: 'northstar', id: 'company-aurora', revision: 1, name: 'Aurora Updated', domain: 'aurora.example'})
        assert.throws(() => manager.control.result(first.id), /Источник/)
        const cancelled = manager.ai.createRun(request('cancel'))
        await waitFor(() => pending.length == 2)
        manager.ai.cancelRun(cancelled.id, 'Cancel test')
        assert(pending[1].signal.aborted)
        pending[1].finish({text: 'PRIVATE_LATE_CANCELLED', nextAction: 'Never'})
        await waitFor(() => manager.view.state.runs[cancelled.id]?.state == 'cancelled')
        assert.throws(() => manager.control.result(cancelled.id), /недоступен/)
        const changed = manager.ai.createRun(request('changed'))
        await waitFor(() => pending.length == 3)
        await owner.interactionAdd('change-during-summary', {orgId: 'northstar', id: 'deal-aurora', revision: revision(), body: 'Новые условия', private: true})
        pending[2].finish({text: 'PRIVATE_LATE_CHANGED', nextAction: 'Never'})
        await waitFor(() => manager.view.state.runs[changed.id]?.state == 'failed')
        assert.throws(() => manager.control.result(changed.id), /недоступен/)
        const failed = manager.ai.createRun(request('provider-error'))
        await waitFor(() => pending.length == 4)
        pending[3].reject(new Error('PRIVATE_PROVIDER_ERROR_WITH_PROMPT'))
        await waitFor(() => manager.view.state.runs[failed.id]?.state == 'failed')
        assert.equal(JSON.stringify(await manager.ai.state.keyframe()).includes('PRIVATE_PROVIDER_ERROR'), false)
        const timedOut = manager.ai.createRun(request('timeout'))
        await waitFor(() => pending.length == 5)
        await waitFor(() => manager.view.state.runs[timedOut.id]?.state == 'failed')
        assert(pending[4].signal.aborted)
        pending[4].finish({text: 'PRIVATE_LATE_TIMEOUT', nextAction: 'Never'})
        const good = manager.ai.createRun(request('durable'))
        await waitFor(() => pending.length == 6)
        pending[5].finish({text: 'DURABLE_PRIVATE_RESULT', nextAction: 'Следующий шаг для проверки.'})
        await waitFor(() => manager.view.state.runs[good.id]?.state == 'completed')
        for (const stop of stops.splice(0)) stop()
        running.close()
        await delay(20)
        running = start()
        const restored = await open('manager')
        assert.equal(restored.control.result(good.id).text, 'DURABLE_PRIVATE_RESULT')
        assert.equal(JSON.stringify(await restored.ai.state.keyframe()).includes('DURABLE_PRIVATE_RESULT'), false)
        const revoked = restored.ai.createRun(request('revoke-running'))
        await waitFor(() => pending.length == 7)
        await owner.memberRole('revoke-manager', {orgId: 'northstar', revision: snapshot().organizations.northstar.revision, account: 'manager', role: 'none'})
        pending[6].finish({text: 'PRIVATE_REVOKED', nextAction: 'Never'})
        await waitFor(() => restored.view.state.runs[revoked.id]?.state == 'failed')
        assert.throws(() => restored.control.result(good.id), /доступа/)
        assert.throws(() => restored.ai.createRun(request('retained-start-after-revoke')), /forbidden/)
        assert.equal(JSON.stringify(await restored.ai.state.keyframe()).includes('PRIVATE_REVOKED'), false)
        console.log('PASS CRM assistant: source-scoped facts, private completed-result port, source version change, tenant/customer ACL, one-active-per-deal, cancellation/timeout/late result, sanitized provider errors, durable private output and retained-resource revocation')
    } finally {
        for (const stop of stops.splice(0)) stop()
        running.close()
        await delay(20)
        leader.control.close()
        const parent = path.dirname(path.resolve(directory))
        const named = path.basename(directory).startsWith('crm-assistant-check-')
        if (parent != temporary || !named) throw new Error('Unsafe cleanup path')
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
