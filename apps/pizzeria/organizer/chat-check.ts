import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import {createOrganizerService} from './service'
import type {ChatView} from './chat-resource'

async function main() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wenay-chat-'))
    async function start() {
        const service = createOrganizerService({directory})
        const host = await createServiceLeaderHost({definition: service.definition, env: {SERVICE_PORT: '0'}, rest: false, mount: ({leader}) => service.mount(leader.line.control.store)})
        function client(account: string) {return createServiceClient({definition: describeService(service.definition), url: host.url, auth: {token: host.leader.identity.login(account).token}})}
        const owner = client('owner'), worker = client('worker')
        const a = owner.resources.open('chat'), b = worker.resources.open('chat')
        await wait(() => !!a.current() && !!b.current())
        const view = createStore<ChatView>({rooms: [], room: '', messages: [], older: '', typing: []})
        const sync = syncStoreReplayBatch(view, b.current()!.remote.view)
        await sync.ready
        return {host, owner, worker, a, b, view, async close() {sync(); await a.close(); await b.close(); owner.close(); worker.close(); await host.close()}}
    }
    async function wait(check: () => boolean) {const until = Date.now() + 5000; while (!check()) {assert(Date.now() < until, 'chat wait timed out'); await new Promise(resolve => setTimeout(resolve, 10))}}
    let session = await start()
    try {
        let owner = session.a.current()!.remote.control, worker = session.b.current()!.remote.control
        const input = {requestId: 'new-room', title: 'Рабочий разговор', participants: ['worker'], task: ''}
        const room = await owner.create(input)
        assert.equal(await owner.create(input), room)
        await worker.select(room, '')
        const post = {requestId: 'message-1', room, text: 'Проверить печь', reply: ''}
        const message = await owner.post(post)
        assert.equal(await owner.post(post), message)
        await wait(() => session.view.state.messages.length == 1)
        await assert.rejects(worker.edit({requestId: 'foreign-edit', room, message, text: 'Нет', revision: 0}))
        await owner.edit({requestId: 'edit-1', room, message, text: 'Проверить две печи', revision: 0})
        await wait(() => session.view.state.messages[0]?.editRevision == 1)
        await assert.rejects(owner.edit({requestId: 'stale-edit', room, message, text: 'Старая правка', revision: 0}))
        const file = await owner.upload({requestId: 'file-1', room, name: 'test.txt', bytes: new Uint8Array([65, 66])})
        assert.deepEqual([...await worker.download(room, file)], [65, 66])
        const ai = session.a.current()!.remote.ai
        const run = await ai.createRun({requestId: 'draft-tasks', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Проверить печь; Заказать сыр'}})
        let results = await owner.results(room)
        const resultDeadline = Date.now() + 5000
        while (!results.length) {assert(Date.now() < resultDeadline, 'AI result timed out'); await new Promise(resolve => setTimeout(resolve, 10)); results = await owner.results(room)}
        assert.equal((await ai.createRun({requestId: 'draft-tasks', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Проверить печь; Заказать сыр'}})).id, run.id)
        const proposal = results[0]
        assert.equal(proposal.result.items.length, 2)
        const applied = await session.owner.commands.workApplyProposal('apply-proposal', {proposal: proposal.id, items: proposal.result.items})
        assert.deepEqual(await session.owner.commands.workApplyProposal('apply-again-new-request', {proposal: proposal.id, items: proposal.result.items}), applied)
        const beforeInvalid = Object.keys(session.host.leader.line.control.store.state.organizer.tasks).length
        await assert.rejects(session.worker.commands.workApplyProposal('bad-assignment', {proposal: 'bad', items: [{title: 'one', due: '', assignee: 'worker'}, {title: 'two', due: '', assignee: 'owner'}]}))
        assert.equal(Object.keys(session.host.leader.line.control.store.state.organizer.tasks).length, beforeInvalid)
        await owner.membership({requestId: 'remove-member', room, participants: ['owner'], revision: 0})
        await wait(() => session.view.state.rooms.length == 0 && session.view.state.messages.length == 0)
        await assert.rejects(worker.download(room, file))
        await assert.rejects(worker.post({...post, requestId: 'forbidden'}))
        await owner.membership({requestId: 'return-member', room, participants: ['owner', 'worker'], revision: 1})
        for (let i = 0; i < 55; i++) await owner.post({requestId: 'page-' + i, room, text: 'Сообщение ' + i, reply: ''})
        await worker.select(room, '')
        await wait(() => session.view.state.messages.length == 50)
        const older = session.view.state.older
        assert(older)
        await worker.search(room, 'Сообщение 0')
        await wait(() => session.view.state.messages.length == 1)
        await worker.search(room, '')
        await worker.select(room, older)
        await wait(() => session.view.state.messages.length == 7)
        await session.close()
        session = await start()
        owner = session.a.current()!.remote.control; worker = session.b.current()!.remote.control
        assert.equal(await owner.create(input), room)
        assert.equal(await owner.post(post), message)
        await worker.select(room, older)
        await wait(() => session.view.state.messages.length == 7)
        assert.equal(session.view.state.messages[0].editRevision, 1)
        assert.equal((await owner.results(room))[0].result.items.length, 2)
        const restoredRun = await session.a.current()!.remote.ai.createRun({requestId: 'draft-tasks', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Проверить печь; Заказать сыр'}})
        assert.equal(restoredRun.id, run.id, 'AI receipt survives a service restart')
        assert.equal(restoredRun.state, 'completed')
        await assert.rejects(session.a.current()!.remote.ai.createRun({requestId: 'draft-tasks', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Изменённый запрос'}}))
        assert.deepEqual([...await worker.download(room, file)], [65, 66])
        console.log('PASS chat RPC: durable conversations/messages/receipts, revisions, attachment access, membership revoke/regrant, bounded pages and restart')
    } finally {
        await session.close()
        if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected cleanup path')
        await rm(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
