import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createFormsService} from './service'
import {createFormsGrouping, type GroupingProvider, type GroupingSource, type Group} from './grouping-resource'
import {hash} from './domain'

async function waitFor(check: () => boolean) {
    const end = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < end, 'Condition timeout')
        await delay(5)
    }
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'forms-grouping-check-'))
    let clock = Date.now()
    const leader = createServiceLeader({definition: createFormsService({now: () => clock}).definition, selfUrl: () => 'http://localhost'})
    const state = () => leader.line.control.store.snapshot()
    const owner = leader.corridor.fragment('owner'), id = 'form-feedback', orgId = 'northstar'
    const pending: {sources: GroupingSource[], signal: AbortSignal, finish: (value: Group[]) => void, reject: (error: Error) => void}[] = []
    const provider: GroupingProvider = {group(input) {return new Promise((finish, reject) => pending.push({...input, finish, reject}))}}
    function start(customProvider: GroupingProvider | undefined = provider) {
        const grouping = createFormsGrouping({directory, provider: customProvider, timeoutMs: 150, now: () => clock})
        return {grouping, close: grouping.mount(leader.line.control.store)}
    }
    let running = start()
    const stops: (() => void)[] = []
    async function open(account: string) {
        const connection = running.grouping.resource.open({
            principal: {account, roles: ['owner']},
            sessionId: account,
            resourceId: 'grouping',
            signal: new AbortController().signal
        })
        const view = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}})
        const mirror = syncStoreReplay(view, connection.facade.ai.state)
        await mirror.ready
        stops.push(mirror, connection.close)
        return {...connection.facade, view}
    }
    function request(requestId: string) {
        const input = {
            orgId,
            formId: id,
            version: 1,
            fieldId: 'details',
            answersRevision: state().forms[id].answersRevision
        }
        return {kind: 'group', requestId, resourceIds: [id], input}
    }
    function finish(index: number, label = 'PRIVATE_GROUP_LABEL') {pending[index].finish([{label, sourceIds: pending[index].sources.map(source => source.id)}])}
    try {
        await leader.corridor.system.formPublish('publish', {
            orgId, id, revision: 1, actor: 'owner',
            tokenHash: hash('x'.repeat(43)), publication: 'a'.repeat(64)
        })
        const publicClient = leader.corridor.fragment('form:form-feedback:1')
        const admin = await open('owner'), outsider = await open('outsider')
        assert.throws(() => admin.ai.createRun(request('too-small')), /forbidden/)
        const ids: string[] = []
        for (const [index, details] of ['PRIVATE_SOURCE_TEXT дорогой тариф', 'Нужен быстрый поиск', 'Неудобный редактор'].entries()) {
            const receipt = await publicClient.answerSubmit('answer-' + index, {
                formId: id,
                version: 1,
                nonce: 'answer-nonce-' + index,
                answersJson: JSON.stringify({rating: 3, recommend: false, details})
            })
            ids.push(receipt.id)
        }
        assert.throws(() => outsider.ai.createRun(request('cross-tenant')), /forbidden/)
        assert.throws(() => admin.ai.createRun({...request('wrong-field'), input: {...request('x').input, fieldId: 'rating'}}), /forbidden/)
        const first = admin.ai.createRun(request('first'))
        await waitFor(() => pending.length == 1)
        assert(pending[0].sources.some(source => source.text.includes('PRIVATE_SOURCE_TEXT')))
        assert.throws(() => admin.ai.createRun(request('active-same-form')), /forbidden/)
        finish(0)
        await waitFor(() => admin.view.state.runs[first.id]?.state == 'completed')
        const result = admin.control.result(first.id)
        assert.equal(result.sampleSize, 3)
        assert.equal(result.demo, false)
        assert.equal(JSON.stringify(await admin.ai.state.keyframe()).includes('PRIVATE_'), false)
        assert.throws(() => outsider.control.result(first.id), /недоступен/)
        assert.throws(() => admin.control.correct({runId: first.id, revision: 1, groups: [{label: 'Bad', sourceIds: ['foreign'] }]}), /источник/)
        const corrected = admin.control.correct({runId: first.id, revision: 1, groups: [{label: 'PRIVATE_MANUAL_LABEL', sourceIds: ids}]})
        assert.equal(corrected.revision, 2)
        assert.throws(() => admin.control.correct({runId: first.id, revision: 1, groups: corrected.groups}), /уже исправлены/)
        for (const stop of stops.splice(0)) stop()
        running.close()
        await delay(10)
        running = start()
        const restored = await open('owner'), readOnly = await open('analyst')
        assert.equal(restored.control.result(first.id).groups[0].label, 'PRIVATE_MANUAL_LABEL')
        const analystRun = readOnly.ai.createRun(request('analyst'))
        await waitFor(() => pending.length == 2)
        finish(1)
        await waitFor(() => readOnly.view.state.runs[analystRun.id]?.state == 'completed')
        assert.throws(() => readOnly.control.correct({runId: analystRun.id, revision: 1, groups: [{label: 'No', sourceIds: ids}]}), /доступа/)
        const cancelled = restored.ai.createRun(request('cancelled'))
        await waitFor(() => pending.length == 3)
        restored.ai.cancelRun(cancelled.id, 'Cancel')
        assert(pending[2].signal.aborted)
        finish(2, 'PRIVATE_LATE_CANCELLED')
        await waitFor(() => restored.view.state.runs[cancelled.id]?.state == 'cancelled')
        assert.throws(() => restored.control.result(cancelled.id), /недоступен/)
        const invalid = restored.ai.createRun(request('invalid-groups'))
        await waitFor(() => pending.length == 4)
        pending[3].finish([{label: 'Dropped sources', sourceIds: [ids[0]]}])
        await waitFor(() => restored.view.state.runs[invalid.id]?.state == 'failed')
        const timedOut = restored.ai.createRun(request('timeout'))
        await waitFor(() => pending.length == 5)
        await waitFor(() => restored.view.state.runs[timedOut.id]?.state == 'failed')
        assert(pending[4].signal.aborted)
        finish(4, 'PRIVATE_TIMEOUT')
        const revoked = readOnly.ai.createRun(request('revoke'))
        await waitFor(() => pending.length == 6)
        await owner.memberRole('revoke', {orgId, revision: state().organizations[orgId].revision, account: 'analyst', role: 'none'})
        await waitFor(() => pending[5].signal.aborted)
        finish(5)
        await waitFor(() => readOnly.view.state.runs[revoked.id]?.state == 'failed')
        assert.throws(() => readOnly.control.result(analystRun.id), /недоступен/)
        const changed = restored.ai.createRun(request('changed'))
        await waitFor(() => pending.length == 7)
        const fixedAnswers = {rating: 4, recommend: false, details: 'Исправленный дорогой тариф'}
        await owner.answerCorrect('source-correct', {
            orgId,
            formId: id,
            id: ids[0],
            answersRevision: state().forms[id].answersRevision,
            answersJson: JSON.stringify(fixedAnswers)
        })
        await waitFor(() => pending[6].signal.aborted)
        finish(6, 'PRIVATE_CHANGED')
        await waitFor(() => restored.view.state.runs[changed.id]?.state == 'failed')
        assert.throws(() => restored.control.result(first.id), /недоступен/)
        assert.equal(readFileSync(path.join(directory, 'groups.replay'), 'utf8').includes('PRIVATE_MANUAL_LABEL'), false)
        for (const stop of stops.splice(0)) stop()
        running.close()
        await delay(10)
        // Omit the test provider for the actual deterministic demo implementation.
        const grouping = createFormsGrouping({directory, now: () => clock})
        running = {grouping, close: grouping.mount(leader.line.control.store)}
        const demo = await open('owner')
        const demoRun = demo.ai.createRun(request('demo'))
        await waitFor(() => demo.view.state.runs[demoRun.id]?.state == 'completed')
        assert.equal(demo.control.result(demoRun.id).demo, true)
        assert.deepEqual(new Set(demo.control.result(demoRun.id).groups.map(group => group.label)), new Set(['Цена', 'Скорость', 'Удобство']))
        clock += 31 * 86400000
        assert.throws(() => demo.control.result(demoRun.id), /Срок хранения/)
        clock -= 31 * 86400000
        await owner.answerDelete('delete-source', {orgId, formId: id, id: ids[0]})
        await delay(5)
        assert.throws(() => demo.control.result(demoRun.id), /недоступен/)
        assert.throws(() => demo.ai.createRun(request('too-small-after-delete')), /forbidden/)
        clock += 31 * 86400000
        await leader.corridor.system.retentionSweep('sweep', {})
        console.log('PASS Forms grouping: min sample, current field/version sources, tenant ACL, source partition, manual correction/revision, analyst read-only, private durable output, cancel/timeout/late result, revoke, correction/delete invalidation and compacted cleanup, deterministic demo groups')
    } finally {
        for (const stop of stops.splice(0)) stop()
        running.close()
        await delay(10)
        leader.control.close()
        const parent = path.dirname(path.resolve(directory))
        const named = path.basename(directory).startsWith('forms-grouping-check-')
        if (parent != temporary || !named) throw new Error('Unsafe cleanup path')
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
