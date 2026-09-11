import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {MonitoringDefinition} from '../../monitoring/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

function openAssistant(client: ServiceClient<MonitoringDefinition>) {return client.resources.open('assistant')}
async function main() {
    let owner: ServiceClient<MonitoringDefinition> | undefined, oncall: ServiceClient<MonitoringDefinition> | undefined, anonymous: ServiceClient<MonitoringDefinition> | undefined
    let assistant: ReturnType<typeof openAssistant> | undefined, privateAssistant: ReturnType<typeof openAssistant> | undefined
    let id = '', incidentId = '', summaryId = '', privateSummaryId = '', generation = 0, bearer = ''
    const orgId = 'northstar'
    const create = {orgId, id: '', revision: 0, name: 'Hosted local HTTP check', presetId: 'missing', preferred: 'probe-a', public: true, paused: false, intervalMs: 15000, timeoutMs: 1000, downThreshold: 1, upThreshold: 1}
    const workspace = () => owner!.views.workspace.store.state
    const monitor = () => workspace().monitors.find(value => value.id == id)!
    const task = () => owner!.views.taskBoards.store.state.boards.flatMap(board => board.tasks).find(value => value.source?.id == incidentId)!
    async function configure(presetId: string, paused: boolean, requestId: string) {
        const saved = await owner!.commands.monitorSave(requestId, {...create, id, revision: monitor().revision, presetId, paused})
        await waitForHosted('monitor projection has committed settings', () => monitor().revision == saved.revision)
        return saved
    }
    async function summarize(requestId: string, handle: NonNullable<typeof assistant>) {
        const run = await handle.current()!.remote.ai.createRun({kind: 'summary', requestId, resourceIds: [id], input: {orgId, id, revision: monitor().revision}})
        await waitForHosted('summary completed', async () => {try {await handle.current()!.remote.control.result(run.id); return true} catch {return false}})
        return run.id
    }
    await checkHostedApplication({name: 'monitoring', async verify({url, iteration}) {
        assert((await fetch(url).then(response => response.text())).includes('Signal'))
        if (!owner) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            owner = createServiceClient<MonitoringDefinition>({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            oncall = createServiceClient<MonitoringDefinition>({definition, url, auth: {credentials: {account: 'oncall', password: 'oncall-pass'}}})
            anonymous = createServiceClient<MonitoringDefinition>({definition, url})
            await owner.ready(); await oncall.ready(); await anonymous.ready()
            await owner.views.workspace.ready; await owner.views.taskBoards.ready; await anonymous.views.status.ready
            assistant = openAssistant(owner); privateAssistant = openAssistant(oncall)
            await waitForHosted('assistant resources', () => !!assistant?.current() && !!privateAssistant?.current())
            const login = await fetch(url + '/api/monitoring/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account: 'oncall', password: 'oncall-pass'}]}), signal: AbortSignal.timeout(3000)}).then(response => response.json())
            assert(login.ok); bearer = login.value.token
            id = (await owner.commands.monitorSave('hosted-monitor', create)).id
            await waitForHosted('real embedded HTTP 404 opens incident', () => monitor()?.status == 'down' && monitor().history.some(point => point.code == 404 && point.outcome == 'down'))
            assert.equal(monitor().lastWorker, 'probe-a')
            incidentId = monitor().incidentId
            await waitForHosted('one derived task', () => !!task())
            await oncall.commands.incidentAcknowledge('hosted-ack', {orgId, id: incidentId, revision: workspace().incidents.find(value => value.id == incidentId)!.revision, body: 'HOSTED_PRIVATE_INCIDENT_NOTE'})
            await configure('missing', true, 'pause-first')
            summaryId = await summarize('first-summary', assistant)
            assert((await assistant.current()!.remote.control.result(summaryId)).text.includes('HOSTED_PRIVATE_INCIDENT_NOTE'))
        } else {
            await waitForHosted('same session and assistant after deploy', () => !!owner?.health.state.connected && (assistant?.current()?.generation ?? 0) > generation && workspace().monitors.some(value => value.id == id))
            assert.equal((await owner.commands.monitorSave('hosted-monitor', create)).id, id)
            assert.equal(workspace().monitors.length, 1)
            assert.equal(owner.views.taskBoards.store.state.boards.flatMap(board => board.tasks).filter(value => value.source?.id == incidentId).length, 1)
            const saved = await assistant!.current()!.remote.control.result(summaryId)
            assert(saved.demo)
            if (iteration == 1) {
                assert(saved.text.includes('HOSTED_PRIVATE_INCIDENT_NOTE'))
                await configure('self', false, 'recover-on-second')
                await waitForHosted('real embedded HTTP 200 resolves incident', () => monitor().status == 'up' && workspace().incidents.find(value => value.id == incidentId)?.status == 'resolved')
                assert(monitor().history.some(point => point.code == 200 && point.outcome == 'up'))
                assert.equal(task().status, 'todo', 'HTTP recovery does not complete human checklist')
                await configure('self', true, 'pause-second')
                await assert.rejects(assistant!.current()!.remote.control.result(summaryId), /новые факты/)
                const checked = await owner.commands.workCheckTask('checked-first', {orgId, id: task().id, revision: task().revision, index: 0, done: true})
                await waitForHosted('task check projection', () => task().revision == checked.revision)
                await owner.commands.workMoveTask('task-doing', {orgId, id: task().id, revision: task().revision, status: 'doing', beforeId: ''})
                summaryId = await summarize('recovered-summary', assistant!)
                await waitForHosted('oncall resource after deploy', () => !!privateAssistant?.current())
                privateSummaryId = await summarize('oncall-current-summary', privateAssistant!)
                const retained = privateAssistant!.current()!.remote
                await owner.commands.memberRole('revoke-oncall', {orgId, revision: workspace().organizations.find(value => value.id == orgId)!.revision, account: 'oncall', role: 'none'})
                await assert.rejects(retained.control.result(privateSummaryId))
            } else {
                assert.equal(monitor().presetId, 'self')
                assert.equal(monitor().paused, true)
                assert.equal(monitor().status, 'up')
                assert(monitor().history.some(point => point.code == 404))
                assert(monitor().history.some(point => point.code == 200))
                const incident = workspace().incidents.find(value => value.id == incidentId)!
                assert.equal(incident.status, 'resolved')
                assert.equal(incident.notes[0].body, 'HOSTED_PRIVATE_INCIDENT_NOTE')
                assert.equal(task().status, 'doing')
                assert.equal(task().checklist?.[0].done, true)
                assert.equal(task().checklist?.[1].done, false)
                assert.equal(workspace().people.some(value => value.orgId == orgId && value.account == 'oncall'), false)
                const denied = await fetch(url + '/api/monitoring/views/workspace', {headers: {authorization: 'Bearer ' + bearer}, signal: AbortSignal.timeout(3000)}).then(response => response.json())
                assert.equal(denied.ok, false)
                assert.match(denied.error.message, /forbidden|denied|доступ|unauthorized/i)
            }
        }
        await waitForHosted('public status refresh', () => anonymous!.views.status.store.state.services.some(value => value.id == id && value.paused))
        const publicJson = JSON.stringify(anonymous!.views.status.store.state)
        assert(!publicJson.includes('HOSTED_PRIVATE_INCIDENT_NOTE') && !publicJson.includes('probe-a') && !publicJson.includes('127.0.0.1'))
        assert(!JSON.stringify(await assistant!.current()!.remote.ai.state.keyframe()).includes('HOSTED_PRIVATE_INCIDENT_NOTE'))
        generation = assistant?.current()?.generation ?? 0
    }, async close() {await privateAssistant?.close(); await assistant?.close(); anonymous?.close(); oncall?.close(); owner?.close()}})
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
