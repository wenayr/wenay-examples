import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createSupportRuntime} from '../apps/support/backend/runtime.ts'
import {createMachineSearch} from '../apps/support/backend/machine-search.ts'
import {createMeteredExecution} from '../apps/support/backend/metered-execution.ts'
import {openAiCheckpoint} from '../apps/support/backend/ai-checkpoint.ts'
import {createMeteringRuntime} from '../apps/metering/backend/runtime.ts'

const script = fileURLToPath(import.meta.url)
const repository = path.resolve(path.dirname(script), '..')
const require = createRequire(path.join(repository, 'apps/support/package.json'))
const {createServiceLeaderHost} = require('wenay-common2/service/host')
const {createServiceClient, describeService} = require('wenay-common2/service/client')
const {createAiRunHost} = require('wenay-common2/ai')
const parent = path.join(repository, 'apps/support/.test-data')
assert.equal(require('wenay-common2/package.json').version, '3.1.1')
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
function currentDenial(error) {
    const message = String(error?.message ?? error)
    assert.doesNotMatch(message, /Timeout:|timed out|E_RESOURCE_TIMEOUT/i)
    return /Ключ поиска недействителен|Resource generation is closed|Resource access denied|E_RESOURCE_(CLOSED|DENIED)/.test(message)
}
function gate() {
    let release, entered = false
    const pending = new Promise(resolve => {release = resolve})
    return {release: () => release(), entered: () => entered, async wait(signal) {
        entered = true
        let abort
        try {
            signal.throwIfAborted()
            await Promise.race([pending, new Promise(function cancelled(_resolve, reject) {
                abort = () => reject(signal.reason)
                signal.addEventListener('abort', abort, {once: true})
            })])
            signal.throwIfAborted()
        } finally {if (abort) signal.removeEventListener('abort', abort)}
    }}
}
async function main() {
    const directory = path.resolve(process.argv[3] ?? '')
    assert.equal(path.dirname(directory), parent)
    assert(path.basename(directory).startsWith('machine-search-proof-'))
    const creating = [], clients = [], resources = []
    let actual, closing = false, executions = 0, held
    const orgId = 'northstar'
    let clock = Date.now()
    async function start(runtime, name, metering = false) {
        const pending = createServiceLeaderHost({definition: runtime.definition,
            env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, name)},
            mount({app, leader}) {
                app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
                if (metering) return runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
                return runtime.mount(leader.line.control.store, leader.corridor.system)
            }}).then(async function created(host) {
                if (closing) await host.close()
                return host
            })
        creating.push(pending)
        return bounded('Native host', pending)
    }
    async function client(runtime, host, account, password) {
        const session = createServiceClient({definition: describeService(runtime.definition), url: host.url,
            auth: {credentials: {account, password}}, log() {}})
        clients.push(session)
        await bounded('Native login', session.ready())
        return session
    }
    async function resource(session, name) {
        const owner = session.resources.open(name)
        resources.push(owner)
        await until('Resource ' + name, () => !!owner.current())
        return {owner, control: owner.current().remote.control}
    }
    const machineUsage = {async settled(input, operation) {
        if (held) await held.wait(input.signal)
        return actual.settled(input, async function execute() {
            executions++
            return operation()
        })
    }}
    function support(name, limits = {total: 1, active: 1}) {
        return createSupportRuntime({directory: path.join(directory, name, 'jobs'), now: () => clock,
            usage: {run: (...args) => actual.run(...args)}, machineUsage, machineLimits: limits})
    }
    async function terminal(product, id) {
        let status
        await until('Terminal search', async function completed() {
            status = await bounded('Search status', product.control.status({orgId, id}))
            if (status.state == 'failed') throw new Error(status.error)
            return status.state == 'completed'
        })
        return status
    }
    try {
        const counterRuntime = createMeteringRuntime()
        const counter = await start(counterRuntime, 'counter', true)
        const billingOwner = await client(counterRuntime, counter, 'owner', 'owner-pass')
        const keys = await resource(billingOwner, 'keys')
        const billingKey = await bounded('Billing key', keys.control.issue({orgId, requestId: 'shared', label: 'Support machine jobs',
            scopes: ['usage:read', 'usage:write'], days: 1}))
        assert(billingKey.secret)
        const writer = await client(counterRuntime, counter, billingKey.account, billingKey.secret)
        const reading = await resource(writer, 'usage')
        actual = createMeteredExecution({targets: {northstar: {url: counter.url, account: billingKey.account, secret: billingKey.secret}}})
        const jobs = []
        for (const name of ['support-a', 'support-b']) {
            const runtime = support(name)
            const host = await start(runtime, name)
            const owner = await client(runtime, host, 'owner', 'owner-pass')
            const productKeys = await resource(owner, 'productKeys')
            const issued = await bounded('Machine key', productKeys.control.issue({orgId, requestId: 'same-machine', label: 'Knowledge jobs',
                scopes: ['knowledge:search'], days: 1}))
            const machine = await client(runtime, host, issued.account, issued.secret)
            let product = await resource(machine, 'productSearchJobs')
            const request = Object.freeze({orgId, query: 'приглашение', limit: 1, requestId: 'same-search'})
            if (name == 'support-a') held = gate()
            const accepted = await bounded('Search start', product.control.start(request))
            if (held) {
                await until('Accepted barrier', () => held.entered())
                await bounded('Ordinary resource close', product.owner.close())
                product = await resource(machine, 'productSearchJobs')
                held.release()
                held = undefined
            }
            const status = await terminal(product, accepted.id)
            const result = await bounded('Search result', product.control.result({orgId, id: accepted.id}))
            assert.equal(result.items[0].id, 'article-invite')
            const eventId = 'support-search-' + accepted.id
            const receipt = await bounded('Original receipt', writer.commands.usageSettle('settle-' + eventId, {eventId, units: 1}))
            assert.deepEqual(status.usageReceipt, receipt)
            assert.deepEqual(result.usageReceipt, receipt)
            assert.equal((await bounded('Retry at cap', product.control.start(request))).id, accepted.id)
            await assert.rejects(bounded('New request at cap', product.control.start({...request, requestId: 'new'})), /capacity reached/)
            await assert.rejects(bounded('Full payload conflict', product.control.start({...request, query: 'изменение'})),
                /requestId reused with different input/)
            jobs.push({name, runtime, host, owner, machine, productKeys, issued, request, accepted, receipt, product})
        }
        const [a, b] = jobs
        assert.equal(a.issued.account, b.issued.account)
        assert.notEqual(a.accepted.id, b.accepted.id)
        assert.equal(executions, 2)
        const totals = await bounded('Real cost2', reading.control.read({period: a.receipt.period, limit: 100}))
        assert.equal(totals.events.length, 2)
        assert.deepEqual(totals.events.map(event => event.eventId).sort(), jobs.map(job => 'support-search-' + job.accepted.id).sort())
        assert.equal(totals.totals.used, 2)
        assert.equal(totals.totals.reserved, 0)
        assert(totals.events.every(event => event.keyId == billingKey.id && event.status == 'committed'))
        await bounded('Close restart resource', a.product.owner.close())
        a.machine.close()
        await bounded('Stop A', a.host.close())
        const runtime = support(a.name)
        const host = await start(runtime, a.name)
        const machine = await client(runtime, host, a.issued.account, a.issued.secret)
        const restored = await resource(machine, 'productSearchJobs')
        assert.equal((await bounded('Restart exact retry', restored.control.start(a.request))).id, a.accepted.id)
        assert.deepEqual((await bounded('Restart result', restored.control.result({orgId, id: a.accepted.id}))).usageReceipt, a.receipt)
        assert.equal(executions, 2)
        const owner = await client(runtime, host, 'owner', 'owner-pass')
        await bounded('Source withdrawal', owner.commands.articlePublish('withdraw', {orgId, id: 'article-invite', revision: 1, status: 'archived'}))
        await assert.rejects(bounded('Withdrawn result', restored.control.result({orgId, id: a.accepted.id})), /changed or withdrawn/)
        await assert.rejects(bounded('Withdrawn receipt', restored.control.status({orgId, id: a.accepted.id})), /changed or withdrawn/)
        assert.equal((await bounded('Withdrawn identity retry', restored.control.start(a.request))).id, a.accepted.id)
        await bounded('Current revoke B', b.owner.commands.productKeyRevoke('revoke-b', {orgId, id: b.issued.id}))
        await assert.rejects(bounded('Retained revoked result', b.product.control.result({orgId, id: b.accepted.id})), currentDenial)
        const cRuntime = support('support-c', {total: 10, active: 1, bytes: 4096})
        const cHost = await start(cRuntime, 'support-c')
        const cOwner = await client(cRuntime, cHost, 'owner', 'owner-pass')
        const cKeys = await resource(cOwner, 'productKeys')
        const issued = await bounded('C key', cKeys.control.issue({orgId, requestId: 'c', label: 'Failure branches',
            scopes: ['knowledge:search'], days: 1}))
        const cMachine = await client(cRuntime, cHost, issued.account, issued.secret)
        const cProduct = await resource(cMachine, 'productSearchJobs')
        const article = await bounded('Wide article', cOwner.commands.articleSave('wide', {orgId, id: '', revision: 0,
            title: 'wideword', body: 'wideword ' + 'x'.repeat(6000)}))
        await bounded('Publish wide', cOwner.commands.articlePublish('wide-publish', {orgId, ...article, status: 'published'}))
        const wide = await bounded('Oversize start', cProduct.control.start({orgId, query: 'wideword', limit: 1, requestId: 'oversize'}))
        let wideState
        await until('Oversize refused', async function failed() {
            wideState = await bounded('Oversize status', cProduct.control.status({orgId, id: wide.id}))
            return wideState.state == 'failed'
        })
        assert.match(wideState.error, /UTF8 envelope/)
        held = gate()
        const revoked = await bounded('Accepted revoke job', cProduct.control.start({orgId, query: 'приглашение', limit: 1,
            requestId: 'pending-revoke'}))
        await until('Revoke barrier', () => held.entered())
        await bounded('Revoke pending key', cOwner.commands.productKeyRevoke('revoke-pending', {orgId, id: issued.id}))
        const checkpointDirectory = path.join(directory, 'support-c/jobs/machine-search')
        await until('Revoked job failed', () => openAiCheckpoint({directory: checkpointDirectory}).initial.store.runs[revoked.id].state == 'failed')
        held = undefined
        const expiredKey = await bounded('Expiry key', cKeys.control.issue({orgId, requestId: 'expiry', label: 'Expiry branch',
            scopes: ['knowledge:search'], days: 1}))
        const expiredMachine = await client(cRuntime, cHost, expiredKey.account, expiredKey.secret)
        const expiredProduct = await resource(expiredMachine, 'productSearchJobs')
        held = gate()
        const expired = await bounded('Accepted expiry job', expiredProduct.control.start({orgId, query: 'приглашение', limit: 1, requestId: 'expiry'}))
        await until('Expiry barrier', () => held.entered())
        clock = expiredKey.expiresAt + 1
        await until('Expired job failed', () => openAiCheckpoint({directory: checkpointDirectory}).initial.store.runs[expired.id].state == 'failed')
        held = undefined
        await assert.rejects(bounded('Expired retained result', expiredProduct.control.result({orgId, id: expired.id})), currentDenial)
        assert.equal(executions, 2)
        assert.equal((await bounded('No failure billing', reading.control.read({period: a.receipt.period, limit: 100}))).events.length, 2)
        const invalidDirectory = path.join(directory, 'invalid-machine')
        const invalidCheckpoint = path.join(invalidDirectory, 'machine-search')
        const seed = createAiRunHost({...openAiCheckpoint({directory: invalidCheckpoint}),
            capabilities: [{kind: 'publishedSearch'}], runner: {run() {return {result: {syntheticCompatibilitySeed: true}}}}})
        try {
            const connection = seed.connection(a.issued.account)
            const run = connection.fragment.createRun({requestId: 'mismatched', kind: 'publishedSearch', resourceIds: ['harbor'],
                input: {orgId, query: 'приглашение', limit: 1, requestId: 'mismatched'}})
            await until('Durable invalid seed', () => openAiCheckpoint({directory: invalidCheckpoint}).initial.store.runs[run.id].state == 'completed')
            connection.close()
        } finally {seed.close()}
        assert.throws(() => createMachineSearch({directory: invalidDirectory, search() {throw new Error('No search on invalid archive')}}),
            /Invalid saved machine search request/)
        console.log('PASS actual Support machine jobs/Counter cost2/receipts/restart/caps/conflict/close/revoke/expiry/withdrawal/size/invalid checkpoint boot refusal')
    } finally {
        closing = true
        held?.release()
        const stopped = await Promise.allSettled([Promise.resolve().then(() => actual?.close())])
        stopped.push(...await Promise.allSettled(resources.reverse().map(async owner => bounded('Resource cleanup', owner.close(), 2000))))
        stopped.push(...await Promise.allSettled(clients.map(async session => session.close())))
        stopped.push(...await Promise.allSettled(creating.map(async pending => {
            const host = await bounded('Late host', pending, 2000)
            await bounded('Host cleanup', host.close(), 2000)
        })))
        const failed = stopped.filter(result => result.status == 'rejected')
        if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Native cleanup failed')
    }
}
async function supervised() {
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'machine-search-proof-'))
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
        try {assert.equal(await bounded('Overall Support machine proof', stopped, 30000), 0)}
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
            assert(path.basename(directory).startsWith('machine-search-proof-'))
            rmSync(directory, {recursive: true, force: true})
        } else console.error('Unconfirmed stop; own archive retained: ' + directory)
    }
}
if (process.argv[2] == '--child') await main()
else await supervised()
