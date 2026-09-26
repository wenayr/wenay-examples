import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createMeteringRuntime} from './runtime'
import {createDocumentRuntime} from '../../documents/backend/runtime'
import {createDocumentProcessor} from '../../documents/backend/processing-resource'
import {createMeteredExecution, meteringTargets} from '../../documents/backend/metered-execution'

async function until(label: string, test: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 10000
    while (!await test()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await delay(20)
    }
}

async function main() {
    const parent = path.resolve('.test-data')
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'documents-counter-'))
    const hosts: {close(): Promise<void>}[] = []
    const sessions: {close(): void}[] = []
    const resources: {close(): Promise<void>}[] = []
    let usage: ReturnType<typeof createMeteredExecution> | undefined
    let executions = 0
    let uncertainAttempts = 0
    let afterSettle: ((eventId: string) => void) | undefined
    function env(name: string) {
        return {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, name)}
    }
    try {
        const counterRuntime = createMeteringRuntime()
        const commands = counterRuntime.definition.commands
        const definition = {...counterRuntime.definition, commands: {...commands,
            usageSettle: {...commands.usageSettle, apply(ctx: Parameters<typeof commands.usageSettle.apply>[0],
                input: Parameters<typeof commands.usageSettle.apply>[1]) {
                const receipt = commands.usageSettle.apply(ctx, input)
                afterSettle?.(input.eventId)
                return receipt
            }},
            usageUncertain: {...commands.usageUncertain, apply(ctx: Parameters<typeof commands.usageUncertain.apply>[0],
                input: Parameters<typeof commands.usageUncertain.apply>[1]) {
                uncertainAttempts++
                return commands.usageUncertain.apply(ctx, input)
            }}
        }}
        const counter = await createServiceLeaderHost({definition, env: env('counter'), mount({app, leader}) {
            app.get('/api/client', function descriptor(_request, response) {response.json(describeService(counterRuntime.definition))})
            return counterRuntime.mount({store: leader.line.control.store, system: leader.corridor.system})
        }})
        hosts.push(counter)
        async function counterClient(account: string, password: string) {
            const client = createServiceClient({definition: describeService(counterRuntime.definition), url: counter.url,
                auth: {credentials: {account, password}}, log() {}})
            sessions.push(client)
            await client.ready()
            return client
        }
        const billingOwner = await counterClient('owner', 'owner-pass')
        const counterKeys = billingOwner.resources.open('keys')
        resources.push(counterKeys)
        await until('Counter owner keys', () => !!counterKeys.current())
        const writerKey = await counterKeys.current()!.remote.control.issue({requestId: 'documents-machine-counter', orgId: 'northstar',
            label: 'Documents authority', scopes: ['usage:read', 'usage:write'], days: 1})
        assert(writerKey.secret)
        const writer = await counterClient(writerKey.account, writerKey.secret)
        const read = writer.resources.open('usage')
        resources.push(read)
        await until('Counter scoped read', () => !!read.current())
        const counterRead = read.current()!.remote.control
        assert.equal((await counterRead.identity()).orgId, 'northstar')
        const targets = meteringTargets(JSON.stringify({northstar: {url: counter.url, account: writerKey.account, secret: writerKey.secret}}))!
        usage = createMeteredExecution({targets})
        const processingDirectory = path.join(directory, 'processing')
        const processor = createDocumentProcessor({directory: processingDirectory})
        const documentRuntime = createDocumentRuntime({directory: processingDirectory, usage,
            processor: {async extract(input) {
                executions++
                return processor.extract(input)
            }}})
        const documents = await createServiceLeaderHost({definition: documentRuntime.definition, env: env('documents'), mount({leader}) {
            return documentRuntime.mount({store: leader.line.control.store, execute: leader.corridor.system})
        }})
        hosts.push(documents)
        async function documentClient(account: string, password: string) {
            const client = createServiceClient({definition: describeService(documentRuntime.definition), url: documents.url,
                auth: {credentials: {account, password}}, log() {}})
            sessions.push(client)
            await client.ready()
            return client
        }
        const documentOwner = await documentClient('owner', 'owner-pass')
        const documentKeys = documentOwner.resources.open('productKeys')
        resources.push(documentKeys)
        await until('Documents owner keys', () => !!documentKeys.current())
        const ownerKeys = documentKeys.current()!.remote.control
        const issued = await ownerKeys.issue({requestId: 'counter-document-machine', orgId: 'northstar', label: 'CSV consumer',
            scopes: ['documents:extract'], days: 1})
        assert(issued.secret)
        const machine = await documentClient(issued.account, issued.secret)
        const resource = machine.resources.open('productDocuments')
        resources.push(resource)
        await until('Documents machine resource', () => !!resource.current())
        const product = resource.current()!.remote.control
        const orgId = 'northstar'
        const bytes = Buffer.from('name,amount\nActual Counter,42')
        const file = await product.upload({orgId, name: 'counter.csv', bytes})
        const request = Object.freeze({orgId, ...file, processor: 'node', requestId: 'counter-native-start'})
        const started = await product.start(request)
        const reference = {orgId, id: file.id}
        await until('machine CSV result', async function ready() {
            return (await product.status(reference)).status == 'review'
        })
        const status = await product.status(reference)
        const result = await product.result({...reference, revision: status.revision})
        assert.deepEqual(result.table.rows, [['Actual Counter', '42']])
        assert.equal(executions, 1)
        const eventId = 'documents-' + started.runId
        const period = new Date().toISOString().slice(0, 7)
        const reading = await counterRead.read({period, limit: 100})
        assert.equal(reading.events.length, 1)
        const event = reading.events[0]
        assert.equal(event.eventId, eventId)
        assert.equal(event.orgId, orgId)
        assert.equal(event.keyId, writerKey.id)
        assert.equal(event.metric, 'document')
        assert.equal(event.reference, file.id)
        assert.equal(event.status, 'committed')
        assert.equal(event.units, 1)
        assert.equal(reading.totals.used, 1)
        assert.equal(reading.totals.reserved, 0)
        assert.equal(reading.totals.active, 0)
        const counterInput = Object.freeze({eventId, metric: 'document' as const, units: 1, reference: file.id})
        const receipt = await writer.commands.usageReserve('inspect-existing-event', counterInput)
        assert.equal(receipt.id, event.id)
        assert.equal(receipt.eventId, eventId)
        assert.equal(receipt.orgId, orgId)
        assert.equal(receipt.status, 'committed')
        assert.equal(receipt.units, 1)
        assert.equal(receipt.fresh, false, 'a new native requestId must not grant execution for an existing event')
        assert.equal((await product.start(request)).runId, started.runId)
        await assert.rejects(product.start({...request, processor: 'model'}))
        await assert.rejects(writer.commands.usageReserve('conflicting-event-content', {...counterInput, units: 2}))
        assert.equal(executions, 1)
        assert(!Object.hasOwn(result, 'receipt') && !Object.hasOwn(result, 'accounting'), 'Q05 product receipt linkage is still absent')
        assert(!Object.hasOwn(status, 'receipt') && !Object.hasOwn(status, 'accounting'))
        const beforeRevoke = await counterRead.read({period, limit: 100})
        assert.equal(beforeRevoke.events.length, 1)
        assert.equal(beforeRevoke.totals.used, 1)
        const handoffEventId = 'typed-' + started.runId
        const signal = new AbortController().signal
        const handoffInput = {orgId, eventId: handoffEventId, metric: 'document' as const, reference: file.id, units: 1, signal}
        const handoffRetry = Object.freeze({...handoffInput})
        let handoffExecutions = 0
        async function typedCsv() {
            handoffExecutions++
            handoffInput.eventId = 'caller-mutated-after-reserve'
            handoffInput.units = 2
            return processor.extract({name: 'typed.csv', bytes, processor: 'node', signal})
        }
        const outcome = await usage.settled(handoffInput, typedCsv)
        assert.deepEqual(outcome.value.rows, result.table.rows)
        assert.equal(outcome.receipt.eventId, handoffEventId)
        assert.equal(outcome.receipt.orgId, orgId)
        assert.equal(outcome.receipt.status, 'committed')
        assert.equal(outcome.receipt.units, 1)
        const actualSettleReply = await writer.commands.usageSettle('settle-' + handoffEventId, {eventId: handoffEventId, units: 1})
        assert.deepEqual(outcome.receipt, actualSettleReply, 'settled returns the real native reply, including its original fresh flag')
        await assert.rejects(usage.settled(handoffRetry, typedCsv), /уже зарегистрирована/)
        assert.equal(handoffExecutions, 1)
        const lateAbort = new AbortController()
        const lateEventId = 'confirmed-abort-' + started.runId
        afterSettle = function abortConfirmed(eventId) {
            if (eventId == lateEventId) lateAbort.abort(new Error('Fixture consumer cancelled after actual Counter commit'))
        }
        await assert.rejects(usage.settled({...handoffRetry, eventId: lateEventId, signal: lateAbort.signal}, async function lateCsv() {
            return processor.extract({name: 'confirmed.csv', bytes, processor: 'node', signal: lateAbort.signal})
        }), /cancelled after actual Counter commit/)
        afterSettle = undefined
        assert.equal(uncertainAttempts, 0, 'confirmed settle followed by a late signal error must never attempt usageUncertain')
        const typedReading = await counterRead.read({period, limit: 100})
        assert.equal(typedReading.events.find(event => event.eventId == lateEventId)?.status, 'committed')
        assert.equal(typedReading.events.length, 3)
        assert.equal(typedReading.totals.used, 3)
        assert.equal(typedReading.totals.reserved, 0)
        assert.equal(typedReading.totals.active, 0)
        await ownerKeys.revoke({orgId, id: issued.id})
        await assert.rejects(product.start(request), 'product revoke must reject even a retained native run receipt')
        await assert.rejects(product.result({...reference, revision: status.revision}))
        assert.equal(executions, 1)
        const active = await ownerKeys.issue({requestId: 'counter-revoked-consumer', orgId, label: 'Still-live product credential',
            scopes: ['documents:extract'], days: 1})
        const activeSession = await documentClient(active.account, active.secret!)
        const activeResource = activeSession.resources.open('productDocuments')
        resources.push(activeResource)
        await until('live product with revoked Counter key', () => !!activeResource.current())
        const activeProduct = activeResource.current()!.remote.control
        const deniedFile = await activeProduct.upload({orgId, name: 'denied-by-counter.csv', bytes})
        await billingOwner.commands.keyRevoke('revoke-counter-writer', {orgId, id: writerKey.id})
        // The adapter used this native settle receipt ID. Current RPC rights must reject its retained repeat after revoke.
        await assert.rejects(writer.commands.usageSettle('settle-' + eventId, {eventId, units: 1}))
        await assert.rejects(counterRead.read({period, limit: 100}))
        await activeProduct.start({orgId, ...deniedFile, processor: 'node', requestId: 'counter-denied-start'})
        await until('Counter refusal visible in product', async function failed() {
            return (await activeProduct.status({orgId, id: deniedFile.id})).status == 'failed'
        })
        assert.equal(executions, 1, 'revoked actual Counter credential must block extraction, even with a live product key')
        const finalEvents = Object.values(counter.leader.line.control.store.state.events)
        assert.equal(finalEvents.length, 3)
        assert.equal(finalEvents.filter(event => event.eventId == eventId).length, 1)
        const totals = counter.leader.line.control.store.state.periods[orgId + ':' + period]
        assert.equal(totals.used, 3)
        assert.equal(totals.reserved, 0)
        assert.equal(totals.active, 0)
        console.log('PASS Q06-0 bounded proof: real Counter + Documents machine CSV, one actual event/receipt, totals, dedup and current revoke')
        console.log('PASS Q06-A typed handoff: settled value + actual native receipt, repeated event prevents IO; late abort after commit never calls uncertain')
        console.log('GAP CONFIRMED: product status/result contain no Counter receipt; no Q06 acceptance, restart/lost-response/Support proof yet')
    } finally {
        for (const resource of resources) await resource.close().catch(function closed() {})
        usage?.close()
        for (const session of sessions) session.close()
        for (const host of hosts.reverse()) await host.close()
        assert(path.dirname(path.resolve(directory)) == parent && path.basename(directory).startsWith('documents-counter-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
