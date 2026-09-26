import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'

// Resolve published public exports from the caller's apps/chat installation.
const requireApp = createRequire(path.join(process.cwd(), 'package.json'))
const {createConversationHost, createConversationClient} = requireApp('wenay-common2/conversation')
const {createServiceClient, describeService} = requireApp('wenay-common2/service/client')
const {createServiceLeaderHost} = requireApp('wenay-common2/service/host')

async function waitFor(check: () => boolean) {
    const until = Date.now() + 3000
    while (!check()) {
        assert(Date.now() < until, 'Conversation resource lifecycle timeout')
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}

// Run independently: the library's queued timer throw must remain observable.
async function main() {
    const conversations = createConversationHost({})
    const definition = {
        name: 'conversation-resource-lifecycle', storeId: 'lifecycle', originId: 'authority',
        initial: {member: true}, commands: {},
        access: {rolesOf: (state: {member: boolean}) => state.member ? ['member'] : []},
        resources: {chat: {allow: ['member'], placement: 'authority', open(ctx: {principal: {account: string}}) {
            const connection = conversations.connection(ctx.principal.account)
            return {facade: {conversation: connection.fragment}, close: connection.close}
        }}},
    }
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1'}, rest: false})
    const session = createServiceClient({definition: describeService(definition), url: host.url,
        auth: {token: host.leader.identity.login('alice').token}})
    const resource = session.resources.open('chat')
    let client: ReturnType<typeof createConversationClient> | undefined
    try {
        await waitFor(() => resource.status.state.phase == 'ready')
        client = createConversationClient({remote: resource.current()!.remote.conversation})
        await client.ready
        const created = await client.createConversation({requestId: 'create', title: 'Lifecycle fixture'})
        const message = await client.postMessage({requestId: 'post', conversationId: created.conversation.id,
            channelId: created.channel.id, blocks: [{kind: 'text', version: 1, text: 'Before resource termination'}]})
        await waitFor(() => !!client!.store.state.messages[message.id])
        console.log('Native client ready and live replay received a message')
        if (process.argv.includes('--dispose-before-end')) {
            client.close()
            console.log('Control: native consumer disposed before resource termination')
        }
        if (process.argv.includes('--revoke')) {
            console.log('Revoking membership')
            host.leader.line.control.store.state.member = false
            await waitFor(() => resource.status.state.phase == 'denied')
        } else {
            console.log('Closing the resource')
            await resource.close()
        }
    } finally {
        client?.close()
        await resource.close()
        session.close()
        await host.close()
        conversations.close()
        console.log('FINALLY: native client, resource, session and both hosts closed')
    }
    // A late replay error cannot reject the already fulfilled ready promise or this catch.
    await new Promise(resolve => setTimeout(resolve, 50))
    console.log('PASS resource termination without an uncaught replay error')
}

void main().catch(function failed(error) {
    console.error('main catch:', error)
    process.exitCode = 1
})
