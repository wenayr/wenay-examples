import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createDocumentRuntime} from './runtime'
import {createDocumentProductHttp, DOCUMENT_PRODUCT_INPUTS} from './product-http'
import {inputJsonSchema} from 'wenay-common2/service'

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'document-product-'))
    const runtime = createDocumentRuntime({directory})
    const host = await createServiceLeaderHost({definition: runtime.definition, env: {SERVICE_PORT: '0'}, mount({app, leader}) {
        createDocumentProductHttp({app, resource: runtime.definition.resources.processor, account: token => leader.access.principalOf(leader.identity.principal(token)).account})
        return runtime.mount({store: leader.line.control.store, execute: leader.corridor.system})
    }})
    const owner = createServiceClient({definition: describeService(runtime.definition), url: host.url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
    async function login(account: string) {
        const result = await fetch(host.url + '/api/documents/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account, password: account + '-pass'}]})}).then(response => response.json())
        assert(result.ok); return result.value.token as string
    }
    async function call(method: string, input: unknown, token = '', args?: unknown[]) {
        const response = await fetch(host.url + '/api/product/documents/' + method, {method: 'POST', headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})}, body: JSON.stringify({args: args ?? [input]})})
        assert.equal(response.headers.get('cache-control'), 'no-store')
        return {status: response.status, body: await response.json()}
    }
    try {
        await owner.ready(); await owner.views.workspace.ready
        const customer = await login('customer'), outsider = await login('outsider')
        const spec = await fetch(host.url + '/api/product/openapi.json').then(response => response.json())
        assert.deepEqual(Object.keys(spec.paths).sort(), Object.keys(DOCUMENT_PRODUCT_INPUTS).map(method => '/api/product/documents/' + method).sort())
        assert(!JSON.stringify(spec).includes('memberRole') && !JSON.stringify(spec).includes('documentApprove'))
        assert(JSON.stringify(spec).includes(JSON.stringify(inputJsonSchema(DOCUMENT_PRODUCT_INPUTS.upload))))
        const upload = {orgId: 'northstar', name: 'product.csv', base64: Buffer.from('name,amount\nProduct example,42').toString('base64')}
        assert.equal((await call('upload', upload)).status, 401)
        assert.equal((await call('upload', upload, 'invalid')).status, 401)
        assert.equal((await call('upload', upload, customer, ['owner', upload])).status, 400)
        assert.equal((await call('upload', {...upload, account: 'owner'}, customer)).body.ok, false)
        assert.equal((await call('upload', {...upload, base64: '%%%='}, customer)).body.ok, false)
        assert.equal((await call('upload', {...upload, base64: Buffer.alloc(512 * 1024 + 1).toString('base64')}, customer)).body.ok, false)
        assert.equal((await call('upload', upload, outsider)).body.ok, false)
        const imported = (await call('upload', upload, customer)).body; assert(imported.ok)
        assert.equal((await call('upload', upload, customer)).body.value.id, imported.value.id)
        const input = {orgId: 'northstar', id: imported.value.id, revision: imported.value.revision, processor: 'node', requestId: 'http-extract'}
        const started = (await call('start', input, customer)).body; assert(started.ok)
        let status: {id: string, revision: number, status: string, rowCount: number} | null = null
        const deadline = Date.now() + 5000
        while (status?.status != 'review') {assert(Date.now() < deadline); const result = (await call('status', {orgId: 'northstar', id: imported.value.id}, customer)).body; assert(result.ok); status = result.value; await delay(20)}
        assert.equal(status!.rowCount, 1)
        const extracted = (await call('result', {orgId: 'northstar', id: status!.id, revision: status!.revision}, customer)).body
        assert(extracted.ok); assert.equal(extracted.value.table.rows[0][1], '42')
        assert(!JSON.stringify(extracted.value).includes('blobId'))
        assert.equal((await call('start', input, customer)).body.value.runId, started.value.runId)
        assert.equal((await call('result', {orgId: 'northstar', id: status!.id, revision: 1}, customer)).body.ok, false)
        assert.equal((await call('result', {orgId: 'northstar', id: status!.id, revision: status!.revision}, outsider)).body.ok, false)
        await owner.commands.memberRole('product-revoke', {orgId: 'northstar', account: 'customer', role: 'revoked'})
        const revoked = await call('status', {orgId: 'northstar', id: status!.id}, customer)
        assert(revoked.status == 401 || revoked.body.ok == false)
        assert.equal((await fetch(host.url + '/api/product/documents/approve', {method: 'POST'})).status, 404)
        console.log('PASS document product HTTP: published common2 facade/OpenAPI with one input schema, bearer-derived account, exact upload/start/status/result surface, base64 limits, real extraction, source access, dedup/repeat, stale revision and live revoke; no review/admin routes')
    } finally {
        owner.close(); await host.close(); await delay(50)
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('document-product-')); rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
