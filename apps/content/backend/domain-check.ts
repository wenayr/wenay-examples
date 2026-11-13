import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createContentRuntime} from './runtime'
import {contentWorkspace, publishedView} from './domain'
import type {ContentState} from './model'

async function main() {
    let clock = Date.UTC(2026, 8, 10, 12)
    const runtime = createContentRuntime({now: () => clock})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
    const state = () => leader.line.control.store.snapshot(), page = () => state().pages.welcome
    const owner = leader.corridor.fragment('owner')
    const author = leader.corridor.fragment('author')
    const editor = leader.corridor.fragment('editor')
    const publisher = leader.corridor.fragment('publisher')
    const reader = leader.corridor.fragment('reader')
    const outsider = leader.corridor.fragment('outsider')
    let sequence = 0
    const rpc = () => 'domain-' + (++sequence), input = () => ({orgId: 'northstar', id: 'welcome', revision: page().revision})
    async function approve() {
        const submitted = await author.reviewSubmit(rpc(), input())
        await editor.reviewDecide(rpc(), {...input(), version: submitted.version, decision: 'approved', body: 'Готово'})
        return submitted.version
    }
    try {
        assert.equal(runtime.definition.access.login.resolve(state(), {account: '__proto__', password: 'reader-pass'}), null)
        assert.deepEqual(publishedView(state()), {pages: []})
        await assert.rejects(reader.pageSave(rpc(), {...input(), ...page().draft}), /forbidden/)
        await assert.rejects(outsider.pageSave(rpc(), {...input(), ...page().draft}), /доступа/)
        await assert.rejects(author.pagePublish(rpc(), {...input(), version: 1, key: rpc()}), /forbidden/)
        await assert.rejects(publisher.pagePublish(rpc(), {...input(), version: 1, key: rpc()}), /снимка/)
        const unsafe = [{id: 'bad', kind: 'button' as const, text: 'click', href: 'javascript:alert(1)', assetId: ''}]
        const attempt = author.pageSave(rpc(), {...input(), ...page().draft, blocks: unsafe})
        await assert.rejects(attempt, /HTTPS/)
        const v1 = await approve(), frozen = JSON.stringify(page().snapshots[0])
        await editor.commentAdd(rpc(), {orgId: 'northstar', id: 'welcome', version: v1, blockId: 'intro', body: 'PRIVATE_REVIEW_COMMENT'})
        const publication = {...input(), version: v1, key: 'first-publish'}
        await publisher.pagePublish(rpc(), publication)
        assert.equal((await publisher.pagePublish(rpc(), publication)).fresh, false)
        assert.equal(page().publications.length, 1)
        assert(!JSON.stringify(runtime.publicRead({orgId: 'northstar', slug: 'welcome'})).includes('PRIVATE_REVIEW_COMMENT'))
        assert(!JSON.stringify(contentWorkspace(state(), {account: 'reader', roles: ['reader']})).includes('PRIVATE_REVIEW_COMMENT'))
        const stale = input()
        await author.pageSave(rpc(), {...input(), ...page().draft, title: 'SECRET_DRAFT_V2'})
        assert.equal(JSON.stringify(page().snapshots[0]), frozen, 'submitted snapshot never mutates')
        assert(!JSON.stringify(publishedView(state())).includes('SECRET_DRAFT_V2'))
        await assert.rejects(publisher.pagePublish(rpc(), {...input(), version: v1, key: 'stale-approval'}), /одобренная текущая/)
        await assert.rejects(author.pageSave(rpc(), {...stale, ...page().draft}), /изменилась/)
        const v2 = await approve()
        await publisher.scheduleCreate(rpc(), {...input(), version: v2, dueAt: clock + 1000, key: 'cancel-schedule'})
        await publisher.scheduleCancel(rpc(), {...input(), scheduleId: page().schedules.at(-1)!.id})
        clock += 2000
        await leader.corridor.system.publicationSweep(rpc(), {})
        assert.equal(page().publishedVersion, v1)
        await publisher.scheduleCreate(rpc(), {...input(), version: v2, dueAt: clock + 1000, key: 'late-schedule'})
        clock += 5000
        await leader.corridor.system.publicationSweep(rpc(), {})
        await leader.corridor.system.publicationSweep(rpc(), {})
        assert.equal(page().publishedVersion, v2)
        assert.equal(page().publications.length, 2)
        await publisher.pageRollback(rpc(), {...input(), version: v1, key: 'rollback-first'})
        assert.equal(runtime.publicRead({orgId: 'northstar', slug: 'welcome'}).title, 'Добро пожаловать в Northstar')
        await publisher.scheduleCreate(rpc(), {...input(), version: v2, dueAt: clock + 1000, key: 'revoke-schedule'})
        await owner.memberRole(rpc(), {orgId: 'northstar', account: 'publisher', role: 'revoked'})
        clock += 2000
        await leader.corridor.system.publicationSweep(rpc(), {})
        assert.equal(page().schedules.at(-1)!.status, 'failed')
        assert.equal(page().publishedVersion, v1)
        await owner.memberRole(rpc(), {orgId: 'northstar', account: 'publisher', role: 'publisher'})
        await publisher.pageWithdraw(rpc(), {...input(), key: 'withdraw'})
        assert.throws(() => runtime.publicRead({orgId: 'northstar', slug: 'welcome'}), /недоступна/)
        assert.deepEqual(publishedView(state()), {pages: []})
        await publisher.scheduleCreate(rpc(), {...input(), version: v2, dueAt: clock + 1000, key: 'draft-cancel'})
        await author.pageSave(rpc(), {...input(), ...page().draft, title: 'Third draft'})
        assert.equal(page().schedules.at(-1)!.status, 'cancelled')
        await assert.rejects(owner.memberRole(rpc(), {orgId: 'northstar', account: 'owner', role: 'revoked'}), /владелец/)
        // Durable model restoration preserves intent receipts and never replays a finished schedule.
        const saved: ContentState = state()
        await close()
        leader.control.close()
        const restoredRuntime = createContentRuntime({now: () => clock})
        const restored = createServiceLeader({definition: {...restoredRuntime.definition, initial: saved}, selfUrl: () => 'http://localhost'})
        try {
            await restored.corridor.system.publicationSweep(rpc(), {})
            assert.equal(restored.line.control.store.state.pages.welcome.publications.length, 3)
        } finally {restored.control.close()}
        console.log('PASS content domain: tenant/role guards, immutable review snapshots, stale approval/revision, public privacy, semantic publication repeats, durable schedule cancellation/late execution/revocation, rollback/withdraw and restart')
    } finally {await close()
    leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})


