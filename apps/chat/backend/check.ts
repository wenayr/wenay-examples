import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {type ConversationClient, type ConversationPostInput} from 'wenay-common2/conversation'
import {createChatService, type ChatDefinition} from './service'
import {createChatResource} from './chat-resource'
import {createOwnedConversation} from '../shared/conversation-client'
import {createConversationOwner} from '../frontend/conversation-owner'

async function wait(check: () => boolean, message: string) {
    const deadline = Date.now() + 10000
    while (!check()) {
        assert(Date.now() < deadline, message)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

function post(requestId: string, text: string, conversationId = 'shared', channelId = 'shared-main'): ConversationPostInput {
    return {requestId, conversationId, channelId, blocks: [{kind: 'text', version: 1, text}]}
}

async function main() {
    const fixtures = path.resolve('.test-data')
    await mkdir(fixtures, {recursive: true})
    const directory = await mkdtemp(path.join(fixtures, 'chat-'))
    const journalFile = path.join(directory, 'conversation', 'conversation.jsonl')
    const clients: ServiceClient<ChatDefinition>[] = []
    const mirrors: ConversationClient[] = []
    const owners: ReturnType<typeof createConversationOwner>[] = []
    let port = '0'
    let secrets: {nodeToken: string, tokenSecret: string} | null = null
    async function start(maxConversations?: number) {
        const service = createChatService({directory: path.join(directory, 'conversation')})
        const limited = maxConversations == null ? null : createChatResource({directory: path.join(directory, 'limited-conversation'),
            member: account => account == 'alice' || account == 'bob', maxConversations})
        if (limited) service.definition.resources.chat = limited.resource
        const host = await createServiceLeaderHost({definition: service.definition,
            env: {SERVICE_HOST: '127.0.0.1', SERVICE_PORT: port, SERVICE_DATA_DIR: path.join(directory, 'service'),
                ...(secrets ? {SERVICE_NODE_TOKEN: secrets.nodeToken, SERVICE_TOKEN_SECRET: secrets.tokenSecret} : {})},
            mount({leader}) {
                const release = service.mount(leader.line.control.store)
                return function close() {
                    limited?.close()
                    release()
                }
            }})
        port = new URL(host.url).port
        secrets = host.leader.secrets
        return {host, service}
    }
    let running = await start()
    async function open(account: string) {
        const response = await fetch(running.host.url + '/api/chat/login', {method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({args: [{account, password: account + '-pass'}]})})
        assert(response.ok, 'HTTP credential login')
        const login = await response.json() as {ok: boolean, value: {token: string}}
        assert(login.ok && login.value.token)
        const client = createServiceClient<ChatDefinition>({definition: describeService(running.service.definition),
            url: running.host.url, auth: {token: login.value.token}})
        clients.push(client)
        const resource = client.resources.open('chat')
        await wait(() => !!resource.current(), 'resource not ready')
        const remote = resource.current()!.remote
        const conversation = createOwnedConversation({remote: remote.conversation})
        mirrors.push(conversation)
        await conversation.ready
        return {client, resource, remote, conversation}
    }
    try {
        const alice = await open('alice')
        const bob = await open('bob')
        assert.deepEqual(bob.conversation.conversations().map(room => room.id), ['shared'])
        assert(alice.conversation.store.state.conversations['private-alice'])
        const seenEvents: string[] = []
        const offEvents = bob.conversation.events.on(function event(value) {
            if (value.type != 'sync') seenEvents.push(value.conversationId)
        })
        const input = {requestId: 'room-create', title: 'Проверка комнаты', participantIds: ['bob']}
        const room = await alice.conversation.createConversation(input)
        assert.equal((await alice.conversation.createConversation(input)).conversation.id, room.conversation.id)
        await assert.rejects(alice.conversation.createConversation({...input, title: 'Другой запрос'}))
        const otherAlice = await open('alice')
        const collision = await Promise.allSettled([
            alice.conversation.postMessage(post('concurrent-payload', 'Первый текст', room.conversation.id, room.channel.id)),
            otherAlice.conversation.postMessage(post('concurrent-payload', 'Другой текст', room.conversation.id, room.channel.id))
        ])
        assert.equal(collision.filter(result => result.status == 'fulfilled').length, 1, 'one payload must own the receipt')
        const rejected = collision.find(result => result.status == 'rejected')
        assert(rejected?.status == 'rejected')
        assert.match(String(rejected.reason), /другими параметрами/)
        const channelInput = {requestId: 'channel-create', conversationId: room.conversation.id, title: 'Обсуждение'}
        const channel = await alice.conversation.createChannel(channelInput)
        assert.equal((await alice.conversation.createChannel(channelInput)).id, channel.id)
        const first = await alice.conversation.postMessage(post('first', 'Привет, Боб!'))
        await wait(() => !!bob.conversation.store.state.messages[first.id], 'second client did not receive message')
        const answer = await bob.conversation.postMessage(post('first', 'Привет, Алиса!'))
        assert.notEqual(answer.id, first.id, 'receipts are scoped to account')
        await wait(() => !!alice.conversation.store.state.messages[answer.id], 'first client did not receive message')
        const lost = post('lost-response', 'Этот ответ будет потерян')
        let committedId = ''
        // The request crosses the real RPC transport; discard its successful response after durable commit.
        await assert.rejects(async function discardCommittedResponse() {
            const committed = await alice.conversation.postMessage(lost)
            committedId = committed.id
            const records = (await readFile(journalFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
            assert(records.some(record => record.receipt.entityId == committedId && record.receipt.requestId == lost.requestId))
            throw new Error('Simulated lost client response after durable commit')
        }, /Simulated lost client response/)
        assert.equal((await alice.conversation.postMessage(lost)).id, committedId)
        await assert.rejects(alice.conversation.postMessage(post('lost-response', 'Изменённый текст')))
        await assert.rejects(alice.conversation.createChannel({...channelInput, requestId: 'lost-response'}))
        const secret = await alice.conversation.postMessage(post('private-message', 'Только Алиса', 'private-alice', 'private-alice-main'))
        await assert.rejects(bob.conversation.postMessage(post('forbidden', 'Нет', 'private-alice', 'private-alice-main')))
        await assert.rejects(alice.conversation.postMessage(post('private-message', 'Только Алиса')))
        assert(!bob.conversation.store.state.messages[secret.id], 'private state leaked')
        assert(!seenEvents.includes('private-alice'), 'private semantic event leaked')
        const demoInput = {requestId: 'demo-reply', conversationId: 'shared', channelId: 'shared-main', sourceMessageId: first.id}
        const demo = await alice.remote.demo.reply(demoInput)
        assert.equal(demo.author.kind, 'assistant')
        assert.equal((await alice.remote.demo.reply(demoInput)).id, demo.id)
        await assert.rejects(alice.remote.demo.reply({...demoInput, sourceMessageId: answer.id}))
        await assert.rejects(bob.remote.demo.reply({...demoInput, conversationId: 'private-alice', channelId: 'private-alice-main',
            sourceMessageId: secret.id}))
        await wait(() => !!bob.conversation.store.state.messages[demo.id], 'demo answer not shared')
        const savedRemote = bob.remote
        bob.conversation.close()
        await bob.resource.close()
        await assert.rejects(savedRemote.conversation.postMessage(post('closed-resource', 'Закрытая команда')))
        const duringGap = await alice.conversation.postMessage(post('while-offline', 'После отключения второго клиента'))
        for (let index = 0; index < 12; index++) await alice.conversation.postMessage(post('history-' + index, 'История ' + index))
        const reopened = bob.client.resources.open('chat')
        await wait(() => !!reopened.current(), 'reopen not ready')
        const replayed = createOwnedConversation({remote: reopened.current()!.remote.conversation})
        mirrors.push(replayed)
        await replayed.ready
        assert(replayed.store.state.messages[duringGap.id])
        assert.equal(replayed.channelMessages('shared-main').length, 17, 'replay should not duplicate messages')
        await wait(() => alice.conversation.channelMessages('shared-main').length == 17, 'writer mirror did not converge')
        const beforeRestart = alice.conversation.store.state.conversations.shared.updatedAt
        offEvents()
        const ownerAlice = createConversationOwner({session: alice.client})
        const ownerBob = createConversationOwner({session: bob.client})
        owners.push(ownerAlice, ownerBob)
        await wait(() => ownerAlice.store.state.ready && ownerBob.store.state.ready, 'owned clients not ready before reconnect')
        const oldAlice = ownerAlice.current()!.client
        const oldBob = ownerBob.current()!.client
        const aliceGeneration = ownerAlice.status.state.generation
        const bobGeneration = ownerBob.status.state.generation
        for (const mirror of mirrors) mirror.close()
        mirrors.length = 0
        const originalUrl = running.host.url
        await running.host.close()
        await wait(() => ownerAlice.status.state.phase == 'offline' && ownerBob.status.state.phase == 'offline',
            'existing resources did not observe server shutdown')
        assert.equal(ownerAlice.current(), null)
        assert.equal(ownerBob.current(), null)
        assert.equal(Object.keys(oldAlice.store.state.messages).length, 0, 'old Alice generation must release its history')
        assert.equal(Object.keys(oldBob.store.state.messages).length, 0, 'old Bob generation must release its history')
        // Keep both service clients and their resource controllers alive; only the server restarts.
        running = await start()
        assert.equal(running.host.url, originalUrl, 'reconnect must use the original endpoint')
        await wait(() => ownerAlice.store.state.ready && ownerBob.store.state.ready, 'same clients did not automatically reconnect')
        assert(ownerAlice.status.state.generation > aliceGeneration)
        assert(ownerBob.status.state.generation > bobGeneration)
        const reconnectedAlice = ownerAlice.current()!.client
        const reconnectedBob = ownerBob.current()!.client
        assert.notEqual(reconnectedAlice, oldAlice, 'resource reconnect must replace its conversation consumer')
        assert.notEqual(reconnectedBob, oldBob)
        assert.equal(reconnectedAlice.channelMessages('shared-main').length, 17, 'reconnected history must have no duplicates')
        assert.equal(reconnectedBob.channelMessages('shared-main').length, 17)
        assert(!reconnectedBob.store.state.messages[secret.id], 'reconnect must preserve private ACL')
        assert.equal((await reconnectedAlice.postMessage(lost)).id, committedId, 'same session must recover its durable receipt')
        const afterReconnect = await reconnectedAlice.postMessage(post('after-reconnect', 'После восстановления сети', room.conversation.id, room.channel.id))
        await wait(() => !!reconnectedBob.store.state.messages[afterReconnect.id], 'reconnected clients did not resume live delivery')
        for (const owner of owners) await owner.close()
        owners.length = 0
        for (const client of clients) client.close()
        clients.length = 0
        await running.host.close()
        running = await start()
        const restoredAlice = await open('alice')
        const restoredBob = await open('bob')
        assert.equal((await restoredAlice.conversation.postMessage(lost)).id, committedId)
        assert.equal((await restoredAlice.conversation.createConversation(input)).conversation.id, room.conversation.id)
        assert.equal((await restoredAlice.conversation.createChannel(channelInput)).id, channel.id)
        assert.equal((await restoredAlice.remote.demo.reply(demoInput)).id, demo.id)
        assert.equal(restoredAlice.conversation.store.state.conversations.shared.updatedAt, beforeRestart)
        assert.equal(restoredBob.conversation.channelMessages('shared-main').length, 17)
        assert(!restoredBob.conversation.store.state.messages[secret.id])
        const revokedRemote = restoredBob.remote
        running.host.leader.line.control.store.state.accounts.bob.enabled = false
        await wait(() => restoredBob.resource.status.state.phase == 'denied', 'disabled account resource not revoked')
        await assert.rejects(revokedRemote.conversation.postMessage(post('first', 'Привет, Алиса!')))
        await assert.rejects(revokedRemote.conversation.state.keyframe())
        await assert.rejects(revokedRemote.conversation.events.keyframe())
        assert.equal(restoredBob.resource.current(), null)
        for (const mirror of mirrors) mirror.close()
        mirrors.length = 0
        for (const client of clients) client.close()
        clients.length = 0
        await running.host.close()
        running = await start(3)
        // Restore Bob only in the service store: the earlier revocation was persisted.
        running.host.leader.line.control.store.state.accounts.bob.enabled = true
        const cappedAlice = await open('alice')
        const cappedBob = await open('bob')
        const capacity = await Promise.allSettled([
            cappedAlice.conversation.createConversation({requestId: 'capacity-alice', title: 'Алиса'}),
            cappedBob.conversation.createConversation({requestId: 'capacity-bob', title: 'Боб'})
        ])
        assert.equal(capacity.filter(result => result.status == 'fulfilled').length, 1, 'concurrent commands must respect room capacity')
        const overLimit = capacity.find(result => result.status == 'rejected')
        assert(overLimit?.status == 'rejected')
        assert.match(String(overLimit.reason), /Предел этого экземпляра: 3 разговоров/)
        const capacityRecords = (await readFile(path.join(directory, 'limited-conversation', 'conversation.jsonl'), 'utf8')).trim().split('\n')
        assert.equal(capacityRecords.length, 1, 'only the accepted conversation is durably committed')
        console.log('PASS chat C01: real RPC two clients, automatic reconnect, native replay, durable retry/restart, changed input, demo, private ACL and teardown')
    } finally {
        for (const owner of owners) await owner.close()
        for (const mirror of mirrors) mirror.close()
        for (const client of clients) client.close()
        await running.host.close()
        const resolved = path.resolve(directory)
        if (!resolved.startsWith(fixtures + path.sep)) throw new Error('Unexpected fixture path')
        await rm(resolved, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
