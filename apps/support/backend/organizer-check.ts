import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createSupportRuntime} from './runtime'
import {taskBoards} from './organizer'

async function main() {
    const runtime = createSupportRuntime()
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const owner = leader.corridor.fragment('owner')
    const agent = leader.corridor.fragment('agent')
    const outsider = leader.corridor.fragment('outsider')
    const customer = leader.corridor.fragment('customer')
    const state = () => leader.line.control.store.snapshot()
    try {
        const input = {orgId: 'northstar', ticketId: 'ticket-welcome', revision: 1}
        const created = await agent.taskFromTicket('confirmed-task', input)
        assert.deepEqual(await agent.taskFromTicket('another-delivery', input), created)
        assert.deepEqual(await owner.taskFromTicket('another-actor', input), created)
        assert.equal(Object.keys(state().workspaces!.northstar.tasks).length, 1)
        await assert.rejects(customer.taskFromTicket('customer-task', input), /forbidden/)
        await assert.rejects(outsider.taskFromTicket('cross-tenant', input), /доступа/)
        assert.equal(taskBoards(state(), {account: 'outsider', roles: ['owner']}).boards.flatMap(item => item.tasks).length, 0)
        const edited = await owner.workSaveTask('edit-task', {
            orgId: 'northstar',
            id: created.id,
            revision: 1,
            title: 'Проверить доступ',
            description: 'Проверить приглашение',
            due: '2026-12-20',
            assignee: 'agent',
            priority: 'high',
            sourceId: 'ticket-welcome',
            checklist: [{title: 'Подтвердить результат', done: false}]
        })
        assert.equal(state().workspaces!.northstar.tasks[created.id].source?.kind, 'ticket')
        const unchecked = {
            orgId: 'northstar', id: created.id, revision: edited.revision,
            status: 'done' as const, beforeId: ''
        }
        await assert.rejects(agent.workMoveTask('not-checked', unchecked), /пункты/)
        const checked = await agent.workCheckTask('checked', {orgId: 'northstar', id: created.id, revision: edited.revision, index: 0, done: true})
        const races = await Promise.allSettled([
            agent.workMoveTask('done', {orgId: 'northstar', id: created.id, revision: checked.revision, status: 'done', beforeId: ''}),
            owner.workMoveTask('doing', {orgId: 'northstar', id: created.id, revision: checked.revision, status: 'doing', beforeId: ''})
        ])
        assert.equal(races.filter(item => item.status == 'fulfilled').length, 1)
        const revision = state().workspaces!.northstar.tasks[created.id].revision
        await assert.rejects(outsider.workMoveTask('other-scope-id', {orgId: 'harbor', id: created.id, revision, status: 'done', beforeId: ''}), /доступа/)
        await owner.memberRole('remove-agent', {orgId: 'northstar', account: 'agent', role: 'revoked'})
        const revoked = {orgId: 'northstar', id: created.id, revision, status: 'done' as const, beforeId: ''}
        await assert.rejects(agent.workMoveTask('after-revoke', revoked), /forbidden|доступа/)
        assert.equal(taskBoards(state(), {account: 'agent', roles: ['owner']}).boards.length, 0)
        assert.equal(taskBoards(state(), {account: 'customer', roles: ['owner']}).boards.length, 0)
        console.log('PASS support organizer: reused task commands, tenant scope, human confirmation dedup, checklist, revision race, cross-tenant denial and fresh revocation')
    } finally {leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
