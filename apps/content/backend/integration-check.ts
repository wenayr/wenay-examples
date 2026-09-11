import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createContentRuntime, type ContentDefinition} from './runtime'
import {createSupportRuntime, type SupportDefinition} from '../../support/backend/runtime'
import {contentTargets} from '../../support/backend/content-resource'

async function until(predicate: () => boolean) {const deadline = Date.now() + 5000; while (!predicate()) {assert(Date.now() < deadline, 'integration timeout'); await delay(15)}}
async function main() {
    assert.equal(readFileSync(path.join(__dirname, 'published-contract.ts'), 'utf8'), readFileSync(path.join(__dirname, '../../support/backend/published-contract.ts'), 'utf8'), 'copyable facade contract stays identical')
    assert.throws(() => contentTargets('{"northstar":{"url":"https://user:secret@example.test/","orgId":"northstar","account":"reader","password":"reader-pass"}}'))
    const cms = createContentRuntime()
    let pause = false, entered = false, finish = () => {}
    const actualResource = cms.definition.resources.published
    // Local network fixture holds a remote answer to prove the support-side post-IO tenant guard.
    const cmsDefinition = {...cms.definition, resources: {...cms.definition.resources, published: {...actualResource, open(ctx: Parameters<typeof actualResource.open>[0]) {
        const connection = actualResource.open(ctx)
        return {...connection, facade: {control: {...connection.facade.control, async read(input: {orgId: string, slug: string}) {
            const result = connection.facade.control.read(input)
            if (pause) {entered = true; await new Promise<void>(resolve => {finish = resolve})}
            return result
        }}}}
    }}}}
    const contentHost = await createServiceLeaderHost({definition: cmsDefinition, env: {SERVICE_PORT: '0'}, mount({app, leader}) {
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(cmsDefinition))})
        return cms.mount({store: leader.line.control.store, system: leader.corridor.system})
    }})
    const support = createSupportRuntime({content: {targets: {northstar: {url: contentHost.url, orgId: 'northstar', account: 'reader', password: 'reader-pass'}}, timeoutMs: 2000}})
    const supportHost = await createServiceLeaderHost({definition: support.definition, env: {SERVICE_PORT: '0'}, mount({leader}) {return support.mount(leader.line.control.store)}})
    const contentClients: ServiceClient<ContentDefinition>[] = [], supportClients: ServiceClient<SupportDefinition>[] = [], resources: {close(): Promise<void>}[] = []
    async function contentClient(account: string) {const client = createServiceClient<ContentDefinition>({definition: describeService(cms.definition), url: contentHost.url, auth: {credentials: {account, password: account + '-pass'}}}); contentClients.push(client); await client.ready(); await client.views.workspace.ready; return client}
    async function supportClient(account: string) {const client = createServiceClient<SupportDefinition>({definition: describeService(support.definition), url: supportHost.url, auth: {credentials: {account, password: account + '-pass'}}}); supportClients.push(client); await client.ready(); await client.views.workspace.ready; const resource = client.resources.open('content'); resources.push(resource); await until(() => !!resource.current()); return {client, resource}}
    let seq = 0; const rpc = () => 'integration-' + (++seq)
    try {
        const owner = await contentClient('owner'), author = await contentClient('author'), editor = await contentClient('editor'), publisher = await contentClient('publisher')
        const helpdesk = await supportClient('owner'), customer = await supportClient('customer'), outsider = await supportClient('outsider')
        const read = () => customer.resource.current()!.remote.control.read({orgId: 'northstar', slug: 'welcome'})
        const initialArticles = JSON.stringify(helpdesk.client.views.workspace.store.state.articles)
        assert.deepEqual(await customer.resource.current()!.remote.control.list('northstar'), {configured: true, articles: []})
        assert.equal((await outsider.resource.current()!.remote.control.list('harbor')).configured, false)
        await assert.rejects(outsider.resource.current()!.remote.control.list('northstar'))
        function page() {return owner.views.workspace.store.state.pages.find(value => value.id == 'welcome')!}
        const input = () => ({orgId: 'northstar', id: 'welcome', revision: page().revision})
        async function sync(revision: number) {await until(() => page().revision >= revision)}
        const submitted = await author.commands.reviewSubmit(rpc(), input()); await sync(submitted.revision)
        const approved = await editor.commands.reviewDecide(rpc(), {...input(), version: submitted.version, decision: 'approved', body: 'CMS_PRIVATE_COMMENT'}); await sync(approved.revision)
        const publication = await publisher.commands.pagePublish(rpc(), {...input(), version: submitted.version, key: 'knowledge-first'}); await sync(publication.revision)
        const list = await customer.resource.current()!.remote.control.list('northstar'); assert.equal(list.articles.length, 1)
        const article = await read(); assert.equal(article.version, 1); assert(!JSON.stringify(article).includes('CMS_PRIVATE_COMMENT'))
        const nextDraft = await author.commands.pageSave(rpc(), {...input(), ...page().draft, title: 'CMS_UNPUBLISHED_DRAFT'}); await sync(nextDraft.revision)
        assert(!(JSON.stringify(await read())).includes('CMS_UNPUBLISHED_DRAFT'))
        assert.equal(JSON.stringify(helpdesk.client.views.workspace.store.state.articles), initialArticles, 'published source is not copied into editable support articles')
        const withdrawn = await publisher.commands.pageWithdraw(rpc(), {...input(), key: 'knowledge-withdraw'}); await sync(withdrawn.revision)
        await assert.rejects(read()); assert.equal((await customer.resource.current()!.remote.control.list('northstar')).articles.length, 0)
        const rolled = await publisher.commands.pageRollback(rpc(), {...input(), version: 1, key: 'knowledge-rollback'}); await sync(rolled.revision)
        assert.equal((await read()).version, 1)
        await owner.commands.memberRole(rpc(), {orgId: 'northstar', account: 'reader', role: 'editor'})
        await assert.rejects(read(), /недоступен/, 'misconfigured editor credentials are refused')
        await owner.commands.memberRole(rpc(), {orgId: 'northstar', account: 'reader', role: 'reader'})
        assert.equal((await read()).version, 1)
        const invitation = await outsider.client.commands.inviteCreate(rpc(), {orgId: 'harbor', role: 'customer', hours: 1})
        await customer.client.commands.inviteAccept(rpc(), {token: invitation.token})
        pause = true
        const inFlight = read(); await until(() => entered)
        await helpdesk.client.commands.memberRole(rpc(), {orgId: 'northstar', account: 'customer', role: 'revoked'})
        finish(); await assert.rejects(inFlight, /недоступен|generation is closed/); pause = false
        await assert.rejects(read())
        await contentHost.close()
        await assert.rejects(helpdesk.resource.current()!.remote.control.list('northstar'), /недоступен/)
        assert.equal(JSON.stringify(helpdesk.client.views.workspace.store.state.articles), initialArticles)
        console.log('PASS content/support integration: real common2 reader resource, configured tenant binding, no writer credentials, no draft/review leak or editable copy, publication/withdraw/rollback, post-IO support revoke and source offline fail closed')
    } finally {
        finish()
        for (const resource of resources) await resource.close().catch(() => {})
        for (const client of [...contentClients, ...supportClients]) client.close()
        await supportHost.close(); await contentHost.close()
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
