import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createSupportRuntime} from './runtime'

async function main() {
    const runtime = createSupportRuntime({demo: false})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    try {
        assert.equal(Object.keys(leader.line.control.store.state.accounts).length, 0)
        const input = {issuer: 'https://identity.example.test', subject: 'person-1', name: 'Новый участник'}
        await assert.rejects(leader.corridor.fragment('owner').identityProvision('spoof', input), /forbidden/)
        const person = await leader.corridor.system.identityProvision('provision', input)
        assert.deepEqual(await leader.corridor.system.identityProvision('provision-again', input), person)
        assert.equal(Object.keys(leader.line.control.store.state.accounts).length, 1)
        assert.equal(Object.keys(leader.line.control.store.state.organizations).length, 0)
        const login = runtime.definition.access.login.resolve
        assert.equal(login(leader.line.control.store.state, {account: person.account, password: ''}), null)
        assert.equal(login(leader.line.control.store.state, {account: 'owner', password: 'owner-pass'}), null)
        const other = await leader.corridor.system.identityProvision('other-issuer', {...input, issuer: 'https://another.example.test'})
        assert.notEqual(other.account, person.account)
        const organization = await leader.corridor.fragment(person.account).orgCreate('onboard', {name: 'Новая команда'})
        assert(organization.id)
        assert.equal(leader.line.control.store.state.organizations[organization.id].members[person.account], 'owner')
        console.log('PASS external identity: system-only provisioning, issuer/subject identity, no demo or empty-password access, no automatic memberships, self onboarding')
    } finally {leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
