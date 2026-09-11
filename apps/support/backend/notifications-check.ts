import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createSupportRuntime} from './runtime'
import {notificationView} from './notifications'

async function main() {
    const leader = createServiceLeader({definition: createSupportRuntime().definition, selfUrl: () => 'http://localhost'})
    const customer = leader.corridor.fragment('customer'), agent = leader.corridor.fragment('agent'), owner = leader.corridor.fragment('owner')
    const state = () => leader.line.control.store.snapshot()
    const view = (account: string) => notificationView(state(), {account, roles: ['owner']})
    try {
        await customer.notificationPreferences('preferences', {orgId: 'northstar', inApp: true, email: true})
        await assert.rejects(customer.notificationPreferences('cross-tenant', {orgId: 'harbor', inApp: true, email: true}), /доступа/)
        const privateReply = await agent.ticketReply('private-notice', {
            orgId: 'northstar',
            id: 'ticket-welcome',
            revision: 1,
            body: 'PRIVATE CONTENT',
            private: true
        })
        assert.equal(view('customer').notices.length, 0)
        assert(view('owner').notices.length)
        assert(!JSON.stringify(state().notices).includes('PRIVATE CONTENT'))
        const input = {orgId: 'northstar', id: 'ticket-welcome', revision: privateReply.revision, body: 'Ответ готов', private: false}
        const publicReply = await agent.ticketReply('public-notice', input)
        assert.deepEqual(await agent.ticketReply('public-notice', input), publicReply)
        assert.equal(view('customer').notices.length, 1)
        assert(view('customer').notices[0].email)
        assert.equal(view('outsider').notices.length, 0)
        const notice = view('customer').notices[0]
        await assert.rejects(owner.notificationsRead('wrong-reader', {orgId: 'northstar', ids: [notice.id]}), /недоступно/)
        await customer.notificationsRead('read-own', {orgId: 'northstar', ids: [notice.id]})
        assert(view('customer').notices[0].read)
        await customer.notificationPreferences('quiet', {orgId: 'northstar', inApp: false, email: false})
        await agent.ticketReply('quiet-notice', {...input, revision: publicReply.revision, body: 'Ещё одно сообщение'})
        assert.equal(view('customer').notices.length, 1)
        await owner.memberRole('revoke-recipient', {orgId: 'northstar', account: 'customer', role: 'revoked'})
        assert.equal(view('customer').notices.length, 0)
        assert.equal(view('customer').preferences.length, 0)
        console.log('PASS notifications: transactional notice dedup, tenant/recipient isolation, private message exclusion, preferences, read ownership, local-only email selection and revocation')
    } finally {leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
