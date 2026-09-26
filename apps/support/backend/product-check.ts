import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createSupportRuntime} from './runtime'
import {createSearchProductHttp, SEARCH_INPUT} from './product-http'
import {inputJsonSchema} from 'wenay-common2/service'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {readFileSync, readdirSync} from 'node:fs'

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'search-product-'))
    let clock = Date.now()
    let observedSignal: AbortSignal | null = null
    let units = 0, beforeExecute: (() => Promise<void>) | null = null, afterExecute: (() => Promise<void>) | null = null
    const usage = {async run<T>(input: {orgId: string, units: number, signal: AbortSignal}, operation: () => Promise<T>) {
        assert.equal(input.orgId, 'northstar')
        assert.equal(input.units, 1)
        units++
        observedSignal = input.signal
        await beforeExecute?.()
        const result = await operation()
        await afterExecute?.()
        return result
    }}
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let runtime = createSupportRuntime({now: () => clock, usage})
    async function start() {
        runtime = createSupportRuntime({now: () => clock, usage})
        return createServiceLeaderHost({definition: runtime.definition, env, mount({app, leader}) {
            const close = runtime.mount(leader.line.control.store, leader.corridor.system)
            createSearchProductHttp({app, published: runtime.product,
                account: token => leader.access.principalOf(leader.identity.principal(token)).account})
            return close
        }})
    }
    let host = await start()
    const clients: {close(): void}[] = []
    async function request(account: string | null, input: unknown, retainedToken?: string) {
        const bearer: Record<string, string> = {}
        if (account) bearer.authorization = 'Bearer ' + (retainedToken ?? host.leader.identity.login(account).token)
        const response = await fetch(host.url + '/api/product/search/published', {
            method: 'POST',
            headers: {'content-type': 'application/json', ...bearer},
            body: JSON.stringify({args: [input]})
        })
        return {status: response.status, cache: response.headers.get('cache-control'), body: await response.json()}
    }
    async function login(account: string, password: string) {
        const response = await fetch(host.url + '/api/support/login', {method: 'POST',
            headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account, password}]})})
        return response.json()
    }
    async function connect(account: string, password: string) {
        const client = createServiceClient({definition: describeService(runtime.definition), url: host.url,
            auth: {credentials: {account, password}}, log() {}})
        clients.push(client)
        await client.ready()
        return client
    }
    async function ownerKeys() {
        const session = await connect('owner', 'owner-pass')
        const resource = session.resources.open('productKeys')
        await waitFor(() => !!resource.current())
        return {session, resource, remote: resource.current()!.remote}
    }
    function context(account: string) {
        return {principal: host.leader.access.principalOf({account}), sessionId: account, resourceId: 'product-check', signal: new AbortController().signal}
    }
    async function waitFor(test: () => boolean) {
        const deadline = Date.now() + 5000
        while (!test()) {
            assert(Date.now() < deadline, 'Timeout waiting for product resource')
            await new Promise(resolve => setTimeout(resolve, 20))
        }
    }
    try {
        const ownerClient = await connect('owner', 'owner-pass')
        const owner = ownerClient.commands
        const article = await owner.articleSave('public-search-source', {
            orgId: 'northstar',
            id: '',
            revision: 0,
            title: 'Гарантия',
            body: 'Правила гарантии для нашего продукта'
        })
        const input = {orgId: 'northstar', query: 'гарантии', limit: 3, requestId: 'search-one'}
        assert.equal((await request(null, input)).status, 401)
        assert.equal((await request('customer', input)).body.value.length, 0)
        const published = await owner.articlePublish('public-search-publish', {orgId: 'northstar', ...article, status: 'published'})
        const found = await request('customer', input)
        assert.equal(found.cache, 'no-store')
        assert.equal(found.body.value[0].revision, published.revision)
        const charged = units
        assert.equal((await request('outsider', input)).body.ok, false)
        assert.equal(units, charged, 'wrong tenant is denied before quota')
        assert.equal((await request('customer', {...input, limit: '3'})).body.ok, false)
        assert.equal((await request('customer', {...input, account: 'owner'})).body.ok, false)
        const spec = await fetch(host.url + '/api/product/openapi.json').then(response => response.json())
        assert.deepEqual(Object.keys(spec.paths), ['/api/product/search/published'])
        const route = spec.paths['/api/product/search/published'].post
        const body = route.requestBody.content['application/json'].schema.oneOf[0]
        assert.deepEqual(body.properties.args.prefixItems[0], inputJsonSchema(SEARCH_INPUT))
        assert.equal((await fetch(host.url + '/api/product/commands/memberRole', {method: 'POST'})).status, 404)
        await owner.articlePublish('public-search-withdraw', {orgId: 'northstar', ...published, status: 'draft'})
        assert.equal((await request('customer', input)).body.value.length, 0)
        beforeExecute = async function revoke() {await owner.memberRole('during-product-call', {orgId: 'northstar', account: 'customer', role: 'revoked'})}
        assert.equal((await request('customer', {...input, requestId: 'after-revoke'})).body.ok, false, 'fresh ACL after waiting on quota')
        beforeExecute = null
        await owner.articlePublish('machine-search-publish', {orgId: 'northstar', ...published, revision: published.revision + 1, status: 'published'})
        const openedKeys = await ownerKeys()
        const keys = openedKeys.remote
        const issue = {requestId: 'first-machine', orgId: 'northstar', label: 'Knowledge consumer', scopes: ['knowledge:search'] as const, days: 1}
        const issued = await keys.control.issue({...issue, scopes: [...issue.scopes]})
        assert(issued.secret)
        assert.equal((await keys.control.issue({...issue, scopes: [...issue.scopes]})).secret, null)
        await assert.rejects(keys.control.issue({...issue, scopes: [...issue.scopes], label: 'Changed'}), /другими параметрами/)
        await assert.rejects(keys.control.issue({...issue, requestId: 'long-life', scopes: [...issue.scopes], days: 91}), /90/)
        await assert.rejects(keys.control.issue({...issue, requestId: 'no-scope', scopes: []}), /право/)
        await assert.rejects(keys.control.issue({...issue, requestId: 'wrong-tenant', orgId: 'harbor', scopes: [...issue.scopes]}), /доступа/)
        const agentKeys = runtime.definition.resources.productKeys.open(context('agent'))
        await assert.rejects(agentKeys.facade.control.issue({...issue, requestId: 'agent-issue', scopes: [...issue.scopes]}), /доступа/)
        assert.equal((await login('owner', 'owner-pass')).ok, true, 'human credential login remains intact')
        assert.equal((await login(issued.account, 'wrong-secret')).ok, false)
        const machineLogin = await login(issued.account, issued.secret)
        assert.equal(machineLogin.ok, true, 'machine authenticates through public common2 login')
        assert.equal(machineLogin.value.account, issued.account)
        const state = host.leader.line.control.store.snapshot()
        assert.equal(JSON.stringify(state).includes(issued.secret), false)
        assert.equal(Object.hasOwn(state.accounts, issued.account), false, 'machine is not a human member')
        assert.equal(Object.hasOwn(state.organizations.northstar.members, issued.account), false)
        assert.equal(JSON.stringify(await keys.control.list({orgId: 'northstar'})).includes(state.productKeys![issued.id].hash), false)
        assert.equal(JSON.stringify(host.leader.access.snapshot('workspace', context('owner').principal)).includes(state.productKeys![issued.id].hash), false)
        const noDemo = createSupportRuntime({demo: false, now: () => clock})
        assert.equal(noDemo.definition.access.login.resolve(state, {account: issued.account, password: issued.secret}), issued.account)
        assert.equal(noDemo.definition.access.login.resolve(state, {account: 'owner', password: 'owner-pass'}), null)
        const machine = createServiceClient({definition: describeService(runtime.definition), url: host.url,
            auth: {credentials: {account: issued.account, password: issued.secret}}, log() {}})
        clients.push(machine)
        await machine.ready()
        const permissions = await machine.identity.me()
        assert.deepEqual(permissions.roles, ['knowledge:search'])
        assert.deepEqual(permissions.views, [])
        assert.deepEqual(permissions.commands, [])
        assert(permissions.resources)
        assert.deepEqual([...permissions.resources].sort(), ['productSearch', 'productSearchJobs'])
        const resource = machine.resources.open('productSearch')
        await waitFor(() => !!resource.current())
        const saved = resource.current()!.remote
        assert.equal((await saved.control.published({...input, requestId: 'machine-rpc'}))[0].id, article.id)
        const used = units
        await assert.rejects(saved.control.published({...input, orgId: 'harbor', requestId: 'machine-tenant'}), /ключ|Ключ|организац/)
        assert.equal(units, used)
        assert.equal((await request(issued.account, {...input, requestId: 'machine-http'}, machineLogin.value.token)).body.value[0].id, article.id)
        await assert.rejects(machine.commands.memberRole('machine-admin', {
            orgId: 'northstar', account: 'agent', role: 'owner'
        }), /forbidden|недоступ|available/i)
        afterExecute = async function revokeMachine() {await owner.productKeyRevoke('revoke-machine-mid-settle', {orgId: 'northstar', id: issued.id})}
        assert.equal((await request(issued.account, {...input, requestId: 'machine-mid-settle'}, machineLogin.value.token)).body.ok, false,
            'revoke after execution and during settlement prevents disclosure')
        afterExecute = null
        await assert.rejects(saved.control.published({...input, requestId: 'saved-after-revoke'}))
        assert.equal((await login(issued.account, issued.secret)).ok, false)
        assert.equal((await request(issued.account, {...input, requestId: 'retained-after-revoke'}, machineLogin.value.token)).body.ok, false,
            'saved pre-revoke HTTP bearer cannot disclose publications')
        assert((await keys.control.list({orgId: 'northstar'})).find(key => key.id == issued.id)?.revokedAt,
            'owner RPC list sees the RPC command revocation')
        const expiring = await keys.control.issue({...issue, requestId: 'expiring-machine', scopes: [...issue.scopes]})
        assert(expiring.secret)
        const expiryLogin = await login(expiring.account, expiring.secret)
        assert.equal(expiryLogin.ok, true)
        const expiryClient = await connect(expiring.account, expiring.secret)
        const expiryResource = expiryClient.resources.open('productSearch')
        await waitFor(() => !!expiryResource.current())
        const expiryRemote = expiryResource.current()!.remote
        clock = expiring.expiresAt
        await assert.rejects(expiryRemote.control.published({...input, requestId: 'expiry-open'}), 'retained RPC facade denies expired machine key')
        assert.equal((await request(expiring.account, {...input, requestId: 'expiry-http'}, expiryLogin.value.token)).body.ok, false)
        assert.equal((await login(expiring.account, expiring.secret)).ok, false)
        const interrupted = await keys.control.issue({...issue, requestId: 'before-io-machine', scopes: [...issue.scopes]})
        beforeExecute = async function revokeBeforeSearch() {await owner.productKeyRevoke('revoke-before-search', {orgId: 'northstar', id: interrupted.id})}
        assert.equal((await request(interrupted.account, {...input, requestId: 'machine-mid-reserve'})).body.ok, false)
        beforeExecute = null
        const active = await keys.control.issue({...issue, requestId: 'restart-machine', scopes: [...issue.scopes]})
        assert(active.secret)
        const closingClient = await connect(active.account, active.secret)
        const closingResource = closingClient.resources.open('productSearch')
        await waitFor(() => !!closingResource.current())
        let releaseIo: () => void = () => {}
        let reachedIo = false
        const pausedIo = new Promise<void>(resolve => {releaseIo = resolve})
        observedSignal = null
        afterExecute = async function holdSettlement() {
            reachedIo = true
            await pausedIo
        }
        const closingCall = closingResource.current()!.remote.control.published({...input, requestId: 'close-during-io'})
        const rejectedCall = assert.rejects(closingCall, 'closing real RPC resource during IO rejects pending search')
        try {
            await waitFor(() => reachedIo && observedSignal != null)
            await closingResource.close()
            await waitFor(() => !!observedSignal?.aborted)
        } finally {
            releaseIo()
            beforeExecute = null
            afterExecute = null
        }
        await rejectedCall
        const cancelled = new AbortController()
        const closed = runtime.definition.resources.productSearch.open({...context(active.account), signal: cancelled.signal})
        cancelled.abort()
        await assert.rejects(closed.facade.control.published({...input, requestId: 'closed-resource'}))
        await resource.close()
        for (const client of clients) client.close()
        await host.close()
        for (const file of readdirSync(directory, {recursive: true, withFileTypes: true})) {
            if (file.isFile()) assert.equal(readFileSync(path.join(file.parentPath, file.name), 'utf8').includes(issued.secret), false,
                'one-time secret does not enter durable replay files')
        }
        host = await start()
        assert.equal(host.leader.line.control.store.state.productKeys![issued.id].revokedAt > 0, true)
        assert.equal((await login(issued.account, issued.secret)).ok, false, 'revocation survives durable replay')
        assert.equal((await login(expiring.account, expiring.secret)).ok, false, 'expiry survives durable replay')
        assert.equal((await login(active.account, active.secret)).ok, true, 'active machine key survives durable replay')
        const restoredKeys = await ownerKeys()
        const repeated = await restoredKeys.remote.control.issue({...issue, requestId: 'restart-machine', scopes: [...issue.scopes]})
        assert.equal(repeated.id, active.id)
        assert.equal(repeated.secret, null, 'restart never re-discloses secret')
        assert.equal((await request(active.account, {...input, requestId: 'restart-search'})).body.value[0].id, article.id)
        console.log('PASS product search: common2 login/resources/HTTP/OpenAPI, separate hash-only machine identity, single-display issuance,')
        console.log('  tenant/scope/no-admin, expiry and retained resources, revoke during reserve and settlement, retained HTTP bearer,')
        console.log('  RPC close during IO, durable replay and owner RPC issuance/list/revoke')
    } finally {
        for (const client of clients) client.close()
        await host.close()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('search-product-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
