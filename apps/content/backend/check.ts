import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createContentRuntime, type ContentDefinition} from './runtime'
import {createProcess} from './process-resource'

async function until(label: string, predicate: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 20000
    while (!await predicate()) {
        assert(Date.now() < deadline, label)
        await delay(30)
    }
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'content-network-'))
    const env = {
        SERVICE_PORT: '0',
        SERVICE_HOST: '127.0.0.1',
        SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
        SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    env.SERVICE_PORT = new URL(url).port
    const definition = describeService(createContentRuntime().definition)
    const clients: ServiceClient<ContentDefinition>[] = []
    const nodes: ReturnType<typeof createProcess>[] = []
    const nodeUrls: string[] = []
    const resources: {close(): Promise<void>}[] = []
    let seq = 0
    const rpc = () => 'network-' + (++seq)
    async function login(account: string) {
        const client = createServiceClient<ContentDefinition>({
            definition,
            url,
            auth: {credentials: {account, password: account + '-pass'}},
            placement: {rng: () => 0}
        })
        clients.push(client)
        await client.ready()
        await client.views.workspace.ready
        return client
    }
    try {
        for (const id of ['content-a', 'content-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_PORT: '0', SERVICE_UPSTREAM: url, SERVICE_NODE_ID: id}})
            nodes.push(node)
            nodeUrls.push(await node.ready)
        }
        const owner = await login('owner')
        const author = await login('author')
        const editor = await login('editor')
        const publisher = await login('publisher')
        const reader = await login('reader')
        const outsider = await login('outsider')
        const anonymous = createServiceClient<ContentDefinition>({definition, url})
        clients.push(anonymous)
        await anonymous.views.published.ready
        const publicResource = reader.resources.open('published')
        resources.push(publicResource)
        await until('public resource', () => !!publicResource.current())
        function page() {return owner.views.workspace.store.state.pages.find(value => value.id == 'welcome')!}
        const input = () => ({orgId: 'northstar', id: 'welcome', revision: page().revision})
        async function synced(revision: number) {await until('owner latest', () => page().revision >= revision)}
        async function approve() {
            const reviewed = await author.commands.reviewSubmit(rpc(), input())
            await synced(reviewed.revision)
            const accepted = await editor.commands.reviewDecide(rpc(), {
                ...input(),
                version: reviewed.version,
                decision: 'approved',
                body: 'SECRET_REVIEW_BODY'
            })
            await synced(accepted.revision)
            return reviewed.version
        }
        const v1 = await approve()
        const firstInput = {...input(), version: v1, key: 'publish-first'}
        const first = await publisher.commands.pagePublish(rpc(), firstInput)
        await synced(first.revision)
        await until('anonymous published view converges', () => anonymous.views.published.store.state.pages.some(value => value.version == v1))
        const publicPath = '/api/content/public/northstar/welcome'
        for (const origin of nodeUrls) {
            const response = await fetch(origin + publicPath)
            assert.equal(response.status, 200)
            assert.equal(response.headers.get('cache-control'), 'no-store')
            const body = await response.text()
            assert(!body.includes('SECRET_REVIEW_BODY') && !body.includes('draftRevision') && !body.includes('snapshots'))
        }
        assert.equal(reader.views.workspace.store.state.pages.length, 0)
        assert.equal(outsider.views.workspace.store.state.pages.length, 0)
        assert.equal((await publicResource.current()!.remote.control.read({orgId: 'northstar', slug: 'welcome'})).version, v1)
        const saved = await author.commands.pageSave(rpc(), {...input(), ...page().draft, title: 'SECRET_NEXT_DRAFT'})
        await synced(saved.revision)
        assert(!(await fetch(nodeUrls[1] + publicPath).then(response => response.text())).includes('SECRET_NEXT_DRAFT'))
        const v2 = await approve()
        const scheduled = await publisher.commands.scheduleCreate(rpc(), {
            ...input(),
            version: v2,
            dueAt: Date.now() + 1300,
            key: 'cancelled-job'
        })
        await synced(scheduled.revision)
        const cancelled = await publisher.commands.scheduleCancel(rpc(), {...input(), scheduleId: page().schedules.at(-1)!.id})
        await synced(cancelled.revision)
        await delay(1400)
        assert.equal((await fetch(nodeUrls[1] + publicPath).then(response => response.json())).version, v1)
        const endpoint = owner.view.endpoint()!, stable = owner.views.workspace.store
        assert(endpoint.nodeId != 'leader', 'real serving node handles editor workspace')
        const stopped = endpoint.nodeId == 'content-a' ? 0 : 1
        const surviving = stopped ? 0 : 1
        await nodes[stopped].control.stop(true)
        await until('editor serving failover', () => !!owner.view.endpoint() && owner.view.endpoint()!.nodeId != endpoint.nodeId)
        assert.equal(owner.views.workspace.store, stable)
        const withdrawal = await publisher.commands.pageWithdraw(rpc(), {...input(), key: 'withdraw-first'})
        await synced(withdrawal.revision)
        assert.equal((await fetch(nodeUrls[surviving] + publicPath)).status, 404)
        await assert.rejects(publicResource.current()!.remote.control.read({orgId: 'northstar', slug: 'welcome'}))
        await until('public replica catches withdrawal', () => anonymous.views.published.store.state.pages.length == 0)
        const due = Date.now() + 1400, pending = await publisher.commands.scheduleCreate(rpc(), {...input(), version: v2, dueAt: due, key: 'durable-publish'})
        await synced(pending.revision)
        await host.control.stop()
        assert.equal((await fetch(nodeUrls[surviving] + publicPath)).status, 503, 'serving node refuses offline authority even if old public data were cached')
        await delay(Math.max(1, due - Date.now() + 100))
        host = createProcess({script: 'server.ts', env})
        assert.equal(await host.ready, url)
        await until('overdue publication after restart', function published() {
            const request = fetch(nodeUrls[surviving] + publicPath).then(response => response.json())
            return request.then(body => body.version == v2).catch(() => false)
        })
        await until('old client restored', () => !!owner.health.state.connected && page()?.publishedVersion == v2)
        await until('old resource restored', () => !!publicResource.current())
        assert.equal((await publicResource.current()!.remote.control.read({orgId: 'northstar', slug: 'welcome'})).version, v2)
        assert.equal(page().publications.filter(value => value.kind == 'scheduled').length, 1)
        const repeat = await publisher.commands.pagePublish(rpc(), firstInput)
        assert.equal(repeat.fresh, false)
        assert.equal(page().publishedVersion, v2, 'old semantic receipt cannot republish obsolete version')
        const rolled = await publisher.commands.pageRollback(rpc(), {...input(), version: v1, key: 'rollback-restored'})
        await synced(rolled.revision)
        assert.equal((await fetch(nodeUrls[surviving] + publicPath).then(response => response.json())).version, v1)
        assert.equal(page().schedules.find(value => value.status == 'published')?.version, v2)
        console.log('PASS content network: authority + 2 serving, anonymous/public-only projections, fresh node HTTP, draft/review privacy, real node failover, schedule cancellation, offline 503, overdue restart publication once, stable client/resource reconnect and rollback')
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const client of clients) client.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('content-network-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
