import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createCrmRuntime} from './runtime'
import {crmWorkspace, crmRoles} from './domain'
import {taskBoards} from './organizer'

async function main() {
    let clock = Date.UTC(2026, 8, 10, 12)
    const runtime = createCrmRuntime({now: () => clock})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, execute: leader.corridor.system})
    const state = () => leader.line.control.store.snapshot()
    const context = (account: string) => ({
        principal: {account, roles: crmRoles(state(), account)},
        sessionId: account,
        resourceId: 'crm-test',
        signal: new AbortController().signal
    })
    const owner = leader.corridor.fragment('owner'), manager = leader.corridor.fragment('manager'), customer = leader.corridor.fragment('customer')
    const reader = runtime.definition.resources.crm.open(context('customer'))
    const staffReader = runtime.definition.resources.crm.open(context('manager'))
    const orgId = 'northstar', id = 'deal-aurora'
    const revision = () => state().deals[id].revision
    try {
        assert.equal(runtime.definition.access.login.resolve(state(), {account: 'owner', password: 'owner-pass'}), 'owner')
        assert.equal(runtime.definition.access.login.resolve(state(), {account: '__proto__', password: 'owner-pass'}), null)
        assert.equal(crmWorkspace(state(), context('customer').principal).deals.length, 1)
        assert.equal(crmWorkspace(state(), context('customer').principal).companies.length, 0)
        assert.equal(JSON.stringify(crmWorkspace(state(), context('manager').principal)).includes('secret'), false)
        assert.equal(reader.facade.control.detail({orgId, id}).deal.interactions.length, 1)
        assert.equal(reader.facade.control.detail({orgId, id}).contact!.email, '')
        assert.throws(() => reader.facade.control.detail({orgId, id: 'deal-expansion'}), /недоступна/)
        assert.throws(() => staffReader.facade.control.detail({orgId: 'harbor', id: 'deal-harbor'}), /доступа/)
        await assert.rejects(customer.interactionAdd('private-customer', {orgId, id, revision: revision(), body: 'Hidden', private: true}), /публичные/)
        await assert.rejects(manager.proposalSave('not-assigned', {
            orgId,
            id: 'deal-expansion',
            revision: 1,
            title: 'No',
            body: 'No',
            amount: 1
        }), /ответственный/)
        await assert.rejects(manager.memberRole('forged-role', {orgId, revision: 1, account: 'manager', role: 'owner'}), /forbidden/)
        await assert.rejects(owner.memberRole('last-owner', {orgId, revision: 1, account: 'owner', role: 'none'}), /последнего/)
        const beforeBatch = JSON.stringify(state().deals)
        await assert.rejects(owner.batchAssign('cross-org-batch', {
            orgId,
            assignee: 'lead',
            items: [{id, revision: revision()}, {id: 'deal-harbor', revision: 1}]
        }), /недоступна/)
        assert.equal(JSON.stringify(state().deals), beforeBatch, 'all batch ACLs before first write')
        await assert.rejects(owner.batchAssign('stale-batch', {
            orgId,
            assignee: 'lead',
            items: [{id, revision: revision()}, {id: 'deal-expansion', revision: 0}]
        }), /изменена/)
        assert.equal(JSON.stringify(state().deals), beforeBatch)
        await assert.rejects(owner.companySave('duplicate-domain', {orgId, id: '', revision: 0, name: 'Duplicate', domain: 'AURORA.EXAMPLE'}), /уже существует/)
        await assert.rejects(manager.contactSave('duplicate-email', {
            orgId,
            id: '',
            revision: 0,
            companyId: 'company-aurora',
            name: 'Duplicate',
            email: 'ILYA@AURORA.EXAMPLE',
            phone: ''
        }), /уже существует/)
        await assert.rejects(manager.contactSave('cross-company', {
            orgId,
            id: '',
            revision: 0,
            companyId: 'company-harbor',
            name: 'Bad',
            email: 'new@example.com',
            phone: ''
        }), /недоступна/)
        const company = await manager.companySave('new-company', {orgId, id: '', revision: 0, name: 'Birch Studio', domain: 'birch.example'})
        const contact = await manager.contactSave('new-contact', {
            orgId,
            id: '',
            revision: 0,
            companyId: company.id,
            name: 'Anna',
            email: 'anna@birch.example',
            phone: ''
        })
        const create = {
            orgId,
            id: '',
            revision: 0,
            title: '=Formula should be harmless',
            description: 'Public brief',
            companyId: company.id,
            contactId: contact.id,
            assignee: 'manager',
            customerAccount: '',
            amount: 10000
        }
        const newDeal = await manager.dealSave('new-deal', create)
        assert.deepEqual(await manager.dealSave('new-deal', create), newDeal, 'library request receipt prevents duplicate creation')
        assert.equal(Object.values(state().deals).filter(value => value.contactId == contact.id).length, 1)
        await assert.rejects(manager.dealSave('cross-links', {...create, contactId: 'contact-ilya'}), /другой компании/)
        await assert.rejects(owner.archiveRecord('linked-company', {
            orgId,
            kind: 'company',
            id: company.id,
            revision: 1,
            archived: true
        }), /Сначала архивируйте/)
        await manager.archiveRecord('archive-deal', {orgId, kind: 'deal', id: newDeal.id, revision: 1, archived: true})
        await owner.archiveRecord('archive-contact', {orgId, kind: 'contact', id: contact.id, revision: 1, archived: true})
        await owner.archiveRecord('archive-company', {orgId, kind: 'company', id: company.id, revision: 1, archived: true})
        await assert.rejects(manager.archiveRecord('restore-too-early', {orgId, kind: 'deal', id: newDeal.id, revision: 2, archived: false}), /архивирована/)
        await owner.archiveRecord('restore-company', {orgId, kind: 'company', id: company.id, revision: 2, archived: false})
        await owner.archiveRecord('restore-contact', {orgId, kind: 'contact', id: contact.id, revision: 2, archived: false})
        await manager.archiveRecord('restore-deal', {orgId, kind: 'deal', id: newDeal.id, revision: 2, archived: false})
        assert.equal(staffReader.facade.control.search({orgId, query: '', stage: 'all', offset: 0, limit: 1, archived: false}).items.length, 1)
        assert.equal(staffReader.facade.control.search({orgId, query: 'Formula', stage: 'all', offset: 0, limit: 10, archived: false}).total, 1)
        assert.throws(() => staffReader.facade.control.search({orgId, query: '', stage: 'all', offset: 0, limit: 101, archived: false}), /100 строк/)
        assert.match(staffReader.facade.control.export({orgId, format: 'csv'}).text, /'=Formula/)
        assert.equal(JSON.parse(reader.facade.control.export({orgId, format: 'json'}).text).length, 1)
        clock += 1000
        const racedRevision = revision()
        const races = await Promise.allSettled([
            manager.interactionAdd('race-one', {orgId, id, revision: racedRevision, body: 'First', private: true}),
            manager.interactionAdd('race-two', {orgId, id, revision: racedRevision, body: 'Second', private: true})
        ])
        assert.equal(races.filter(result => result.status == 'fulfilled').length, 1)
        await manager.dealMove('qualify', {orgId, id, revision: revision(), stage: 'qualified', beforeId: '', reason: ''})
        await assert.rejects(manager.dealMove('proposal-too-early', {
            orgId,
            id,
            revision: revision(),
            stage: 'proposal',
            beforeId: '',
            reason: ''
        }), /опубликуйте/)
        await manager.proposalSave('draft-first', {
            orgId,
            id,
            revision: revision(),
            title: 'Пилот сайта',
            body: 'Сделаем первую версию сайта за две недели.',
            amount: 150000
        })
        assert.equal(reader.facade.control.detail({orgId, id}).deal.draft, null)
        const first = await manager.proposalPublish('publish-first', {orgId, id, revision: revision()})
        const frozen = JSON.stringify(state().deals[id].proposals[0])
        await manager.dealMove('proposal-stage', {orgId, id, revision: revision(), stage: 'proposal', beforeId: '', reason: ''})
        await assert.rejects(manager.dealMove('won-too-early', {orgId, id, revision: revision(), stage: 'won', beforeId: '', reason: ''}), /принять/)
        await customer.proposalRespond('changes-first', {
            orgId,
            id,
            revision: revision(),
            version: first.version,
            decision: 'changes',
            body: 'Добавьте страницу команды.'
        })
        await manager.proposalSave('draft-second', {
            orgId,
            id,
            revision: revision(),
            title: 'Сайт и команда',
            body: 'Сайт и страница команды, две недели.',
            amount: 170000
        })
        const second = await manager.proposalPublish('publish-second', {orgId, id, revision: revision()})
        assert.equal(JSON.stringify(state().deals[id].proposals[0]), frozen, 'published content never changes')
        await assert.rejects(customer.proposalRespond('old-version', {
            orgId,
            id,
            revision: revision(),
            version: first.version,
            decision: 'accept',
            body: ''
        }), /новой версией/)
        await assert.rejects(customer.proposalRespond('stale-revision', {
            orgId,
            id,
            revision: revision() - 1,
            version: second.version,
            decision: 'accept',
            body: ''
        }), /изменена/)
        const approval = {orgId, id, revision: revision(), version: second.version, decision: 'accept' as const, body: ''}
        const accepted = await customer.proposalRespond('accept-second', approval)
        assert.deepEqual(await customer.proposalRespond('accept-second', approval), accepted)
        assert.equal(Object.keys(state().workspaces!.northstar.tasks).length, 1)
        await assert.rejects(customer.proposalRespond('duplicate-intent', {...approval, revision: revision()}), /уже зафиксирован/)
        const task = await manager.taskFromDeal('same-derived-task', {orgId, id, revision: revision()})
        assert.equal(Object.keys(state().workspaces!.northstar.tasks).length, 1)
        assert.equal(taskBoards(state(), context('manager').principal).boards[0].tasks[0].source?.kind, 'deal')
        await assert.rejects(customer.workMoveTask('customer-task', {orgId, id: task.id, revision: 1, status: 'done', beforeId: ''}), /forbidden/)
        await assert.rejects(manager.workMoveTask('unchecked-task', {orgId, id: task.id, revision: 1, status: 'done', beforeId: ''}), /пункты/)
        await manager.workCheckTask('check-1', {orgId, id: task.id, revision: 1, index: 0, done: true})
        await manager.workCheckTask('check-2', {orgId, id: task.id, revision: 2, index: 1, done: true})
        await manager.workMoveTask('task-done', {orgId, id: task.id, revision: 3, status: 'done', beforeId: ''})
        await manager.dealMove('won', {orgId, id, revision: revision(), stage: 'won', beforeId: '', reason: ''})
        assert.equal(state().deals[id].stage, 'won')
        await assert.rejects(manager.dealMove('reopen-manager', {
            orgId,
            id,
            revision: revision(),
            stage: 'qualified',
            beforeId: '',
            reason: 'Next phase'
        }), /руководитель/)
        await owner.dealMove('reopen-owner', {orgId, id, revision: revision(), stage: 'qualified', beforeId: '', reason: 'Следующая фаза'})
        await owner.batchAssign('assign-lead', {orgId, items: [{id, revision: revision()}], assignee: 'lead'})
        await assert.rejects(manager.interactionAdd('old-assignee', {orgId, id, revision: revision(), body: 'Cannot edit', private: true}), /ответственный/)
        const orgRevision = state().organizations.northstar.revision
        await owner.memberRole('revoke-customer', {orgId, revision: orgRevision, account: 'customer', role: 'none'})
        assert.throws(() => reader.facade.control.detail({orgId, id}), /доступа/)
        assert.throws(() => reader.facade.control.export({orgId, format: 'json'}), /доступа/)
        assert.equal(crmWorkspace(state(), context('customer').principal).deals.length, 0)
        const saved = state()
        const restored = createServiceLeader({definition: {...runtime.definition, initial: saved}, selfUrl: () => 'http://localhost'})
        try {
            assert.equal(restored.line.control.store.snapshot().deals[id].proposals.length, 2)
            assert.equal(Object.keys(restored.line.control.store.snapshot().workspaces!.northstar.tasks).length, 1)
        } finally {restored.control.close()}
        console.log('PASS CRM: roles/tenant/customer projections, unique contacts/company links, atomic batch and revision races, archive/restore referential integrity, bounded search/export, immutable proposals/stale approval, scoped organizer task dedup/checklist, member revocation and restored history')
    } finally {reader.close()
    staffReader.close()
    await close()
    leader.control.close()}
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
