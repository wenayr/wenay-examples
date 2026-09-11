import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {CrmDefinition} from '../../crm/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

function openCrm(client: ServiceClient<CrmDefinition>) {return client.resources.open('crm')}
function openImports(client: ServiceClient<CrmDefinition>) {return client.resources.open('imports')}
async function main() {
    let owner: ServiceClient<CrmDefinition> | undefined, customer: ServiceClient<CrmDefinition> | undefined
    let crm: ReturnType<typeof openCrm> | undefined, customerCrm: ReturnType<typeof openCrm> | undefined, imports: ReturnType<typeof openImports> | undefined
    let generation = 0, importId = '', importRevision = 0
    let approval: {orgId: string, id: string, revision: number, version: number, decision: 'accept', body: string} | undefined
    const orgId = 'northstar', id = 'deal-aurora'
    async function detail() {return crm!.current()!.remote.control.detail({orgId, id})}
    await checkHostedApplication({name: 'crm', async verify({url, iteration}) {
        assert((await fetch(url).then(response => response.text())).includes('Orbit'))
        if (!owner) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            owner = createServiceClient<CrmDefinition>({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            customer = createServiceClient<CrmDefinition>({definition, url, auth: {credentials: {account: 'customer', password: 'customer-pass'}}})
            await owner.ready()
            await customer.ready()
            await owner.views.workspace.ready
            await customer.views.workspace.ready
            crm = openCrm(owner)
            customerCrm = openCrm(customer)
            await waitForHosted('CRM resources', () => !!crm?.current() && !!customerCrm?.current())
            await owner.commands.interactionAdd('hosted-note', {
                orgId,
                id,
                revision: (await detail()).deal.revision,
                body: 'HOSTED_PRIVATE_NOTE',
                private: true
            })
            await owner.commands.proposalSave('hosted-draft', {
                orgId,
                id,
                revision: (await detail()).deal.revision,
                title: 'Проект через хостинг',
                body: 'Согласованный объём и срок',
                amount: 125000
            })
            await owner.commands.proposalPublish('hosted-publish', {orgId, id, revision: (await detail()).deal.revision})
        } else {
            await waitForHosted('same CRM resource and workspace after deployment', function ready() {
                if (!owner?.health.state.connected || !customer?.health.state.connected) return false
                if ((crm?.current()?.generation ?? 0) <= generation) return false
                return !!customerCrm?.current()
            })
            const saved = (await detail()).deal
            assert.equal(saved.proposals.length, 1)
            assert.equal(saved.proposals[0].title, 'Проект через хостинг')
            assert(saved.interactions.some(value => value.body == 'HOSTED_PRIVATE_NOTE'))
            assert(!(await customerCrm!.current()!.remote.control.detail({orgId, id})).deal.interactions.some(value => value.body == 'HOSTED_PRIVATE_NOTE'))
            if (iteration == 1) {
                approval = {orgId, id, revision: saved.revision, version: 1, decision: 'accept', body: 'Принимаю предложение'}
                await customer!.commands.proposalRespond('hosted-accept', approval)
                await owner.views.taskBoards.ready
                await waitForHosted('accepted proposal creates task', function linked() {
                    const boards = owner!.views.taskBoards.store.state.boards
                    return boards.some(board => board.tasks.some(task => task.source?.id == id))
                })
                imports = openImports(owner)
                await waitForHosted('import resource', () => !!imports?.current())
                const uploaded = await imports.current()!.remote.control.upload({
                    orgId,
                    companyId: 'company-aurora',
                    name: 'hosted.csv',
                    bytes: Buffer.from('name,email\nHosted Contact,hosted@example.com')
                })
                importId = uploaded.id
                await imports.current()!.remote.ai.createRun({
                    requestId: 'hosted-import',
                    kind: 'import',
                    resourceIds: [uploaded.id],
                    input: {orgId, importId: uploaded.id, revision: uploaded.revision}
                })
                await owner.views.imports.ready
                await waitForHosted('hosted CSV import', function completed() {
                    return owner!.views.imports.store.state.imports.some(function done(value) {
                        return value.id == importId && value.status == 'completed'
                    })
                })
                importRevision = owner.views.imports.store.state.imports.find(value => value.id == importId)!.revision
            } else {
                assert.equal(saved.decisions[0].decision, 'accept')
                await customer!.commands.proposalRespond('hosted-accept', approval!)
                await owner.views.taskBoards.ready
                assert.equal(owner.views.taskBoards.store.state.boards.flatMap(board => board.tasks).filter(task => task.source?.id == id).length, 1)
                await waitForHosted('import resource after rollback', () => !!imports?.current())
                assert.equal((await imports!.current()!.remote.control.detail({orgId, id: importId, revision: importRevision})).rows[0].status, 'imported')
                assert.equal(owner.views.workspace.store.state.contacts.filter(value => value.email == 'hosted@example.com').length, 1)
            }
        }
        generation = crm?.current()?.generation ?? 0
    }, async close() {await imports?.close()
    await customerCrm?.close()
    await crm?.close()
    customer?.close()
    owner?.close()}})
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
