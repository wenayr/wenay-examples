import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createSupportRuntime, type SupportDefinition} from './runtime'
import {searchWorkspace} from './domain'

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'support-history-'))
    const runtime = createSupportRuntime()
    runtime.definition.initial.organizations.harbor.members.agent = 'customer'
    const host = await createServiceLeaderHost({definition: runtime.definition, env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')},
        mount({leader}) {return runtime.mount(leader.line.control.store)}})
    const clients: ServiceClient<SupportDefinition>[] = [], resources: {close(): Promise<void>}[] = []
    async function connect(account: string) {
        const client = createServiceClient<SupportDefinition>({
            definition: describeService(runtime.definition),
            url: host.url,
            auth: {credentials: {account, password: account + '-pass'}}
        })
        clients.push(client)
        await client.ready()
        await client.views.workspace.ready
        const resource = client.resources.open('conversation')
        resources.push(resource)
        const deadline = Date.now() + 5000
        while (!resource.current()) {
            assert(Date.now() < deadline)
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        return {client, resource, history: resource.current()!.remote.control}
    }
    try {
        const customer = host.leader.corridor.fragment('customer'), staff = host.leader.corridor.fragment('agent')
        const created = await customer.ticketCreate('history-start', {
            orgId: 'northstar',
            subject: 'История',
            body: 'Самое первое сообщение о гарантии',
            priority: 'normal'
        })
        let revision = created.revision
        for (let index = 0; index < 46; index++) {
            const hidden = index % 3 == 0
            const body = hidden ? 'Секретная заметка ' + index : 'Открытый ответ ' + index
            const answer = await staff.ticketReply('history-' + index, {
                orgId: 'northstar',
                id: created.id,
                revision,
                body,
                private: hidden
            })
            revision = answer.revision
        }
        const agent = await connect('agent'), reader = await connect('customer'), outsider = await connect('outsider')
        const summary = agent.client.views.workspace.store.state.tickets.find(ticket => ticket.id == created.id)!
        assert.equal(summary.messages.length, 20)
        assert.equal(summary.messageCount, 47)
        assert.equal(summary.messages.some(message => message.body.includes('Самое первое')), false)
        const input = {orgId: 'northstar', ticketId: created.id, beforeId: summary.messages[0].id, query: '', limit: 20}
        const older = await agent.history.page(input)
        assert.equal(older.messages.length, 20)
        assert(older.nextBeforeId)
        const oldest = await agent.history.page({...input, beforeId: older.nextBeforeId})
        assert.equal(oldest.messages.length, 7)
        assert.equal(oldest.nextBeforeId, '')
        assert.equal(new Set([...oldest.messages, ...older.messages, ...summary.messages].map(message => message.id)).size, 47)
        await staff.ticketReply('append-during-pages', {orgId: 'northstar', id: created.id, revision, body: 'Новое сообщение', private: false})
        assert.deepEqual((await agent.history.page(input)).messages, older.messages, 'append does not shift cursor')
        const searched = await reader.history.page({...input, beforeId: '', query: 'гарантии'})
        assert.equal(searched.messages.length, 1)
        assert.equal((await reader.history.page({...input, beforeId: '', query: 'Секретная'})).total, 0)
        await assert.rejects(reader.history.page({...input, beforeId: older.messages.find(message => message.private)!.id}), /недоступна/)
        await assert.rejects(outsider.history.page(input), /доступа/)
        await assert.rejects(agent.history.page({...input, limit: 51}), /до 50/)
        assert.equal(searchWorkspace(host.leader.line.control.store.state, 'customer', 'northstar', 'гарантии').tickets.length, 1)
        await host.leader.corridor.fragment('owner').memberRole('revoke-history', {orgId: 'northstar', account: 'agent', role: 'revoked'})
        await assert.rejects(agent.history.page(input), /доступа|generation is closed/)
        const readyUntil = Date.now() + 5000
        while (!agent.resource.current() || agent.resource.current()!.remote.control == agent.history) {
            assert(Date.now() < readyUntil)
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        await assert.rejects(agent.resource.current()!.remote.control.page(input), /доступа/)
        console.log('PASS conversation history: bounded live tail, real resource cursor pages, concurrent append, old-message search, private and tenant isolation, retained connection ACL revoke')
    } finally {
        for (const resource of resources) await resource.close()
        for (const client of clients) client.close()
        await host.close()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('support-history-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
