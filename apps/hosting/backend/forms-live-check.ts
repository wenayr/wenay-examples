import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {FormsDefinition} from '../../forms/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

function openEditor(client: ServiceClient<FormsDefinition>) {return client.resources.open('editor')}
function openPublic(client: ServiceClient<FormsDefinition>) {return client.resources.open('publicform')}
function openAnswers(client: ServiceClient<FormsDefinition>) {return client.resources.open('answers')}
function openGrouping(client: ServiceClient<FormsDefinition>) {return client.resources.open('grouping')}
function openExports(client: ServiceClient<FormsDefinition>) {return client.resources.open('exports')}

async function main() {
    let owner: ServiceClient<FormsDefinition> | undefined, analyst: ServiceClient<FormsDefinition> | undefined, respondent: ServiceClient<FormsDefinition> | undefined
    let editor: ReturnType<typeof openEditor> | undefined, publicform: ReturnType<typeof openPublic> | undefined
    let answers: ReturnType<typeof openAnswers> | undefined, privateAnswers: ReturnType<typeof openAnswers> | undefined
    let grouping: ReturnType<typeof openGrouping> | undefined, exports: ReturnType<typeof openExports> | undefined
    let generation = 0, groupId = '', exportId = '', token = '', analystBearer = '', respondentBearer = ''
    const id = 'form-feedback', orgId = 'northstar'
    const publish = {orgId, id, revision: 1, requestId: 'hosted-publication'}
    const first = {version: 1, nonce: 'hosted-response-0', answers: {rating: 4, recommend: false, details: 'HOSTED_PRIVATE_TEXT Нужен быстрый поиск'}}
    const detail = () => editor!.current()!.remote.control.detail({orgId, id})
    const list = () => privateAnswers!.current()!.remote.control.list({orgId, formId: id, version: 1, offset: 0, limit: 100})
    await checkHostedApplication({name: 'forms', async verify({url, iteration}) {
        assert((await fetch(url).then(response => response.text())).includes('Petal'))
        if (!owner) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            owner = createServiceClient<FormsDefinition>({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            analyst = createServiceClient<FormsDefinition>({definition, url, auth: {credentials: {account: 'analyst', password: 'analyst-pass'}}})
            await owner.ready(); await analyst.ready(); await owner.views.workspace.ready
            editor = openEditor(owner); privateAnswers = openAnswers(owner); answers = openAnswers(analyst)
            grouping = openGrouping(owner); exports = openExports(owner)
            await waitForHosted('Forms staff resources', () => !!editor?.current() && !!answers?.current() && !!privateAnswers?.current() && !!grouping?.current() && !!exports?.current())
            token = (await editor.current()!.remote.control.publish(publish)).token!
            assert(token)
            async function login(account: string, password: string) {
                const result = await fetch(url + '/api/forms/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account, password}]}), signal: AbortSignal.timeout(3000)}).then(response => response.json())
                assert(result.ok)
                return result.value.token as string
            }
            analystBearer = await login('analyst', 'analyst-pass')
            respondentBearer = await login('respondent', token)
            respondent = createServiceClient<FormsDefinition>({definition, url, auth: {credentials: {account: 'respondent', password: token}}})
            await respondent.ready()
            publicform = openPublic(respondent)
            await waitForHosted('public form', () => !!publicform?.current())
            await publicform.current()!.remote.control.submit(first)
            for (const [index, details] of ['Цена слишком высокая', 'Редактор неудобный'].entries()) await publicform.current()!.remote.control.submit({...first, nonce: 'hosted-response-' + (index + 1), answers: {...first.answers, details}})
            const form = await detail()
            assert.equal(form.answersRevision, 3)
            groupId = (await grouping.current()!.remote.ai.createRun({requestId: 'hosted-group', kind: 'group', resourceIds: [id], input: {orgId, formId: id, version: 1, answersRevision: form.answersRevision, fieldId: 'details'}})).id
            exportId = (await exports.current()!.remote.ai.createRun({requestId: 'hosted-export', kind: 'export', resourceIds: [id], input: {orgId, formId: id, revision: form.answersRevision, version: 1, format: 'json'}})).id
            await waitForHosted('private grouping and export completed', async () => {
                try {await grouping!.current()!.remote.control.result(groupId); await exports!.current()!.remote.control.result(exportId); return true} catch {return false}
            })
            const result = await grouping.current()!.remote.control.result(groupId)
            await grouping.current()!.remote.control.correct({runId: groupId, revision: result.revision, groups: [{label: 'Проверено сотрудником', sourceIds: result.groups.flatMap(group => group.sourceIds)}]})
        } else {
            await waitForHosted('same Forms resources after release change', () => !!owner?.health.state.connected && (editor?.current()?.generation ?? 0) > generation && !!privateAnswers?.current() && !!grouping?.current() && !!exports?.current())
            const form = await detail()
            assert.equal(form.versions.length, 1)
            assert.equal(form.answersRevision, 3)
            assert.equal((await editor!.current()!.remote.control.publish(publish)).token, null)
            if (iteration == 1) {
                await waitForHosted('same respondent after deploy', () => !!publicform?.current() && !!answers?.current())
                assert.equal((await publicform!.current()!.remote.control.submit(first)).duplicate, true)
                const retained = answers!.current()!.remote, retainedPublic = publicform!.current()!.remote
                await owner.commands.memberRole('revoke-analyst', {orgId, revision: owner.views.workspace.store.state.organizations.find(value => value.id == orgId)!.revision, account: 'analyst', role: 'none'})
                await assert.rejects(retained.control.list({orgId, formId: id, version: 1, offset: 0, limit: 10}))
                await owner.commands.formDisable('disable-publication', {orgId, id, revision: form.revision})
                await assert.rejects(retainedPublic.control.current())
            } else {
                assert.equal(form.enabled, false)
                assert.equal(owner.views.workspace.store.state.people.some(value => value.account == 'analyst' && value.orgId == orgId), false)
                const rejected = await fetch(url + '/api/forms/commands/answerSubmit', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + respondentBearer}, body: JSON.stringify({args: ['revoked-after-rollback', {formId: id, version: 1, nonce: 'no-new-response', answersJson: JSON.stringify(first.answers)}]}), signal: AbortSignal.timeout(3000)}).then(response => response.json())
                assert.equal(rejected.ok, false)
                assert.match(rejected.error.message, /forbidden|denied|доступ|публикац|отозван|unauthorized/i)
                const denied = await fetch(url + '/api/forms/views/workspace', {headers: {authorization: 'Bearer ' + analystBearer}, signal: AbortSignal.timeout(3000)}).then(response => response.json())
                assert.equal(denied.ok, false)
                assert.match(denied.error.message, /forbidden|denied|доступ|unauthorized/i)
                const oldLink = await fetch(url + '/api/forms/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account: 'respondent', password: token}]}), signal: AbortSignal.timeout(3000)}).then(response => response.json())
                assert.equal(oldLink.ok, false)
            }
        }
        const rows = await list()
        assert.equal(rows.total, 3)
        assert.equal(rows.items.filter(value => value.answers.details == first.answers.details).length, 1)
        const result = await grouping!.current()!.remote.control.result(groupId)
        assert.equal(result.revision, 2)
        assert.equal(result.groups[0].label, 'Проверено сотрудником')
        assert.equal(result.groups[0].sourceIds.length, 3)
        const bytes = await exports!.current()!.remote.control.result(exportId)
        assert.equal(JSON.parse(Buffer.from(bytes.bytes).toString('utf8')).length, 3)
        assert.equal(JSON.stringify(owner.views.workspace.store.state).includes('HOSTED_PRIVATE_TEXT'), false)
        assert.equal(JSON.stringify(await grouping!.current()!.remote.ai.state.keyframe()).includes('Проверено сотрудником'), false)
        generation = editor?.current()?.generation ?? 0
    }, async close() {
        await exports?.close(); await grouping?.close(); await privateAnswers?.close(); await answers?.close(); await publicform?.close(); await editor?.close()
        respondent?.close(); analyst?.close(); owner?.close()
    }})
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
