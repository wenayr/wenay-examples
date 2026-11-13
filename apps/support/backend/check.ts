import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createAiRunClient} from 'wenay-common2/ai'
import {createSupportRuntime, type SupportDefinition} from './runtime'
import {createProcess} from './process-resource'

async function waitFor(label: string, check: () => boolean, timeout = 18000) {
    const until = Date.now() + timeout
    while (!check()) {
        assert(Date.now() < until, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 30))
    }
}
async function main() {
    const started = Date.now()
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'support-check-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env})
    const nodes: ReturnType<typeof createProcess>[] = []
    let url = await host.ready
    const definition = createSupportRuntime().definition
    const sessions: ServiceClient<SupportDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []
    const aiClients: ReturnType<typeof createAiRunClient>[] = []
    async function client(account: string) {
        const response = await fetch(url + '/api/support/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({args: [{account, password: account + '-pass'}]})
        })
        const answer = await response.json()
        assert(answer.ok, JSON.stringify(answer))
        const session = createServiceClient<SupportDefinition>({
            definition: describeService(definition),
            url,
            auth: {token: answer.value.token},
            placement: {rng: () => 0}
        })
        sessions.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    try {
        for (const id of ['support-a', 'support-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_NODE_ID: id, SERVICE_UPSTREAM: url}})
            nodes.push(node)
            await node.ready
        }
        const owner = await client('owner')
        const agent = await client('agent')
        const customer = await client('customer')
        const outsider = await client('outsider')
        assert.equal(customer.views.workspace.store.state.tickets.length, 1)
        assert(!customer.views.workspace.store.state.tickets[0].messages.some(item => item.private))
        assert(!JSON.stringify(owner.views.workspace.store.state).includes('Harbor onboarding'))
        const input = {orgId: 'northstar', subject: 'Пригласить коллегу', body: 'Как пригласить коллегу в проект?', priority: 'normal' as const}
        const created = await customer.commands.ticketCreate('new-ticket', input)
        const linked = await agent.commands.taskFromTicket('confirm-linked-task', {orgId: 'northstar', ticketId: created.id, revision: created.revision})
        const again = await owner.commands.taskFromTicket('same-ticket-another-request', {
            orgId: 'northstar',
            ticketId: created.id,
            revision: created.revision
        })
        assert.equal(again.id, linked.id)
        await owner.views.taskBoards.ready
        await waitFor('linked task replicated', () => owner.views.taskBoards.store.state.boards.some(board => board.tasks.some(task => task.id == linked.id)))
        await assert.rejects(customer.commands.taskFromTicket('customer-no-tasks', {orgId: 'northstar', ticketId: created.id, revision: created.revision}))
        assert.equal((await customer.commands.ticketCreate('new-ticket', input)).id, created.id)
        await waitFor('new ticket on second live session', () => agent.views.workspace.store.state.tickets.some(item => item.id == created.id))
        await assert.rejects(outsider.commands.ticketReply('cross-org', {
            orgId: 'northstar',
            id: created.id,
            revision: created.revision,
            body: 'forbidden',
            private: false
        }))
        const races = await Promise.allSettled([
            owner.commands.ticketAssign('assign-owner', {orgId: 'northstar', id: created.id, revision: created.revision, assignee: 'owner'}),
            agent.commands.ticketAssign('assign-agent', {orgId: 'northstar', id: created.id, revision: created.revision, assignee: 'agent'})
        ])
        assert.equal(races.filter(item => item.status == 'fulfilled').length, 1)
        const revision = (races.find(item => item.status == 'fulfilled') as PromiseFulfilledResult<{revision: number}>).value.revision
        const resource = agent.resources.open('assistant')
        resources.push(resource)
        await waitFor('AI resource through serving node', () => resource.status.state.phase == 'ready')
        const remote = resource.current()!.remote
        const ai = createAiRunClient({remote: remote.ai})
        aiClients.push(ai)
        await ai.ready
        const run = await ai.createRun({
            requestId: 'answer-1',
            kind: 'answer',
            resourceIds: [created.id],
            input: {orgId: 'northstar', ticketId: created.id, revision}
        })
        await waitFor('draft completed', () => ['completed', 'failed'].includes(ai.store.state.runs[run.id]?.state))
        assert.equal(ai.store.state.runs[run.id].state, 'completed', ai.store.state.runs[run.id].error ?? 'draft should complete')
        const draft = await remote.control.result(run.id)
        assert(draft.sources.length)
        assert(draft.demo)
        assert.deepEqual(ai.store.state.runs[run.id].result, {available: true, demo: true})
        assert(!JSON.stringify(await remote.ai.state.keyframe()).includes(draft.text), 'AI replay carries no private result text')
        ai.close()
        await owner.commands.memberRole('revoke-agent', {orgId: 'northstar', account: 'agent', role: 'revoked'})
        await waitFor('revoked tenant removed live', () => agent.views.workspace.store.state.organizations.length == 0)
        await assert.rejects(remote.control.result(run.id), /доступа|generation is closed/)
        await assert.rejects(remote.control.sources('northstar', 'пригласить'))
        const invitation = await owner.commands.inviteCreate('reinvite-agent', {orgId: 'northstar', role: 'agent', hours: 1})
        await agent.commands.inviteAccept('accept-restoration', {token: invitation.token})
        await waitFor('membership restored without reload', () => agent.views.workspace.store.state.organizations.length == 1)
        await waitFor('resource generation restored', () => resource.status.state.phase == 'ready')
        const restoredRemote = resource.current()!.remote
        assert.equal((await restoredRemote.control.result(run.id)).text, draft.text)
        const source = draft.sources[0]
        await owner.commands.articlePublish('archive-source', {orgId: 'northstar', id: source.id, revision: source.revision, status: 'archived'})
        await assert.rejects(restoredRemote.control.result(run.id), /Источник/)
        await owner.commands.articlePublish('republish-source', {orgId: 'northstar', id: source.id, revision: source.revision + 1, status: 'published'})
        await assert.rejects(restoredRemote.control.result(run.id), /Источник/, 'old revision remains invalid after republish')
        const freshAi = createAiRunClient({remote: restoredRemote.ai})
        aiClients.push(freshAi)
        await freshAi.ready
        const secondRun = await freshAi.createRun({
            requestId: 'answer-2',
            kind: 'answer',
            resourceIds: [created.id],
            input: {orgId: 'northstar', ticketId: created.id, revision}
        })
        await waitFor('fresh result', () => freshAi.store.state.runs[secondRun.id]?.state == 'completed')
        freshAi.close()
        const endpoint = customer.view.endpoint()
        assert(endpoint && endpoint.nodeId != 'leader', 'serving node actually handles a client')
        const stable = customer.views.workspace.store
        const selected = endpoint.nodeId == 'support-a' ? nodes[0] : nodes[1]
        await selected.control.stop(true)
        await waitFor('reader moves after serving process dies', () => customer.view.endpoint()?.nodeId != endpoint.nodeId && !!customer.view.endpoint())
        const reply = await customer.commands.ticketReply('after-node-loss', {
            orgId: 'northstar',
            id: created.id,
            revision,
            body: 'Спасибо, жду ответ',
            private: false
        })
        await waitFor('reply visible after node loss', function delivered() {
            const tickets = customer.views.workspace.store.state.tickets
            return tickets.find(item => item.id == created.id)?.revision == reply.revision
        })
        assert.equal(customer.views.workspace.store, stable)
        await waitFor('AI resource after node change', () => resource.status.state.phase == 'ready')
        await assert.rejects(resource.current()!.remote.control.result(secondRun.id), /Обращение изменилось/)
        for (const ai of aiClients) ai.close()
        for (const resource of resources) await resource.close()
        for (const session of sessions) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restored = await client('customer')
        assert.equal(restored.views.workspace.store.state.tickets.find(item => item.id == created.id)?.revision, reply.revision)
        assert.equal((await restored.commands.ticketCreate('new-ticket', input)).id, created.id, 'receipt survives restart')
        const restoredOwner = await client('owner')
        await restoredOwner.views.taskBoards.ready
        const boards = restoredOwner.views.taskBoards.store.state.boards
        const kept = boards.some(board => board.tasks.some(task => task.id == linked.id))
        assert(kept, 'linked organizer task survives restart')
        console.log('PASS support: real authority + 2 serving processes, tenant/private-note isolation, command receipts, revision race, live revocation, private AI source guards, node loss and durable restart (' + (Date.now() - started) + ' ms)')
    } finally {
        for (const ai of aiClients) ai.close()
        for (const resource of resources) await resource.close().catch(() => {})
        for (const session of sessions) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('support-check-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
