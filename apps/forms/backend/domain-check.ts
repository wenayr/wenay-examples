import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createFormsService} from './service'
import {formsWorkspace, hash, validateFields} from './domain'
import type {Field} from './model'

async function main() {
    let clock = Date.UTC(2026, 8, 10)
    const definition = createFormsService({now: () => clock}).definition
    const leader = createServiceLeader({definition, selfUrl: () => 'http://localhost'})
    const owner = leader.corridor.fragment('owner'), author = leader.corridor.fragment('author'), analyst = leader.corridor.fragment('analyst')
    const state = () => leader.line.control.store.snapshot()
    const id = 'form-feedback', orgId = 'northstar'
    const form = () => state().forms[id]
    const fields = form().fields.map(field => ({...field, choices: [...field.choices]}))
    const save = () => ({orgId, id, revision: form().revision, title: form().title, description: form().description, fields, retentionDays: 1})
    try {
        await assert.rejects(analyst.formSave('analyst-edit', save()), /forbidden/)
        await assert.rejects(author.formSave('other-org', {...save(), orgId: 'harbor', id: 'form-harbor'}), /доступа/)
        await assert.rejects(owner.formPublish('forged-publish', {orgId, id, revision: 1, actor: 'owner', tokenHash: 'a'.repeat(64), publication: 'b'.repeat(64)}), /forbidden/)
        assert.throws(() => validateFields([{...fields[0], id: 'constructor'}]), /безопасными/)
        const bool: Field = {id: 'a', label: 'A', kind: 'boolean', required: true, choices: [], min: 0, max: 0, whenField: 'b', whenEquals: 'true'}
        assert.throws(() => validateFields([bool, {...bool, id: 'b', whenField: 'a'}]), /цикл/)
        assert.throws(() => validateFields([{...bool, whenField: 'missing'}]), /Условие/)
        await author.formSave('retention-day', save())
        const token = 'x'.repeat(43)
        await leader.corridor.system.formPublish('publish', {orgId, id, revision: form().revision, actor: 'author', tokenHash: hash(token), publication: 'a'.repeat(64)})
        const account = definition.access.login.resolve(state(), {account: 'respondent', password: token})!
        assert.equal(account, 'form:form-feedback:1')
        assert.equal(JSON.stringify(state()).includes(token), false)
        assert.equal(definition.access.login.resolve(state(), {account: 'respondent', password: 'wrong'}), null)
        const respondent = leader.corridor.fragment(account)
        assert.throws(() => leader.access.snapshot('workspace', {account, roles: ['respondent']}), /forbidden/)
        const submit = (nonce: string, answers: unknown, version = 1) => ({formId: id, version, nonce, answersJson: JSON.stringify(answers)})
        await assert.rejects(respondent.answerSubmit('required', submit('missing-0001', {rating: 3, recommend: false})), /required/)
        await assert.rejects(respondent.answerSubmit('hidden', submit('hidden-00001', {rating: 3, recommend: true, details: 'Hidden answer'})), /known field/)
        await assert.rejects(respondent.answerSubmit('extra', submit('extra-000001', {rating: 3, recommend: true, secret: 'No'})), /known field/)
        await assert.rejects(respondent.answerSubmit('wrong-type', submit('wrong-000001', {rating: '3', recommend: true})), /number/)
        await assert.rejects(respondent.answerSubmit('range', submit('range-000001', {rating: 9, recommend: true})), /диапазона/)
        const request = submit('response-001', {rating: 4, recommend: false, details: 'Улучшите поиск'})
        const first = await respondent.answerSubmit('submit-first', request)
        assert.equal(first.duplicate, false)
        assert.deepEqual(await respondent.answerSubmit('submit-first', request), first)
        assert.equal((await respondent.answerSubmit('semantic-duplicate', request)).duplicate, true)
        await assert.rejects(respondent.answerSubmit('nonce-conflict', submit('response-001', {rating: 2, recommend: true})), /другого ответа/)
        const second = await respondent.answerSubmit('submit-second', submit('response-002', {rating: 2, recommend: true}))
        let aggregate = state().aggregates[id + ':1']
        assert.equal(aggregate.count, 2)
        assert.equal(aggregate.fields.rating.sum, 6)
        assert.equal(aggregate.fields.details.answered, 1)
        const workspace = formsWorkspace(state(), {account: 'analyst', roles: ['analyst']})
        assert.equal(workspace.aggregates[0].fields.find(field => field.id == 'rating')!.average, 3)
        assert.equal(JSON.stringify(workspace).includes('Улучшите поиск'), false)
        assert.equal(JSON.stringify(workspace).includes('tokenHash'), false)
        assert.equal(formsWorkspace(state(), {account: 'outsider', roles: ['owner']}).aggregates.length, 0)
        await owner.answerCorrect('correct', {orgId, formId: id, id: first.id, answersRevision: form().answersRevision, answersJson: JSON.stringify({rating: 5, recommend: true})})
        aggregate = state().aggregates[id + ':1']
        assert.equal(aggregate.count, 2)
        assert.equal(aggregate.fields.rating.sum, 7)
        assert.equal(aggregate.fields.details.answered, 0)
        await owner.answerDelete('delete', {orgId, formId: id, id: second.id})
        assert.equal(state().aggregates[id + ':1'].fields.rating.sum, 5)
        assert.equal((await respondent.answerSubmit('after-delete', submit('response-002', {rating: 2, recommend: true}))).deleted, true)
        assert.equal(state().submissions[second.id], undefined)
        assert.equal(state().receipts[second.id].signature, '')
        const frozen = JSON.stringify(form().versions[0])
        await author.formSave('draft-changes', {...save(), title: 'Новое название', fields: fields.map(field => field.id == 'rating' ? {...field, max: 10} : field)})
        assert.equal(JSON.stringify(form().versions[0]), frozen)
        await assert.rejects(respondent.answerSubmit('old-public-range', submit('response-003', {rating: 9, recommend: true})), /диапазона/)
        await leader.corridor.system.formPublish('publish-second', {orgId, id, revision: form().revision, actor: 'author', tokenHash: hash('y'.repeat(43)), publication: 'b'.repeat(64)})
        assert.equal(definition.access.login.resolve(state(), {account: 'respondent', password: token}), null)
        await assert.rejects(respondent.answerSubmit('old-session', request), /forbidden/)
        const newAccount = definition.access.login.resolve(state(), {account: 'respondent', password: 'y'.repeat(43)})!
        const newer = leader.corridor.fragment(newAccount)
        await assert.rejects(newer.answerSubmit('stale-version', submit('response-004', {rating: 9, recommend: true}, 1)), /изменилась/)
        await newer.answerSubmit('new-version', submit('response-005', {rating: 9, recommend: true}, 2))
        assert.equal(state().aggregates[id + ':1'].count, 1)
        assert.equal(state().aggregates[id + ':2'].count, 1)
        clock += 86400001
        const swept = await leader.corridor.system.retentionSweep('expired', {})
        assert.equal(swept.deleted, 2)
        assert.equal(Object.keys(state().submissions).length, 0)
        assert.equal(state().aggregates[id + ':1'].count, 0)
        assert.equal(state().aggregates[id + ':2'].fields.rating.sum, 0)
        assert.equal(JSON.stringify(state()).includes('Улучшите поиск'), false)
        await owner.formDisable('unpublish', {orgId, id, revision: form().revision})
        await assert.rejects(newer.answerSubmit('disabled-session', submit('response-006', {rating: 9, recommend: true}, 2)), /forbidden/)
        await leader.corridor.system.formPublish('republish', {orgId, id, revision: form().revision, actor: 'author', tokenHash: hash('z'.repeat(43)), publication: 'c'.repeat(64)})
        await assert.rejects(newer.answerSubmit('old-session-after-republish', submit('response-007', {rating: 9, recommend: true}, 3)), /forbidden/)
        await assert.rejects(owner.memberRole('remove-last-owner', {orgId, revision: 1, account: 'owner', role: 'none'}), /последнего/)
        const restored = createServiceLeader({definition: {...definition, initial: state()}, selfUrl: () => 'http://localhost'})
        try {assert.equal(restored.line.control.store.snapshot().forms[id].versions.length, 3); assert.equal(Object.keys(restored.line.control.store.snapshot().receipts).length, 3)} finally {restored.control.close()}
        console.log('PASS forms domain: schema/DAG, dynamic library validation, hidden/unknown/required fields, immutable versions, hash-only public tokens, generation/session revocation, nonce idempotency/conflict, incremental aggregates/correction/delete, retention and restored tombstones')
    } finally {leader.control.close()}
}

main().catch(function failed(error) {console.error(error); process.exitCode = 1})
