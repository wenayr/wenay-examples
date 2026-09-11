import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createStore, syncStoreReplay, type StoreReplayRemote} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createSupportRuntime, type SupportDefinition} from './runtime'
import type {Attachment} from './files-resource'
import type {DraftProvider} from './assistant-resource'

async function waitFor(label: string, check: () => boolean) {
    const until = Date.now() + 5000
    while (!check()) {
        assert(Date.now() < until, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'support-resource-check-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    const pending: {signal: AbortSignal, sources: {id: string, title: string, body: string}[], finish: (value: {text: string}) => void}[] = []
    const provider: DraftProvider = {draft(input) {
        return new Promise(resolve => pending.push({signal: input.signal, sources: input.sources, finish: resolve}))
    }}
    let definition: SupportDefinition
    async function start() {
        const runtime = createSupportRuntime({directory, provider, timeoutMs: 1200})
        definition = runtime.definition
        return createServiceLeaderHost({definition: runtime.definition, env, rest: false,
            mount({leader}) {return runtime.mount(leader.line.control.store)}})
    }
    let host: Awaited<ReturnType<typeof start>> | undefined
    const sessions = new Map<string, ServiceClient<SupportDefinition>>()
    const resources: {close(): Promise<void>}[] = []
    const mirrors: (() => void)[] = []
    const replayErrors: unknown[] = []
    async function client(account: string) {
        if (sessions.has(account)) return sessions.get(account)!
        const session = createServiceClient({definition: describeService(definition), url: host!.url,
            auth: {token: host!.leader.identity.login(account).token}})
        sessions.set(account, session)
        await session.ready()
        return session
    }
    function mirror<T extends object>(remote: StoreReplayRemote<T>, initial: () => T) {
        // Обход common2: AI-RESOURCE-LIFECYCLE. Публичное state-only зеркало с onError
        // вместо специализированного AI-клиента: тот при отзыве SC1 во время replay
        // даёт необработанное исключение.
        // Удалить после исправления, см. doc/library-tasks/WORKAROUNDS.md
        const store = createStore(initial())
        const sync = syncStoreReplay(store, remote, {onError(error) {replayErrors.push(error); store.replace(initial())}})
        mirrors.push(sync)
        return {store, ready: sync.ready, close: sync}
    }
    async function files(account: string) {
        const resource = (await client(account)).resources.open('files')
        resources.push(resource)
        await waitFor('files resource ready', () => resource.status.state.phase == 'ready')
        const remote = resource.current()!.remote
        const view = mirror<{files: Attachment[]}>(remote.view, () => ({files: []}))
        await view.ready
        return {resource, remote, view}
    }
    async function assistant(account: string) {
        const resource = (await client(account)).resources.open('assistant')
        resources.push(resource)
        await waitFor('assistant resource ready', () => resource.status.state.phase == 'ready')
        const remote = resource.current()!.remote
        const view = mirror<AiRunStore>(remote.ai.state, () => ({runs: {}, approvals: {}, inputs: {}}))
        await view.ready
        return {resource, remote, view}
    }
    async function stop() {
        for (const close of mirrors.splice(0)) close()
        for (const resource of resources.splice(0)) await resource.close()
        for (const session of sessions.values()) session.close()
        sessions.clear()
        await host?.close()
        host = undefined
    }
    try {
        host = await start()
        const owner = await client('owner')
        const customer = await files('customer')
        const agent = await files('agent')
        const outsider = await files('outsider')
        const payload = {orgId: 'northstar', ticketId: 'ticket-welcome', name: 'evidence.txt', bytes: new TextEncoder().encode('only the ticket participants may download this')}
        const uploaded = await customer.remote.control.upload(payload)
        assert.equal((await customer.remote.control.upload({...payload, name: 'another-name.txt'})).id, uploaded.id, 'Same ticket/content upload is deduplicated')
        await waitFor('attachment reaches another account', () => agent.view.store.state.files.some(item => item.id == uploaded.id))
        assert.equal(customer.view.store.state.files.filter(item => item.id == uploaded.id).length, 1)
        assert.equal(outsider.view.store.state.files.length, 0)
        assert.deepEqual(Array.from((await agent.remote.control.download(uploaded.id)).bytes), Array.from(payload.bytes))
        await assert.rejects(outsider.remote.control.download(uploaded.id))
        await assert.rejects(outsider.remote.control.upload(payload))
        await assert.rejects(customer.remote.control.upload({...payload, ticketId: 'ticket-export'}), /доступа/)
        await assert.rejects(customer.remote.control.upload({...payload, bytes: new Uint8Array(0)}))
        await assert.rejects(customer.remote.control.upload({...payload, bytes: new Uint8Array(512 * 1024 + 1)}))
        await assert.rejects(customer.remote.control.upload({...payload, name: 'bad\nname'}))
        const foreign = await outsider.remote.control.upload({...payload, orgId: 'harbor', ticketId: 'ticket-harbor'})
        assert.notEqual(foreign.id, uploaded.id, 'Identical bytes in another tenant do not share public attachment identity')
        await assert.rejects(customer.remote.control.download(foreign.id))

        const oldGeneration = agent.resource.status.state.generation
        await owner.commands.memberRole('files-revoke', {orgId: 'northstar', account: 'agent', role: 'revoked'})
        await waitFor('revoked resource generation replaced', () => agent.resource.status.state.generation > oldGeneration && agent.resource.status.state.phase == 'ready')
        await assert.rejects(agent.remote.control.download(uploaded.id), 'Retained generation cannot read files')
        const deniedFiles = await files('agent')
        assert.equal(deniedFiles.view.store.state.files.length, 0)
        await assert.rejects(deniedFiles.remote.control.download(uploaded.id))
        assert(replayErrors.length > 0, 'Remote close is observed through the explicit replay error port')
        const invitation = await owner.commands.inviteCreate('files-reinvite', {orgId: 'northstar', role: 'agent', hours: 1})
        await (await client('agent')).commands.inviteAccept('files-regain', {token: invitation.token})
        const restoredFiles = await files('agent')
        assert.deepEqual(Array.from((await restoredFiles.remote.control.download(uploaded.id)).bytes), Array.from(payload.bytes))

        const ai = await assistant('agent')
        const request = {kind: 'answer', resourceIds: ['ticket-welcome'], input: {orgId: 'northstar', ticketId: 'ticket-welcome', revision: host.leader.line.control.store.state.tickets['ticket-welcome'].revision}}
        const stale = await ai.remote.ai.createRun({...request, requestId: 'changed-source'})
        await waitFor('first provider waiting', () => pending.length == 1)
        assert(pending[0].sources.some(source => source.id == 'article-invite'))
        assert(!pending[0].sources.some(source => source.id == 'article-harbor' || source.id == 'article-internal'))
        await owner.commands.articlePublish('archive-awaiting-source', {orgId: 'northstar', id: 'article-invite', revision: 1, status: 'archived'})
        pending[0].finish({text: 'PRIVATE_STALE_SOURCE_RESULT'})
        await waitFor('changed source fails run', () => ai.view.store.state.runs[stale.id]?.state == 'failed')
        await assert.rejects(ai.remote.control.result(stale.id), /Источник/)
        assert(!JSON.stringify(await ai.remote.ai.state.keyframe()).includes('PRIVATE_STALE_SOURCE_RESULT'))
        await owner.commands.articlePublish('restore-source', {orgId: 'northstar', id: 'article-invite', revision: 2, status: 'published'})

        const cancelled = await ai.remote.ai.createRun({...request, requestId: 'cancel-provider'})
        await waitFor('second provider waiting', () => pending.length == 2)
        await ai.remote.ai.cancelRun(cancelled.id, 'Customer cancelled')
        assert(pending[1].signal.aborted, 'Provider receives abort')
        pending[1].finish({text: 'PRIVATE_CANCELLED_RESULT'})
        await new Promise(resolve => setTimeout(resolve, 25))
        await waitFor('cancel survives late provider', () => ai.view.store.state.runs[cancelled.id]?.state == 'cancelled')
        await assert.rejects(ai.remote.control.result(cancelled.id))
        assert(!JSON.stringify(await ai.remote.ai.state.keyframe()).includes('PRIVATE_CANCELLED_RESULT'))

        const completed = await ai.remote.ai.createRun({...request, requestId: 'persisted-draft'})
        await waitFor('third provider waiting', () => pending.length == 3)
        pending[2].finish({text: 'PRIVATE_PERSISTED_DRAFT'})
        await waitFor('persisted draft completed', () => ai.view.store.state.runs[completed.id]?.state == 'completed')
        const draft = await ai.remote.control.result(completed.id)
        assert.equal(draft.text, 'PRIVATE_PERSISTED_DRAFT')
        assert.equal(draft.demo, false, 'Injected test provider is distinct from built-in no-provider fixture')
        assert.deepEqual(ai.view.store.state.runs[completed.id].result, {available: true, demo: false})
        assert(!JSON.stringify(await ai.remote.ai.state.keyframe()).includes(draft.text))
        const foreignAi = await assistant('outsider')
        await assert.rejects(foreignAi.remote.control.result(completed.id))

        await stop()
        host = await start()
        const diskFiles = await files('customer')
        assert.deepEqual(Array.from((await diskFiles.remote.control.download(uploaded.id)).bytes), Array.from(payload.bytes))
        assert.equal((await diskFiles.remote.control.upload(payload)).id, uploaded.id, 'Upload dedup survives restart')
        const diskAi = await assistant('agent')
        assert.equal((await diskAi.remote.control.result(completed.id)).text, draft.text, 'Private draft survives disk restart')
        assert.equal((await diskAi.remote.ai.createRun({...request, requestId: 'persisted-draft'})).id, completed.id, 'AI receipt survives restart')
        assert.equal(pending.length, 3, 'Restart and duplicate request do not repeat provider work')
        assert(!JSON.stringify(await diskAi.remote.ai.state.keyframe()).includes(draft.text))
        const timed = await diskAi.remote.ai.createRun({...request, requestId: 'hanging-provider'})
        await waitFor('hung provider terminated', () => diskAi.view.store.state.runs[timed.id]?.state == 'failed')
        assert(pending[3].signal.aborted)
        pending[3].finish({text: 'LATE_TIMEOUT_RESULT'})
        await new Promise(resolve => setTimeout(resolve, 25))
        await assert.rejects(diskAi.remote.control.result(timed.id))
        assert(!JSON.stringify(await diskAi.remote.ai.state.keyframe()).includes('LATE_TIMEOUT_RESULT'))
        console.log('PASS support resources: real SC1, binary files/dedup/tenant isolation/revoke/regain/disk restore, guarded AI sources, cancellation, private draft persistence and replay')
    } finally {
        for (const task of pending) task.finish({text: 'TEST CLEANUP'})
        await stop()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('support-resource-check-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}

void main().catch(function failed(error) {console.error(error); process.exitCode = 1})
