import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import type {ConversationPostInput} from 'wenay-common2/conversation'
import {createChatService, type ChatDefinition} from './service'
import {createChatResource} from './chat-resource'
import {createConversationOwner} from '../frontend/conversation-owner'
import {mountChatLogin} from './public-login'

async function wait(check: () => boolean, message: string) {
    const deadline = Date.now() + 10000
    while (!check()) {
        assert(Date.now() < deadline, message)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

function post(requestId: string, personal = false): ConversationPostInput {
    return {requestId, conversationId: personal ? 'personal-alice' : 'shared',
        channelId: personal ? 'personal-alice-main' : 'shared-main', blocks: [{kind: 'text', version: 1, text: 'Scope ' + requestId}]}
}

async function main() {
    const fixtures = path.resolve('.test-data')
    await mkdir(fixtures, {recursive: true})
    const directory = await mkdtemp(path.join(fixtures, 'workspace-'))
    const cleanup: (() => void | Promise<void>)[] = []
    try {
        await checkWorkspaces(directory, cleanup)
    } finally {
        const errors = []
        for (const release of cleanup.reverse()) {
            try {await release()} catch (error) {errors.push(error)}
        }
        const resolved = path.resolve(directory)
        if (!resolved.startsWith(fixtures + path.sep)) throw new Error('Unexpected fixture path')
        await rm(resolved, {recursive: true, force: true})
        if (errors.length) throw new AggregateError(errors, 'Workspace fixture cleanup failed')
    }
}

async function checkWorkspaces(directory: string, cleanup: (() => void | Promise<void>)[]) {
    let allowed = true
    const direct = createChatResource({directory: path.join(directory, 'direct'), member: () => allowed})
    cleanup.push(direct.close)
    function directOpen(controller: AbortController) {
        return direct.resource.open({principal: {account: 'alice', roles: ['member']}, sessionId: 'direct',
            resourceId: 'direct', signal: controller.signal})
    }
    function denyReaders(remote: ReturnType<typeof directOpen>['facade']['conversation']) {
        assert.throws(() => remote.state.keyframe(), /закрыта/)
        assert.throws(() => remote.state.since(0), /закрыта/)
        if ('describe' in remote.state) {
            const describe = remote.state.describe
            assert.throws(() => describe(), /закрыта/)
        }
        assert.throws(() => remote.state.frame?.(0), /закрыта/)
        assert.throws(() => remote.state.chunks?.begin(), /закрыта/)
        assert.throws(() => remote.state.chunks?.pull('retained', 0), /закрыта/)
        assert.throws(() => remote.events.keyframe(), /закрыта/)
        assert.throws(() => remote.events.since(0), /закрыта/)
        assert.throws(() => remote.events.frame(0), /закрыта/)
        assert.throws(() => remote.events.line.on(function ignored() {}), /закрыта/)
    }
    const closedDirect = directOpen(new AbortController())
    closedDirect.facade.conversation.state.keyframe()
    closedDirect.close()
    denyReaders(closedDirect.facade.conversation)
    const revokedDirect = directOpen(new AbortController())
    allowed = false
    denyReaders(revokedDirect.facade.conversation)
    revokedDirect.close()
    allowed = true
    const abort = new AbortController()
    const abortedDirect = directOpen(abort)
    abort.abort()
    denyReaders(abortedDirect.facade.conversation)
    abortedDirect.close()
    direct.close()
    const clients: ServiceClient<ChatDefinition>[] = []
    const owners: ReturnType<typeof createConversationOwner>[] = []
    cleanup.push(async function releaseConsumers() {
        for (const owner of owners) await owner.close()
        for (const client of clients) client.close()
    })
    let port = '0'
    let secrets: {nodeToken: string, tokenSecret: string} | undefined
    function env() {
        return {SERVICE_HOST: '127.0.0.1', SERVICE_PORT: port, SERVICE_DATA_DIR: path.join(directory, 'service'),
            ...(secrets ? {SERVICE_NODE_TOKEN: secrets.nodeToken, SERVICE_TOKEN_SECRET: secrets.tokenSecret} : {})}
    }
    // Restore a real C01 archive and its original journal, including its private conversation and native receipt.
    const previous = createChatService({directory: path.join(directory, 'conversation')})
    cleanup.push(previous.close)
    const legacyChat = createChatResource({directory: path.join(directory, 'conversation'), member: () => true})
    cleanup.push(legacyChat.close)
    const legacyDefinition = {...previous.definition, version: 1, initial: {accounts: previous.definition.initial.accounts},
        access: {...previous.definition.access, rolesOf: () => ['member']}, commands: {}, views: {}, resources: {chat: legacyChat.resource}}
    const legacy = await createServiceLeaderHost({definition: legacyDefinition, env: env(), mount() {return legacyChat.close}})
    cleanup.push(legacy.close)
    port = new URL(legacy.url).port
    secrets = legacy.leader.secrets
    const legacyClient = createServiceClient({definition: describeService(legacyDefinition), url: legacy.url,
        auth: {credentials: {account: 'alice', password: 'alice-pass'}}})
    cleanup.push(legacyClient.close)
    const legacyResource = legacyClient.resources.open('chat')
    await wait(() => !!legacyResource.current(), 'legacy resource not ready')
    const legacyMessage = await legacyResource.current()!.remote.conversation.postMessage(post('legacy-receipt'))
    legacyClient.close()
    await legacy.close()
    previous.close()

    async function start() {
        const service = createChatService({directory: path.join(directory, 'conversation')})
        cleanup.push(service.close)
        const host = await createServiceLeaderHost({definition: service.definition, env: env(), rest: false,
            mount({app, leader}) {
                mountChatLogin({app, leader, definition: service.definition})
                return service.mount(leader.line.control.store)
            }})
        cleanup.push(host.close)
        return {service, host}
    }
    let running = await start()
    async function session(account: string) {
        const response = await fetch(running.host.url + '/api/chat/login', {method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({args: [{account, password: account + '-pass'}]})})
        assert(response.ok, 'native HTTP credential login')
        const login = await response.json() as {ok: boolean, value: {token: string}}
        assert(login.ok && login.value.token)
        const client = createServiceClient<ChatDefinition>({definition: describeService(running.service.definition), url: running.host.url,
            auth: {token: login.value.token}})
        clients.push(client)
        await client.ready()
        await client.views.workspaces.ready
        return client
    }
    async function own(client: ServiceClient<ChatDefinition>, resourceName: 'chat' | 'chatPersonal') {
        const owner = createConversationOwner({session: client, resourceName})
        owners.push(owner)
        await wait(() => owner.store.state.ready, 'workspace owner not ready: ' + resourceName)
        return owner
    }
    try {
        const alice = await session('alice')
        const aliceOther = await session('alice')
        const bob = await session('bob')
        const blockedRest = await fetch(running.host.url + '/api/chat/commands/teamMemberSet', {
            method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + alice.identity.token()},
            body: JSON.stringify({args: ['http-unavailable', {account: 'bob', role: 'owner'}]})
        })
        assert.equal(blockedRest.status, 404, 'HTTP command receipts must not bypass current role checks')
        assert.deepEqual(alice.views.workspaces.store.state.workspaces.map(item => item.id), ['team', 'personal'])
        assert.deepEqual(bob.views.workspaces.store.state.workspaces.map(item => item.id), ['team'])
        assert(!JSON.stringify(alice.views.workspaces.store.state).includes('secret'))
        const denied = bob.resources.open('chatPersonal')
        await wait(() => denied.status.state.phase == 'denied', 'Bob personal resource must be denied')
        const team = await own(alice, 'chat')
        const personal = await own(aliceOther, 'chatPersonal')
        const bobTeam = await own(bob, 'chat')
        const teamClient = team.current()!.client
        const personalClient = personal.current()!.client
        assert(teamClient.store.state.conversations['private-alice'], 'C01 private conversation remains in team')
        assert.equal((await teamClient.postMessage(post('legacy-receipt'))).id, legacyMessage.id)
        assert.deepEqual(personalClient.conversations().map(item => item.id), ['personal-alice'])
        const teamMessage = await teamClient.postMessage(post('same-workspace-receipt'))
        const personalMessage = await personalClient.postMessage(post('same-workspace-receipt', true))
        assert.notEqual(teamMessage.id, personalMessage.id)
        assert(!personalClient.store.state.messages[teamMessage.id])
        assert(!teamClient.store.state.messages[personalMessage.id])
        await assert.rejects(teamClient.postMessage(post('foreign-room', true)))
        await assert.rejects(personalClient.postMessage(post('foreign-room')))
        await assert.rejects(personalClient.createChannel({requestId: 'foreign-channel', conversationId: 'shared', title: 'Чужой канал'}))
        await assert.rejects(personal.current()!.remote.demo.reply({requestId: 'foreign-source', conversationId: 'personal-alice',
            channelId: 'personal-alice-main', sourceMessageId: teamMessage.id}))
        await assert.rejects(bob.commands.teamMemberSet('member-forbidden', {account: 'alice', role: 'member'}))
        await assert.rejects(alice.commands.teamMemberSet('last-owner', {account: 'alice', role: 'none'}))
        const retained = bobTeam.current()!.remote
        await bobTeam.current()!.client.postMessage(post('retained-receipt'))
        await alice.commands.teamMemberSet('revoke-bob', {account: 'bob', role: 'none'})
        await wait(() => bobTeam.status.state.phase == 'denied', 'membership revoke must close resource')
        assert.equal(bobTeam.current(), null)
        await assert.rejects(retained.conversation.state.keyframe())
        await assert.rejects(retained.conversation.events.keyframe())
        await assert.rejects(retained.conversation.postMessage(post('retained-receipt')))
        await wait(() => personal.store.state.ready, 'personal remains accessible after team revoke')
        await alice.commands.teamMemberSet('promote-bob', {account: 'bob', role: 'owner'})
        await wait(() => bobTeam.store.state.ready, 'new grant must reopen native generation')
        await wait(() => bob.identity.permissions.state.commands.includes('teamMemberSet'), 'new owner command permission')
        await bob.commands.teamMemberSet('demote-alice', {account: 'alice', role: 'member'})
        await assert.rejects(alice.commands.teamMemberSet('promote-bob', {account: 'bob', role: 'owner'}),
            'retained command receipt must require current exact owner role')
        await wait(() => personal.store.state.ready, 'Alice retains personal access after losing team owner')
        await assert.rejects(bob.commands.personalMemberSet('foreign-owner', {account: 'alice', role: 'member'}))
        await bob.commands.teamMemberSet('persist-revoke-alice', {account: 'alice', role: 'none'})
        await wait(() => team.status.state.phase == 'denied', 'team revoked independently')
        await wait(() => personal.store.state.ready, 'personal accessible with team revoked')
        for (const owner of owners) await owner.close()
        owners.length = 0
        for (const client of clients) client.close()
        clients.length = 0
        await running.host.close()
        running = await start()
        const restoredAlice = await session('alice')
        const restoredBob = await session('bob')
        assert.deepEqual(restoredAlice.views.workspaces.store.state.workspaces.map(item => item.id), ['personal'])
        assert.deepEqual(restoredBob.views.workspaces.store.state.workspaces.map(item => item.id), ['team'])
        const restoredPersonal = await own(restoredAlice, 'chatPersonal')
        assert.equal((await restoredPersonal.current()!.client.postMessage(post('same-workspace-receipt', true))).id, personalMessage.id)
        await restoredBob.commands.teamMemberSet('restore-alice', {account: 'alice', role: 'member'})
        const restoredTeam = await own(restoredAlice, 'chat')
        assert.equal((await restoredTeam.current()!.client.postMessage(post('same-workspace-receipt'))).id, teamMessage.id)
        assert.equal((await restoredTeam.current()!.client.postMessage(post('legacy-receipt'))).id, legacyMessage.id)
        console.log('PASS chat C03: native workspace isolation, migrated C01 archive, memberships, retained RPC, receipts and restart')
    } finally {
        for (const owner of owners) await owner.close()
        for (const client of clients) client.close()
        await running.host.close()
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
