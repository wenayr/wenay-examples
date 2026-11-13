import assert from 'node:assert/strict'
import {execFileSync, spawn} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {openAiCheckpoint} from '../apps/support/backend/ai-checkpoint.ts'
import {createMeteredExecution} from '../apps/support/backend/metered-execution.ts'
import {createMeteringRuntime} from '../apps/metering/backend/runtime.ts'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = fileURLToPath(import.meta.url)
const require = createRequire(path.join(repository, 'apps/support/package.json'))
const {createAiRunHost} = require('wenay-common2/ai')
const {createServiceLeaderHost} = require('wenay-common2/service/host')
const {createServiceClient, describeService} = require('wenay-common2/service/client')
assert.equal(require('wenay-common2/package.json').version, '3.1.1')

async function until(label, test) {
    const deadline = Date.now() + 10000
    while (!await test()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await delay(20)
    }
}
async function bounded(label, operation, milliseconds = 4000) {
    let timer
    try {
        return await Promise.race([operation, new Promise(function deadline(_resolve, reject) {
            timer = setTimeout(() => reject(new Error('Timeout: ' + label)), milliseconds)
        })])
    } finally {clearTimeout(timer)}
}
async function main() {
    const parent = path.join(repository, 'apps/support/.test-data')
    const directory = path.resolve(process.argv[3] ?? '')
    assert.equal(path.dirname(directory), parent)
    assert(path.basename(directory).startsWith('usage-ai-proof-'))
    const clients = [], resources = [], aiHosts = []
    let counter, usage, creating
    let closing = false
    let executions = 0, permitted = true, failTerminal = false
    const owner = 'fixture-machine'
    const policy = {
        canRead: (account, run) => permitted && account == owner && run.owner == owner,
        canWrite: (account, run) => permitted && account == owner && run.owner == owner,
        canCreate: (account, request) => permitted && account == owner && request.kind == 'search'
    }
    async function client(account, password) {
        const session = createServiceClient({definition: describeService(runtime.definition), url: counter.url,
            auth: {credentials: {account, password}}, log() {}})
        clients.push(session)
        await bounded('native login', session.ready())
        return session
    }
    const runtime = createMeteringRuntime()
    function createRun(connection, request) {
        return bounded('native create/retry', Promise.resolve().then(() => connection.fragment.createRun(request)))
    }
    function host(name) {
        const checkpoint = openAiCheckpoint({directory: path.join(directory, name)})
        const native = createAiRunHost({...checkpoint, policy, history: 5,
            capabilities: [{kind: 'search'}],
            persistence: {commit(next) {
                if (failTerminal && Object.values(next.store.runs).some(run => run.state == 'completed')) {
                    throw new Error('Controlled terminal checkpoint refusal')
                }
                return checkpoint.persistence.commit(next)
            }}, runner: {async run({run, input}) {
                executions++
                const outcome = await usage.settled({orgId: 'northstar', eventId: 'ai-proof-' + name + '-' + run.id,
                    metric: 'search', reference: run.requestId, units: 1, signal: AbortSignal.timeout(8000)},
                async function localFixture() {return {items: [{id: 'fixture-article', revision: 1, query: input.query}]}})
                return {result: {orgId: 'northstar', owner, ...outcome.value, usageReceipt: outcome.receipt}}
            }}})
        aiHosts.push(native)
        return native
    }
    try {
        creating = createServiceLeaderHost({definition: runtime.definition,
            env: {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, 'counter')},
            mount({app, leader}) {
                app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
                return runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
            }}).then(async function created(value) {
                counter = value
                if (closing) await value.close()
                return value
            })
        counter = await bounded('native Counter creation', creating)
        const billingOwner = await client('owner', 'owner-pass')
        const keys = billingOwner.resources.open('keys')
        resources.push(keys)
        await until('native owner keys', () => !!keys.current())
        const issued = await bounded('native issue', keys.current().remote.control.issue({requestId: 'usage-ai-proof', orgId: 'northstar',
            label: 'Isolated AI checkpoint proof', scopes: ['usage:read', 'usage:write'], days: 1}))
        assert(issued.secret)
        const writer = await client(issued.account, issued.secret)
        const reading = writer.resources.open('usage')
        resources.push(reading)
        await until('native Counter read', () => !!reading.current())
        usage = createMeteredExecution({targets: {northstar: {url: counter.url, account: issued.account, secret: issued.secret}}})
        const request = Object.freeze({requestId: 'terminal', kind: 'search',
            input: Object.freeze({orgId: 'northstar', query: 'Fixture', limit: 1}), resourceIds: Object.freeze(['northstar'])})
        const first = host('completed')
        const connection = first.connection(owner)
        const started = await createRun(connection, request)
        await until('durable terminal', () => first.store.state.runs[started.id].state == 'completed')
        const completed = await createRun(connection, request)
        assert.equal(completed.result.usageReceipt.status, 'committed')
        assert.equal(completed.result.usageReceipt.eventId, 'ai-proof-completed-' + started.id)
        assert.equal(completed.result.usageReceipt.orgId, 'northstar')
        assert.equal(executions, 1)
        connection.close()
        first.close()
        const restored = host('completed')
        const repeat = restored.connection(owner)
        assert.deepEqual(await createRun(repeat, request), completed)
        await assert.rejects(createRun(repeat, {...request, input: {...request.input, query: 'Changed'}}), /different input/)
        assert.equal(executions, 1)
        permitted = false
        await assert.rejects(createRun(repeat, request), /forbidden/)
        permitted = true
        repeat.close()
        restored.close()
        failTerminal = true
        const gap = host('gap')
        const gapConnection = gap.connection(owner)
        const gapRequest = {...request, requestId: 'gap'}
        const gapRun = await createRun(gapConnection, gapRequest)
        await until('controlled persistence refusal', function refused() {
            const current = gap.store.state.runs[gapRun.id]
            if (current.state == 'failed' && !gap.persistence.error()) {
                throw new Error('Gap run failed before checkpoint refusal: ' + JSON.stringify({id: current.id, state: current.state, error: current.error}))
            }
            return !!gap.persistence.error()
        })
        assert.equal(executions, 2)
        assert.equal(gap.store.state.runs[gapRun.id].result, undefined)
        gapConnection.close()
        gap.close()
        failTerminal = false
        const recovered = host('gap')
        assert.equal(recovered.recovery.pending().length, 1)
        assert.equal(recovered.store.state.runs[gapRun.id].result, undefined)
        assert.equal(executions, 2)
        permitted = false
        assert.throws(() => recovered.recovery.settle(gapRun.id, {state: 'failed', error: 'Unresolved committed usage'}), /forbidden/)
        permitted = true
        recovered.recovery.settle(gapRun.id, {state: 'failed', error: 'Unresolved committed usage; no automatic rerun'})
        assert.equal(recovered.recovery.pending().length, 0)
        const period = completed.result.usageReceipt.period
        const state = await bounded('native Counter read', reading.current().remote.control.read({period, limit: 100}))
        assert.equal(state.events.length, 2)
        assert.deepEqual(state.events.map(event => event.eventId).sort(),
            ['ai-proof-completed-' + started.id, 'ai-proof-gap-' + gapRun.id].sort())
        assert(state.events.every(event => event.status == 'committed' && event.units == 1))
        assert.equal(state.totals.used, 2)
        assert.equal(state.totals.reserved, 0)
        assert.equal(executions, 2)
        console.log('PASS real Counter + native AI terminal receipt restart/exact retry/conflict/current policy + committed gap/no automatic rerun')
    } finally {
        closing = true
        const stopped = await Promise.allSettled(aiHosts.map(async native => native.close()))
        stopped.push(...await Promise.allSettled([Promise.resolve().then(() => usage?.close())]))
        stopped.push(...await Promise.allSettled(resources.reverse().map(async resource => bounded('resource close', resource.close(), 2000))))
        stopped.push(...await Promise.allSettled(clients.map(async session => session.close())))
        stopped.push(...await Promise.allSettled([bounded('Counter close', Promise.resolve().then(async function closeCounter() {
            if (creating) await creating
            await counter?.close()
        }), 2000)]))
        const failures = stopped.filter(result => result.status == 'rejected')
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Native fixture cleanup failed')
    }
}
async function supervised() {
    const parent = path.join(repository, 'apps/support/.test-data')
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'usage-ai-proof-'))
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
        try {assert.equal(await bounded('overall native proof', stopped, 25000), 0)}
        finally {
            if (!exited && child.pid) {
                if (process.platform == 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
                    {windowsHide: true, timeout: 3000, stdio: 'pipe'})
                else process.kill(-child.pid, 'SIGKILL')
                await bounded('owned process tree stop', stopped, 2000)
            }
        }
    } finally {
        if (!child || exited) {
            assert.equal(path.dirname(directory), parent)
            assert(path.basename(directory).startsWith('usage-ai-proof-'))
            rmSync(directory, {recursive: true, force: true})
        } else console.error('Unconfirmed fixture process stop; archive retained: ' + directory)
    }
}
if (process.argv[2] == '--child') await main()
else await supervised()
