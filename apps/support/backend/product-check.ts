import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createSupportRuntime} from './runtime'
import {createSearchProductHttp, SEARCH_INPUT} from './product-http'
import {inputJsonSchema} from 'wenay-common2/service'

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'search-product-'))
    const runtime = createSupportRuntime()
    let units = 0, beforeExecute: (() => Promise<void>) | null = null
    const host = await createServiceLeaderHost({definition: runtime.definition, env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}, mount({app, leader}) {
        const close = runtime.mount(leader.line.control.store)
        createSearchProductHttp({app, search: runtime.search, account: token => leader.access.principalOf(leader.identity.principal(token)).account,
            usage: {async run(input, operation) {assert.equal(input.orgId, 'northstar'); assert.equal(input.units, 1); units++; await beforeExecute?.(); return operation()}}})
        return close
    }})
    async function request(account: string | null, input: unknown) {
        const response = await fetch(host.url + '/api/product/search/published', {method: 'POST', headers: {'content-type': 'application/json', ...(account ? {authorization: 'Bearer ' + host.leader.identity.login(account).token} : {})}, body: JSON.stringify({args: [input]})})
        return {status: response.status, cache: response.headers.get('cache-control'), body: await response.json()}
    }
    try {
        const owner = host.leader.corridor.fragment('owner')
        const article = await owner.articleSave('public-search-source', {orgId: 'northstar', id: '', revision: 0, title: 'Гарантия', body: 'Правила гарантии для нашего продукта'})
        const input = {orgId: 'northstar', query: 'гарантии', limit: 3, requestId: 'search-one'}
        assert.equal((await request(null, input)).status, 401)
        assert.equal((await request('customer', input)).body.value.length, 0)
        const published = await owner.articlePublish('public-search-publish', {orgId: 'northstar', ...article, status: 'published'})
        const found = await request('customer', input)
        assert.equal(found.cache, 'no-store'); assert.equal(found.body.value[0].revision, published.revision)
        const charged = units
        assert.equal((await request('outsider', input)).body.ok, false)
        assert.equal(units, charged, 'wrong tenant is denied before quota')
        assert.equal((await request('customer', {...input, limit: '3'})).body.ok, false)
        assert.equal((await request('customer', {...input, account: 'owner'})).body.ok, false)
        const spec = await fetch(host.url + '/api/product/openapi.json').then(response => response.json())
        assert.deepEqual(Object.keys(spec.paths), ['/api/product/search/published'])
        assert.deepEqual(spec.paths['/api/product/search/published'].post.requestBody.content['application/json'].schema.oneOf[0].properties.args.prefixItems[0], inputJsonSchema(SEARCH_INPUT))
        assert.equal((await fetch(host.url + '/api/product/commands/memberRole', {method: 'POST'})).status, 404)
        await owner.articlePublish('public-search-withdraw', {orgId: 'northstar', ...published, status: 'draft'})
        assert.equal((await request('customer', input)).body.value.length, 0)
        beforeExecute = async function revoke() {await owner.memberRole('during-product-call', {orgId: 'northstar', account: 'customer', role: 'revoked'})}
        assert.equal((await request('customer', {...input, requestId: 'after-revoke'})).body.ok, false, 'fresh ACL after waiting on quota')
        console.log('PASS product search HTTP: actual common2 facade/OpenAPI from one schema, bearer, published-only fresh version, no admin route, tenant guard before quota and revoke during quota wait')
    } finally {
        await host.close()
        const resolved = path.resolve(directory)
        assert(resolved.startsWith(temporary + path.sep) && path.basename(resolved).startsWith('search-product-'))
        rmSync(resolved, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
