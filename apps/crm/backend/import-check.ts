import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createCrmRuntime} from './runtime'
import {crmRoles} from './domain'
import {importView} from './imports'

async function until(label: string, check: () => boolean) {
    const end = Date.now() + 12000
    while (!check()) {
        assert(Date.now() < end, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 5))
    }
}
async function main() {
    const runtime = createCrmRuntime()
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, execute: leader.corridor.system})
    const state = () => leader.line.control.store.snapshot()
    function resource(account: string) {
        return runtime.definition.resources.imports.open({principal: {account, roles: crmRoles(state(), account)}, sessionId: account, resourceId: 'imports', signal: new AbortController().signal})
    }
    const manager = resource('manager'), owner = leader.corridor.fragment('owner'), outside = resource('outsider')
    const commands = leader.corridor.fragment('manager')
    const orgId = 'northstar', companyId = 'company-aurora'
    const job = (id: string) => state().imports![id]
    const upload = (name: string, text: string) => manager.facade.control.upload({orgId, companyId, name, bytes: Buffer.from(text)})
    function run(id: string, requestId: string) {
        return manager.facade.ai.createRun({kind: 'import', requestId, resourceIds: [id], input: {orgId, importId: id, revision: job(id).revision}})
    }
    try {
        await assert.rejects(upload('bad.csv', 'name,name\nA,B'), /уникальными/)
        await assert.rejects(outside.facade.control.upload({orgId, companyId, name: 'forbidden.csv', bytes: Buffer.from('name,email\nTest,test@example.com')}), /доступа/)
        const source = 'full_name,mail,phone\nFirst,new@example.com,123\nAgain,new@example.com,456\nBad,not-email,0\nExisting,ilya@aurora.example,0'
        const created = await upload('contacts.csv', source)
        assert.deepEqual(await upload('contacts.csv', source), created)
        await commands.importMap('mapping', {orgId, id: created.id, revision: 1, name: 'full_name', email: 'mail', phone: 'phone'})
        assert.deepEqual(Object.keys(job(created.id).mapping).sort(), ['email', 'name', 'phone'])
        await assert.rejects(commands.importMap('stale-map', {orgId, id: created.id, revision: 1, name: 'mail', email: 'full_name', phone: ''}), /изменено/)
        const count = Object.keys(state().contacts).length
        const started = run(created.id, 'contacts-first')
        await until('import completed', () => job(created.id).status == 'completed')
        assert.deepEqual(job(created.id).rows.map(row => row.status), ['imported', 'duplicate', 'invalid', 'duplicate'])
        assert.equal(Object.keys(state().contacts).length, count + 1)
        assert.equal(run(created.id, 'contacts-first').id, started.id)
        assert(!JSON.stringify(importView(state(), {account: 'manager', roles: []})).includes('new@example.com'))
        await assert.rejects(outside.facade.control.detail({orgId, id: created.id, revision: job(created.id).revision}), /доступа/)
        const many = 'name,email\n' + Array.from({length: 200}, (_, index) => 'Person ' + index + ',batch-' + index + '@example.com').join('\n')
        const batch = await upload('batch.csv', many)
        const batchRun = run(batch.id, 'batch-start')
        await until('batch made progress', () => job(batch.id).rows.some(row => row.status == 'imported'))
        manager.facade.ai.cancelRun(batchRun.id)
        await until('cancel recorded', () => job(batch.id).status == 'cancelled')
        const beforeResume = job(batch.id).rows.filter(row => row.status == 'imported').length
        assert(beforeResume > 0 && beforeResume < 200)
        await new Promise(resolve => setTimeout(resolve, 20))
        run(batch.id, 'batch-resume')
        await until('batch resumed', () => job(batch.id).status == 'completed')
        assert.equal(job(batch.id).rows.filter(row => row.status == 'imported').length, 200)
        assert.equal(Object.values(state().contacts).filter(contact => contact.email.startsWith('batch-')).length, 200)
        const revoked = await upload('revoked.csv', many.replaceAll('batch-', 'revoke-'))
        run(revoked.id, 'revoke-run')
        await until('revoked batch progress', () => job(revoked.id).rows.some(row => row.status == 'imported'))
        await owner.memberRole('revoke-importer', {orgId, revision: state().organizations.northstar.revision, account: 'manager', role: 'none'})
        await until('revoked batch stops', () => job(revoked.id).status == 'uncertain')
        assert(job(revoked.id).rows.some(row => row.status == 'pending'))
        assert.equal(importView(state(), {account: 'manager', roles: ['owner']}).imports.length, 0)
        await assert.rejects(manager.facade.control.detail({orgId, id: revoked.id, revision: job(revoked.id).revision}), /доступа/)
        console.log('PASS CRM imports: shared CSV parser, mapping, private preview, duplicate/invalid rows, semantic retries, partial cancellation/resume without duplicate contacts and fresh membership revocation')
    } finally {manager.close(); outside.close(); close(); leader.control.close()}
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
