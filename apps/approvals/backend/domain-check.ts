import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createApprovalService} from './service'
import {approvalWorkspace} from './domain'
import type {ApprovalState} from './model'

// Проверка предметных правил на настоящем service leader: команды идут через
// корридор с ролями, состояние читается из его же store.
async function main() {
    let clock = Date.UTC(2026, 8, 11)
    const definition = createApprovalService({now: () => clock}).definition
    const leader = createServiceLeader({definition, selfUrl: () => 'http://localhost'})
    const owner = leader.corridor.fragment('owner')
    const reviewer = leader.corridor.fragment('reviewer')
    const author = leader.corridor.fragment('requester')
    const colleague = leader.corridor.fragment('requester2')
    const outsider = leader.corridor.fragment('outsider')
    const state = () => leader.line.control.store.snapshot() as ApprovalState
    const orgId = 'northstar'
    const answers = {purpose: 'Нужен второй монитор для вёрстки', amount: 24000, urgent: false}
    const draft = (key: string, id = '', revision = 0, title = 'Второй монитор') => ({
        orgId, id, revision, key, title, answersJson: JSON.stringify(answers)
    })
    try {
        // Роли. Чужая организация и посторонний аккаунт не видят заявок Northstar.
        await assert.rejects(outsider.requestSave('outsider-save', draft('outsider-save-key')), /доступа/)

        // Черновик. Ключ намерения делает повтор безопасным.
        const created = await author.requestSave('save-monitor', draft('save-monitor-key'))
        assert.equal(created.status, 'draft')
        assert.equal(created.version, 0)
        const repeated = await author.requestSave('save-monitor-again', draft('save-monitor-key'))
        assert.deepEqual(repeated, created, 'повтор того же ключа возвращает прежний результат')
        const other = {...draft('save-monitor-key', created.id, created.revision), title: 'Другое название'}
        await assert.rejects(author.requestSave('save-conflict', other), /Ключ уже использован/)

        // Устаревшая ревизия отклоняется до применения изменения.
        const stale = {...draft('stale-revision-key', created.id, created.revision + 5), title: 'Правка'}
        await assert.rejects(author.requestSave('save-stale', stale), /Заявка изменилась/)

        // Обязательное поле и условный вопрос проверяются публичной схемой common2.
        const incomplete = {...draft('incomplete-key'), answersJson: JSON.stringify({amount: 10})}
        await assert.rejects(author.requestSave('save-incomplete', incomplete), /purpose|Ожидается|обязат/i)
        const conditional = {purpose: 'Сервер упал', amount: 5000, urgent: true}
        const withoutReason = {...draft('conditional-key'), answersJson: JSON.stringify(conditional)}
        await assert.rejects(author.requestSave('save-no-reason', withoutReason), /reason|Ожидается|обязат/i)
        const hiddenAnswer = {...answers, reason: 'Скрытое поле не принимается'}
        const hidden = {...draft('hidden-key'), answersJson: JSON.stringify(hiddenAnswer)}
        await assert.rejects(author.requestSave('save-hidden', hidden), /reason|Неизвестн|unknown/i)

        // Отправка фиксирует неизменяемую версию вместе со снимком полей.
        const current = () => state().requests[created.id]
        const submitted = await author.requestSubmit('submit-one', {orgId, id: created.id, revision: current().revision, key: 'submit-one-key'})
        assert.equal(submitted.status, 'pending')
        assert.equal(submitted.version, 1)
        const snapshot = current().versions[0]
        assert.equal(snapshot.fields.length, state().fields.length)
        assert.deepEqual(snapshot.answers, answers)

        assert.equal(snapshot.title, 'Второй монитор')

        // Решение. Автор и обычный сотрудник решать не могут, возврат требует объяснения.
        const pending = () => ({orgId, id: created.id, revision: current().revision, version: 1})
        const peerDecision = {...pending(), key: 'peer-decide-key', decision: 'approved' as const, body: ''}
        await assert.rejects(colleague.requestDecide('peer-decide', peerDecision), /forbidden|Решение доступно/)
        const ownDecision = {...pending(), key: 'self-decide-key', decision: 'approved' as const, body: ''}
        await assert.rejects(author.requestDecide('self-decide', ownDecision), /forbidden|Решение доступно|Свою заявку/)
        const silent = {...pending(), key: 'silent-changes-key', decision: 'changes' as const, body: '   '}
        await assert.rejects(reviewer.requestDecide('silent-changes', silent), /Объясните/)

        const returned = await reviewer.requestDecide('ask-changes', {...pending(), key: 'ask-changes-key', decision: 'changes', body: 'Приложите счёт'})
        assert.equal(returned.status, 'changes')
        const late = {...pending(), key: 'second-decide-key', decision: 'approved' as const, body: ''}
        await assert.rejects(reviewer.requestDecide('second-decide', late), /уже не ожидает/)

        // Вторая версия после возврата: история хранит обе.
        clock += 60000
        await author.requestSave('fix-after-changes', {...draft('fix-after-changes-key', created.id, current().revision), title: 'Второй монитор, со счётом'})
        const second = await author.requestSubmit('submit-two', {orgId, id: created.id, revision: current().revision, key: 'submit-two-key'})
        assert.equal(second.version, 2)
        assert.equal(current().versions.length, 2)
        assert.deepEqual(current().history.map(entry => entry.kind), ['submitted', 'changes', 'submitted'])

        const verdict = {orgId, id: created.id, revision: current().revision, version: 2, key: 'approve-key'}
        const approved = await reviewer.requestDecide('approve', {...verdict, decision: 'approved', body: 'Согласовано'})
        assert.equal(approved.status, 'approved')
        await assert.rejects(author.requestSave('edit-approved', draft('edit-approved-key', created.id, current().revision)), /Можно менять только свою/)

        // Отзыв возможен только для своей ожидающей заявки.
        const withdrawable = await colleague.requestSave('colleague-save', {...draft('colleague-save-key'), title: 'Клавиатура'})
        const held = () => state().requests[withdrawable.id].revision
        await colleague.requestSubmit('colleague-submit', {orgId, id: withdrawable.id, revision: held(), key: 'colleague-submit-key'})
        const foreign = {orgId, id: withdrawable.id, revision: held(), key: 'foreign-withdraw-key'}
        await assert.rejects(author.requestWithdraw('foreign-withdraw', foreign), /только свою/)
        const withdrawn = await colleague.requestWithdraw('own-withdraw', {...foreign, key: 'own-withdraw-key'})
        assert.equal(withdrawn.status, 'withdrawn')

        // Представление. Сотрудник видит свои заявки, проверяющий — все отправленные.
        const forAuthor = approvalWorkspace(state(), {account: 'requester', roles: ['requester']})
        assert.deepEqual(forAuthor.requests.map(row => row.id), [created.id])
        const forReviewer = approvalWorkspace(state(), {account: 'reviewer', roles: ['reviewer']})
        assert.equal(forReviewer.requests.length, 2, 'проверяющий видит обе отправленные заявки')
        const forOutsider = approvalWorkspace(state(), {account: 'outsider', roles: ['owner']})
        assert.equal(forOutsider.requests.length, 0, 'другая организация не видит чужих заявок')
        assert.equal(forOutsider.organizations[0].id, 'harbor')
        assert.equal(forAuthor.people.length, 0, 'состав команды виден только владельцу')
        assert.equal(approvalWorkspace(state(), {account: 'owner', roles: ['owner']}).people.length, 4)

        // Состав команды. Последнего владельца снять нельзя.
        const org = () => state().organizations[orgId]
        const demotion = {orgId, revision: org().revision, account: 'owner', role: 'requester' as const}
        await assert.rejects(owner.memberRole('demote-last-owner', demotion), /хотя бы один владелец/)
        await assert.rejects(reviewer.memberRole('reviewer-removes', {orgId, revision: org().revision, account: 'requester2', role: 'none'}), /forbidden/)
        await owner.memberRole('promote-colleague', {orgId, revision: org().revision, account: 'requester2', role: 'reviewer'})
        assert.equal(org().members.requester2, 'reviewer')
        const staleTeam = {orgId, revision: org().revision - 1, account: 'requester2', role: 'requester' as const}
        await assert.rejects(owner.memberRole('stale-team', staleTeam), /состав команды изменился/)

        // Предел версий проверяется настоящим циклом «возврат — правка — отправка».
        const looped = await author.requestSave('loop-create', {...draft('loop-create-key'), title: 'Подписка на сервис'})
        const row = () => state().requests[looped.id]
        for (let version = 1; version <= 20; version++) {
            await author.requestSubmit('loop-submit-' + version, {orgId, id: looped.id, revision: row().revision, key: 'loop-submit-key-' + version})
            assert.equal(row().versions.length, version)
            if (version == 20) break
            const back = {orgId, id: looped.id, revision: row().revision, version, key: 'loop-changes-key-' + version}
            await reviewer.requestDecide('loop-changes-' + version, {...back, decision: 'changes', body: 'Уточните пункт ' + version})
            const fix = draft('loop-fix-key-' + version, looped.id, row().revision)
            await author.requestSave('loop-fix-' + version, {...fix, title: 'Подписка, правка ' + version})
            // Первая версия остаётся неизменной, сколько бы правок ни прошло.
            assert.equal(row().versions[0].title, 'Подписка на сервис', 'отправленная версия неизменяема')
        }
        const back20 = {orgId, id: looped.id, revision: row().revision, version: 20, key: 'loop-changes-key-20'}
        await reviewer.requestDecide('loop-changes-20', {...back20, decision: 'changes', body: 'Ещё раз'})
        await author.requestSave('loop-fix-20', {...draft('loop-fix-key-20', looped.id, row().revision), title: 'Подписка, правка 20'})
        const overflow = {orgId, id: looped.id, revision: row().revision, key: 'version-limit-key'}
        await assert.rejects(author.requestSubmit('version-limit', overflow), /не более 20 версий/)

        console.log('PASS approvals domain: роли и организации, идемпотентность ключа намерения, устаревшая ревизия,')
        console.log('  условные вопросы и скрытые поля, неизменяемая отправленная версия, запрет решения по своей заявке,')
        console.log('  объяснение возврата, повторное решение версии, история, отзыв, состав команды и предел 20 версий')
    } finally {
        leader.control.close()
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
