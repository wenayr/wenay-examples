import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createDocumentRuntime} from '../apps/documents/backend/runtime.ts'
import {createDocumentProcessor} from '../apps/documents/backend/processing-resource.ts'
import {openAiCheckpoint} from '../apps/documents/backend/ai-checkpoint.ts'
import {createMeteredExecution} from '../apps/documents/backend/metered-execution.ts'
import {createMeteringRuntime} from '../apps/metering/backend/runtime.ts'

const script = fileURLToPath(import.meta.url)
const repository = path.resolve(path.dirname(script), '..')
const require = createRequire(path.join(repository, 'apps/documents/package.json'))
const {createServiceLeaderHost} = require('wenay-common2/service/host')
const {createServiceClient, describeService} = require('wenay-common2/service/client')
const {createAiRunHost} = require('wenay-common2/ai')
assert.equal(require('wenay-common2/package.json').version, '3.1.1')
const parent = path.join(repository, 'apps/documents/.test-data')
async function bounded(label, operation, milliseconds = 5000) {
    let timer
    try {
        return await Promise.race([operation, new Promise(function deadline(_resolve, reject) {
            timer = setTimeout(() => reject(new Error('Timeout: ' + label)), milliseconds)
        })])
    } finally {clearTimeout(timer)}
}
async function until(label, test) {
    const deadline = Date.now() + 10000
    while (!await test()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await delay(20)
    }
}
async function main() {
    const directory = path.resolve(process.argv[3] ?? '')
    assert.equal(path.dirname(directory), parent)
    assert(path.basename(directory).startsWith('producer-id-proof-'))
    const creating = [], clients = [], resources = []
    let usage, closing = false, executions = 0
    const orgId = 'northstar'
    async function start(runtime, name) {
        const pending = createServiceLeaderHost({definition: runtime.definition,
            env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, name)},
            mount({app, leader}) {
                app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
                return runtime.mount({store: leader.line.control.store, system: leader.corridor.system, execute: leader.corridor.system})
            }}).then(async function created(host) {
                if (closing) await host.close()
                return host
            })
        creating.push(pending)
        return bounded('native host start', pending)
    }
    async function client(runtime, host, account, password) {
        const session = createServiceClient({definition: describeService(runtime.definition), url: host.url,
            auth: {credentials: {account, password}}, log() {}})
        clients.push(session)
        await bounded('native login', session.ready())
        return session
    }
    async function resource(session, name) {
        const owner = session.resources.open(name)
        resources.push(owner)
        await until('native resource ' + name, () => !!owner.current())
        return {owner, control: owner.current().remote.control}
    }
    function documents(name) {
        const processing = path.join(directory, name, 'processing')
        const processor = createDocumentProcessor({directory: processing})
        return createDocumentRuntime({directory: processing, usage, processor: {async extract(input) {
            executions++
            return processor.extract(input)
        }}})
    }
    try {
        const counterRuntime = createMeteringRuntime()
        const counter = await start(counterRuntime, 'counter')
        const billingOwner = await client(counterRuntime, counter, 'owner', 'owner-pass')
        const keys = await resource(billingOwner, 'keys')
        const billingKey = await bounded('Counter key', keys.control.issue({orgId, requestId: 'shared-billing',
            label: 'Two independent Documents archives', days: 1, scopes: ['usage:read', 'usage:write']}))
        assert(billingKey.secret)
        const writer = await client(counterRuntime, counter, billingKey.account, billingKey.secret)
        const counterRead = await resource(writer, 'usage')
        usage = createMeteredExecution({targets: {northstar: {url: counter.url, account: billingKey.account, secret: billingKey.secret}}})
        const products = []
        for (const name of ['documents-a', 'documents-b']) {
            const runtime = documents(name)
            const host = await start(runtime, name)
            const owner = await client(runtime, host, 'owner', 'owner-pass')
            const productKeys = await resource(owner, 'productKeys')
            const issued = await bounded('Documents key', productKeys.control.issue({orgId, requestId: 'same-consumer',
                label: 'Same identity/request in independent archive', days: 1, scopes: ['documents:extract']}))
            assert(issued.secret)
            const machine = await client(runtime, host, issued.account, issued.secret)
            const product = await resource(machine, 'productDocuments')
            const file = await bounded('CSV upload', product.control.upload({orgId, name: 'same.csv', bytes: Buffer.from('name,amount\nUUID Counter,42')}))
            const request = Object.freeze({orgId, ...file, processor: 'node', requestId: 'same-start'})
            const started = await bounded('CSV start', product.control.start(request))
            assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(started.runId))
            const reference = {orgId, id: file.id}
            await until('CSV review', async function review() {
                const status = await bounded('CSV poll', product.control.status(reference))
                assert(!['failed', 'uncertain', 'cancelled'].includes(status.status), JSON.stringify(status))
                return status.status == 'review'
            })
            const status = await bounded('CSV status', product.control.status(reference))
            const result = await bounded('CSV result', product.control.result({...reference, revision: status.revision}))
            assert.deepEqual(result.table.rows, [['UUID Counter', '42']])
            const eventId = 'documents-' + started.runId
            const receipt = await bounded('Original settlement', writer.commands.usageSettle('settle-' + eventId, {eventId, units: 1}))
            assert.deepEqual(status.usageReceipt, receipt)
            assert.deepEqual(result.usageReceipt, receipt)
            products.push({name, runtime, host, machine, product, issued, request, started, reference, receipt})
        }
        const [a, b] = products
        assert.equal(a.issued.account, b.issued.account, 'same product identity across independent archives')
        assert.notEqual(a.started.runId, b.started.runId)
        assert.equal(executions, 2)
        const events = await bounded('Counter totals', counterRead.control.read({period: a.receipt.period, limit: 100}))
        assert.equal(events.events.length, 2)
        assert.deepEqual(events.events.map(event => event.eventId).sort(), products.map(item => 'documents-' + item.started.runId).sort())
        assert(events.events.every(event => event.keyId == billingKey.id && event.status == 'committed' && event.units == 1))
        assert.equal(events.totals.used, 2)
        assert.equal(events.totals.reserved, 0)
        assert.equal(events.totals.active, 0)
        await bounded('Close A resource', a.product.owner.close())
        a.machine.close()
        await bounded('Stop A archive', a.host.close())
        const restoredRuntime = documents(a.name)
        const restoredHost = await start(restoredRuntime, a.name)
        await bounded('Restored A ready', restoredRuntime.view.ready())
        const restoredMachine = await client(restoredRuntime, restoredHost, a.issued.account, a.issued.secret)
        const restored = await resource(restoredMachine, 'productDocuments')
        assert.equal((await bounded('Exact retry A', restored.control.start(a.request))).runId, a.started.runId)
        const status = await bounded('Restored status', restored.control.status(a.reference))
        assert.deepEqual(status.usageReceipt, a.receipt)
        assert.deepEqual((await bounded('Restored result', restored.control.result({...a.reference, revision: status.revision}))).usageReceipt, a.receipt)
        await assert.rejects(bounded('Changed payload', restored.control.start({...a.request, processor: 'model'})),
            /AI run create: requestId reused with different input/)
        assert.equal(executions, 2)
        await bounded('Close B resource', b.product.owner.close())
        b.machine.close()
        await bounded('Stop B archive', b.host.close())
        const checkpointDirectory = path.join(directory, b.name, 'processing/runs')
        const legacyRequest = {requestId: 'legacy', kind: 'extract', resourceIds: [b.request.id],
            input: {orgId, documentId: b.request.id, revision: b.request.revision, processor: 'node'}}
        const legacy = createAiRunHost({...openAiCheckpoint({directory: checkpointDirectory}), id: () => 'ai-1',
            runner: {run() {return {result: {available: true}}}}, capabilities: [{kind: 'extract'}]})
        let completedLegacy
        try {
            const connection = legacy.connection(b.issued.account)
            const old = connection.fragment.createRun(legacyRequest)
            await until('Legacy terminal seed', () => legacy.store.state.runs[old.id].state == 'completed')
            assert.equal(old.id, 'ai-1')
            completedLegacy = openAiCheckpoint({directory: checkpointDirectory}).initial.store.runs[old.id]
            assert.equal(completedLegacy.state, 'completed', 'legacy terminal checkpoint is durable before reopen')
            connection.close()
        } finally {legacy.close()}
        const legacyRuntime = documents(b.name)
        const legacyHost = await start(legacyRuntime, b.name)
        await bounded('Legacy production ready', legacyRuntime.view.ready())
        const legacyMachine = await client(legacyRuntime, legacyHost, b.issued.account, b.issued.secret)
        const legacyProduct = await resource(legacyMachine, 'productDocuments')
        assert.equal((await bounded('Legacy ai-N retry', legacyProduct.control.start({...b.request, requestId: 'legacy'}))).runId, 'ai-1')
        assert.equal((await bounded('Original UUID retry B', legacyProduct.control.start(b.request))).runId, b.started.runId)
        assert.equal(executions, 2, 'legacy seed and native retry never cause production extraction')
        const checkpoint = openAiCheckpoint({directory: checkpointDirectory}).initial
        assert.deepEqual(checkpoint.store.runs['ai-1'], completedLegacy)
        assert(checkpoint.store.runs[b.started.runId])
        console.log('PASS two independent production Documents archives/shared Counter key/distinct UUID events/cost2/restart exact receipt/no rerun/legacy ai-N preserved')
    } finally {
        closing = true
        const stopped = await Promise.allSettled([Promise.resolve().then(() => usage?.close())])
        stopped.push(...await Promise.allSettled(resources.reverse().map(async owner => bounded('Resource cleanup', owner.close(), 2000))))
        stopped.push(...await Promise.allSettled(clients.map(async session => session.close())))
        stopped.push(...await Promise.allSettled(creating.map(async pending => {
            const host = await bounded('Late host generation', pending, 2000)
            await bounded('Host cleanup', host.close(), 2000)
        })))
        const failures = stopped.filter(result => result.status == 'rejected')
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Owned native cleanup failure')
    }
}
async function supervised() {
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'producer-id-proof-'))
    let child, exited = false
    try {
        child = spawn(process.execPath, ['--import', pathToFileURL(require.resolve('tsx')).href, script, '--child', directory],
            {stdio: 'inherit', windowsHide: true, detached: process.platform != 'win32'})
        const stopped = new Promise(function exit(resolve, reject) {
            child.once('error', reject)
            child.once('close', function closed(code) {
                exited = true
                resolve(code)
            })
        })
        try {assert.equal(await bounded('Overall Documents producer proof', stopped, 30000), 0)}
        finally {
            if (!exited && child.pid) {
                if (process.platform == 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
                    {windowsHide: true, timeout: 3000, stdio: 'pipe'})
                else process.kill(-child.pid, 'SIGKILL')
                await bounded('Owned tree stop', stopped, 2000)
            }
        }
    } finally {
        if (!child || exited) {
            assert.equal(path.dirname(directory), parent)
            assert(path.basename(directory).startsWith('producer-id-proof-'))
            rmSync(directory, {recursive: true, force: true})
        } else console.error('Unconfirmed stop; own archive retained: ' + directory)
    }
}
if (process.argv[2] == '--child') await main()
else await supervised()
