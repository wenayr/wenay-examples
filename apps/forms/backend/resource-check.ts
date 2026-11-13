import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync, readdirSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createFormsRuntime, type FormsDefinition} from './runtime'
import {createFormsArchive} from './archive'

async function waitFor(check: () => boolean | Promise<boolean>) {
    const until = Date.now() + 5000
    while (!await check()) {
        assert(Date.now() < until, 'Condition timeout')
        await delay(10)
    }
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'forms-resource-check-'))
    const env = {
        SERVICE_PORT: '0',
        SERVICE_HOST: '127.0.0.1',
        SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
        SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let clock = Date.UTC(2026, 8, 10), definition!: FormsDefinition
    async function start() {
        const runtime = createFormsRuntime({directory: path.join(directory, 'exports'), now: () => clock})
        const archive = createFormsArchive({directory})
        definition = runtime.definition
        return createServiceLeaderHost({definition, env, durable: archive.durable, mount({leader}) {
            const close = runtime.mount({store: leader.line.control.store, corridor: leader.corridor}), closeArchive = archive.mount(leader)
            return async function stop() {
                await close()
                closeArchive()
            }
        }})
    }
    let host = await start()
    const clients: ServiceClient<FormsDefinition>[] = [], closes: (() => void | Promise<void>)[] = []
    async function client(account: string, password = account + '-pass') {
        const value = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account, password}}})
        clients.push(value)
        await value.ready()
        return value
    }
    async function resource<K extends keyof FormsDefinition['resources']>(client: ServiceClient<FormsDefinition>, name: K) {
        const handle = client.resources.open(name)
        closes.push(handle.close)
        await waitFor(() => handle.status.state.phase == 'ready')
        return handle.current()!.remote
    }
    async function stop() {
        for (const close of closes.splice(0).reverse()) await close()
        for (const client of clients.splice(0)) client.close()
        await host.close()
    }
    const id = 'form-feedback', orgId = 'northstar'
    const form = () => host.leader.line.control.store.state.forms[id]
    try {
        const owner = await client('owner'), analyst = await client('analyst'), outsider = await client('outsider')
        const editor = await resource(owner, 'editor'), analystEditor = await resource(analyst, 'editor')
        const foreign = await resource(outsider, 'editor')
        await assert.rejects(foreign.control.detail({orgId, id}))
        await assert.rejects(analystEditor.control.publish({orgId, id, revision: form().revision, requestId: 'analyst'}))
        const publish = {orgId, id, revision: form().revision, requestId: 'publish-first'}
        const first = await editor.control.publish(publish)
        assert(first.token)
        assert.equal((await editor.control.publish(publish)).token, null)
        assert.equal(JSON.stringify(host.leader.line.control.store.snapshot()).includes(first.token), false)
        const respondent = await client('respondent', first.token), publicform = await resource(respondent, 'publicform')
        assert.equal((await publicform.control.current()).version, 1)
        const submission = {version: 1, nonce: 'web-response-001', answers: {rating: 4, recommend: false, details: '=PRIVATE_SURVEY_TEXT'}}
        const accepted = await publicform.control.submit(submission)
        assert.equal((await publicform.control.submit(submission)).duplicate, true)
        await assert.rejects(publicform.control.submit({...submission, answers: {...submission.answers, rating: 1}}), /другого ответа/)
        const hidden = {
            ...submission,
            nonce: 'bad-hidden-001',
            answers: {...submission.answers, recommend: true}
        }
        await assert.rejects(publicform.control.submit(hidden), /known field/)
        await owner.views.workspace.ready
        await waitFor(() => owner.views.workspace.store.state.aggregates[0]?.count == 1)
        assert.equal(JSON.stringify(owner.views.workspace.store.snapshot()).includes('PRIVATE_SURVEY_TEXT'), false)
        const listing = await resource(analyst, 'answers')
        assert.equal((await listing.control.list({orgId, formId: id, version: 1, offset: 0, limit: 1})).items[0].answers.details, '=PRIVATE_SURVEY_TEXT')
        const exports = await resource(analyst, 'exports')
        // Обход common2: AI-RESOURCE-LIFECYCLE. Публичное state-only зеркало с onError
        // вместо специализированного AI-клиента: тот при отзыве SC1 во время replay
        // даёт необработанное исключение.
        // Удалить после исправления, см. doc/library-tasks/WORKAROUNDS.md
        const mirror = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}})
        const sync = syncStoreReplay(mirror, exports.ai.state, {onError() {mirror.replace({runs: {}, inputs: {}, approvals: {}})}})
        closes.push(sync)
        await sync.ready
        const exported = await exports.ai.createRun({
            requestId: 'export-json',
            kind: 'export',
            resourceIds: [id],
            input: {orgId, formId: id, revision: form().answersRevision, version: 1, format: 'json'}
        })
        await waitFor(() => mirror.state.runs[exported.id]?.state == 'completed')
        const output = await exports.control.result(exported.id)
        assert.equal(JSON.parse(Buffer.from(output.bytes).toString('utf8'))[0].answers.details, '=PRIVATE_SURVEY_TEXT')
        assert.equal(JSON.stringify(await exports.ai.state.keyframe()).includes('PRIVATE_SURVEY_TEXT'), false)
        const csv = await exports.ai.createRun({
            requestId: 'export-csv',
            kind: 'export',
            resourceIds: [id],
            input: {orgId, formId: id, revision: form().answersRevision, version: 0, format: 'csv'}
        })
        await waitFor(() => mirror.state.runs[csv.id]?.state == 'completed')
        assert.match(Buffer.from((await exports.control.result(csv.id)).bytes).toString('utf8'), /'=PRIVATE_SURVEY_TEXT/)
        const localExport = definition.resources.exports.open({
            principal: {account: 'analyst', roles: ['analyst']},
            sessionId: 'cancel-test',
            resourceId: 'exports',
            signal: new AbortController().signal
        })
        const cancelled = localExport.facade.ai.createRun({
            requestId: 'cancel-export',
            kind: 'export',
            resourceIds: [id],
            input: {orgId, formId: id, revision: form().answersRevision, version: 0, format: 'csv'}
        })
        assert.equal(localExport.facade.ai.cancelRun(cancelled.id, 'Cancel before file commit').state, 'cancelled')
        await assert.rejects(localExport.facade.control.result(cancelled.id), /недоступна/)
        localExport.close()
        const archive = readFileSync(path.join(directory, 'forms.jsonl'), 'utf8')
        assert(archive.includes('PRIVATE_SURVEY_TEXT'), 'fixture must occur in durable archive before erasure')
        await stop()
        host = await start()
        const restoredOwner = await client('owner'), restoredAnalyst = await client('analyst')
        const restoredExport = await resource(restoredAnalyst, 'exports')
        assert.equal(JSON.parse(Buffer.from((await restoredExport.control.result(exported.id)).bytes).toString('utf8')).length, 1)
        const oldPublicClient = await client('respondent', first.token), oldPublic = await resource(oldPublicClient, 'publicform')
        await restoredOwner.commands.answerDelete('delete-private-answer', {orgId, formId: id, id: accepted.id})
        await waitFor(() => !readFileSync(path.join(directory, 'forms.jsonl'), 'utf8').includes('PRIVATE_SURVEY_TEXT'))
        const receipts = readFileSync(path.join(directory, 'forms.control.jsonl'), 'utf8')
        const note = 'command receipts do not keep raw answers'
        assert.equal(receipts.includes('PRIVATE_SURVEY_TEXT'), false, note)
        await assert.rejects(restoredExport.control.result(exported.id), /измени|недоступна/)
        await waitFor(() => readdirSync(path.join(directory, 'exports', 'files')).filter(name => /^[a-f0-9]{64}$/.test(name)).length == 0)
        assert.equal((await oldPublic.control.submit(submission)).deleted, true)
        const fresh = await oldPublic.control.submit({version: 1, nonce: 'expiry-response-001', answers: {rating: 3, recommend: true}})
        clock += 31 * 86400000
        const rows = await resource(restoredAnalyst, 'answers')
        const page = await rows.control.list({orgId, formId: id, version: 0, offset: 0, limit: 100})
        assert.equal(page.total, 0, 'expired raw responses denied before sweeper catches up')
        await host.leader.corridor.system.retentionSweep('expire-test-clock', {})
        assert.equal(host.leader.line.control.store.state.submissions[fresh.id], undefined)
        assert.equal(host.leader.line.control.store.state.aggregates[id + ':1'].count, 0)
        await restoredOwner.commands.formDisable('close-link', {orgId, id, revision: form().revision})
        await assert.rejects(oldPublic.control.current())
        const newEditor = await resource(restoredOwner, 'editor')
        const next = await newEditor.control.publish({orgId, id, revision: form().revision, requestId: 'new-public-token'})
        assert(next.token)
        await assert.rejects(oldPublic.control.submit({...submission, version: 2, nonce: 'old-generation-after-publish'}))
        const revision = host.leader.line.control.store.state.organizations[orgId].revision
        await restoredOwner.commands.memberRole('revoke-analyst', {
            orgId,
            revision,
            account: 'analyst',
            role: 'none'
        })
        await assert.rejects(rows.control.list({orgId, formId: id, version: 0, offset: 0, limit: 100}))
        console.log('PASS forms resources: real service login/SC1 public form, single-display token, receipt privacy, guarded private pages, durable AI export bytes, CSV formula escaping, correction/deletion invalidation + physical cleanup, expiry, public generation and retained staff revocation')
    } finally {
        await stop()
        const parent = path.dirname(path.resolve(directory))
        const named = path.basename(directory).startsWith('forms-resource-check-')
        if (parent != temporary || !named) throw new Error('Unsafe cleanup target')
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
