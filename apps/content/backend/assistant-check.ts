import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createContentService} from './service'
import {createContentAssistant, type EditProvider, type EditSource} from './assistant-resource'

async function until(predicate: () => boolean) {const deadline = Date.now() + 4000; while (!predicate()) {assert(Date.now() < deadline, 'timeout'); await delay(10)}}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'content-assistant-'))
    const leader = createServiceLeader({definition: createContentService().definition, selfUrl: () => 'http://localhost'})
    const state = () => leader.line.control.store.snapshot(), owner = leader.corridor.fragment('owner'), author = leader.corridor.fragment('author')
    const pending: {source: EditSource, signal: AbortSignal, finish: (value: string) => void, reject: (error: Error) => void}[] = []
    const provider: EditProvider = {suggest(input) {return new Promise((finish, reject) => pending.push({...input, finish, reject}))}}
    function start(provider?: EditProvider) {const assistant = createContentAssistant({directory, provider, timeoutMs: 400}); return {assistant, close: assistant.mount(leader.line.control.store)}}
    let running = start(), seq = 0
    const stops: (() => void)[] = [], rpc = () => 'ai-' + (++seq)
    async function open(account: string) {
        const connection = running.assistant.resource.open({principal: {account, roles: ['author']}, sessionId: account, resourceId: 'assistant', signal: new AbortController().signal})
        const view = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}}), mirror = syncStoreReplay(view, connection.facade.ai.state)
        await mirror.ready; stops.push(mirror, connection.close)
        return {...connection.facade, view}
    }
    const input = () => ({orgId: 'northstar', id: 'welcome', revision: state().pages.welcome.revision, blockId: 'intro'})
    const request = (requestId: string) => ({requestId, kind: 'edit', resourceIds: ['welcome'], input: {...input(), instruction: 'Улучшить текст'}})
    function closeConnections() {for (const stop of stops.splice(0)) stop()}
    try {
        const client = await open('author'), other = await open('outsider'), reader = await open('reader')
        assert.throws(() => other.control.source(input()), /доступа/); assert.throws(() => reader.ai.createRun(request('reader')), /forbidden/)
        const original = JSON.stringify(state().pages.welcome), run = client.ai.createRun(request('local'))
        await until(() => client.view.state.runs[run.id]?.state == 'completed')
        assert.equal(client.control.result(run.id).demo, true); assert.equal(JSON.stringify(state().pages.welcome), original)
        assert.throws(() => other.control.result(run.id), /недоступно/)
        closeConnections(); running.close(); await delay(10); running = start(provider)
        const active = await open('author')
        assert.equal(active.control.result(run.id).before, state().pages.welcome.draft.blocks[0].text)
        const good = active.ai.createRun(request('provider'))
        await until(() => pending.length == 1)
        assert.deepEqual(Object.keys(pending[0].source).sort(), ['orgId', 'id', 'revision', 'title', 'blockId', 'kind', 'before'].sort())
        pending[0].finish('PRIVATE_PROPOSAL')
        await until(() => active.view.state.runs[good.id]?.state == 'completed')
        assert(!JSON.stringify(await active.ai.state.keyframe()).includes('PRIVATE_PROPOSAL'))
        const suggestion = active.control.result(good.id), page = state().pages.welcome
        await author.pageSave(rpc(), {orgId: 'northstar', id: page.id, revision: suggestion.revision, ...page.draft, blocks: page.draft.blocks.map(block => block.id == suggestion.blockId ? {...block, text: suggestion.after} : block)})
        assert.equal(state().pages.welcome.draft.blocks[0].text, 'PRIVATE_PROPOSAL')
        assert.equal(state().pages.welcome.publishedVersion, 0, 'human edit does not approve or publish')
        assert.throws(() => active.control.result(good.id), /изменилась/)
        await assert.rejects(author.pageSave(rpc(), {orgId: 'northstar', id: page.id, revision: suggestion.revision, ...page.draft}), /изменилась/)
        const cancelled = active.ai.createRun(request('cancel'))
        await until(() => pending.length == 2); active.ai.cancelRun(cancelled.id, 'decline'); pending[1].finish('late')
        await until(() => active.view.state.runs[cancelled.id]?.state == 'cancelled'); assert(pending[1].signal.aborted)
        const timed = active.ai.createRun(request('timeout'))
        await until(() => pending.length == 3); await until(() => active.view.state.runs[timed.id]?.state == 'failed'); pending[2].finish('late'); assert(pending[2].signal.aborted)
        const failed = active.ai.createRun(request('failure'))
        await until(() => pending.length == 4); pending[3].reject(new Error('SECRET_PROVIDER_ERROR')); await until(() => active.view.state.runs[failed.id]?.state == 'failed')
        assert(!JSON.stringify(await active.ai.state.keyframe()).includes('SECRET_PROVIDER_ERROR'))
        const changed = active.ai.createRun(request('changed'))
        await until(() => pending.length == 5)
        await author.pageSave(rpc(), {orgId: 'northstar', id: 'welcome', revision: state().pages.welcome.revision, ...state().pages.welcome.draft, title: 'Другой заголовок'})
        await until(() => pending[4].signal.aborted); pending[4].finish('late'); await until(() => active.view.state.runs[changed.id]?.state == 'failed')
        const revoked = active.ai.createRun(request('revoke')), later = request('after-revoke')
        await until(() => pending.length == 6)
        await owner.memberRole(rpc(), {orgId: 'northstar', account: 'author', role: 'revoked'})
        await until(() => pending[5].signal.aborted); pending[5].finish('late'); await until(() => active.view.state.runs[revoked.id]?.state == 'failed')
        assert.throws(() => active.ai.createRun(later), /forbidden/)
        assert.throws(() => active.control.result(run.id), /доступа/)
        console.log('PASS content assistant: local explicit executor, before/after, no write before human accept, fresh revision, public output isolation, private restart, cancel/timeout/late/revoke/source change and sanitized errors')
    } finally {
        closeConnections(); running.close(); await delay(10); leader.control.close()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('content-assistant-')); rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
