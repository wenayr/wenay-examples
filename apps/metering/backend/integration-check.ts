import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createMeteringRuntime} from './runtime'
import {createSupportRuntime, type SupportDefinition} from '../../support/backend/runtime'
import {createDocumentRuntime, type DocumentDefinition} from '../../documents/backend/runtime'
import {createMeteredExecution, meteringTargets} from '../../support/backend/metered-execution'
import {createMeteredExecution as createDocumentsMeter} from '../../documents/backend/metered-execution'

async function until(label: string, predicate: () => boolean | Promise<boolean>) {
    const end = Date.now() + 16000
    while (!await predicate()) {
        assert(Date.now() < end, label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'saas-integration-'))
    const hosts: {close(): Promise<void>}[] = []
    const sessions: {close(): void}[] = []
    const resources: {close(): Promise<void>}[] = []
    const meters: ReturnType<typeof createMeteredExecution>[] = []
    const meterRuntime = createMeteringRuntime()
    const env = (name: string) => ({
        SERVICE_PORT: '0',
        SERVICE_HOST: '127.0.0.1',
        SERVICE_DATA_DIR: path.join(directory, name)
    })
    try {
        const read = (file: string) => readFileSync(path.resolve(file), 'utf8')
        assert.equal(read('backend/client-contract.ts'), read('../support/backend/metering-contract.ts'))
        assert.equal(read('../support/backend/metered-execution.ts'),
            read('../documents/backend/metered-execution.ts'))
        const billing = await createServiceLeaderHost({
            definition: meterRuntime.definition,
            env: env('metering'),
            mount({app, leader}) {
                app.get('/api/client', function descriptor(_request, response) {
                    response.json(describeService(meterRuntime.definition))
                })
                return meterRuntime.mount({
                    store: leader.line.control.store,
                    system: leader.corridor.system
                })
            }
        })
        hosts.push(billing)
        const owner = createServiceClient({
            definition: describeService(meterRuntime.definition),
            url: billing.url,
            auth: {credentials: {account: 'owner', password: 'owner-pass'}}
        })
        sessions.push(owner)
        await owner.ready()
        await owner.views.workspace.ready
        const keys = owner.resources.open('keys')
        resources.push(keys)
        await until('keys ready', () => !!keys.current())
        const issued = await keys.current()!.remote.control.issue({
            requestId: 'products',
            orgId: 'northstar',
            label: 'Two SaaS products',
            scopes: ['usage:write', 'usage:read'],
            days: 1
        })
        assert(issued.secret)
        const northstar = {url: billing.url, account: issued.account, secret: issued.secret}
        const targets = meteringTargets(JSON.stringify({northstar}))!
        const supportMeter = createMeteredExecution({targets})
        const documentsMeter = createDocumentsMeter({targets})
        meters.push(supportMeter, documentsMeter)
        const supportRuntime = createSupportRuntime({
            directory: path.join(directory, 'support-assistant'),
            usage: supportMeter
        })
        const support = await createServiceLeaderHost({
            definition: supportRuntime.definition,
            env: env('support'),
            mount({leader}) {return supportRuntime.mount(leader.line.control.store)}
        })
        hosts.push(support)
        const documentsRuntime = createDocumentRuntime({
            directory: path.join(directory, 'documents-processing'),
            usage: documentsMeter
        })
        const documents = await createServiceLeaderHost({
            definition: documentsRuntime.definition,
            env: env('documents'),
            mount({leader}) {
                return documentsRuntime.mount({
                    store: leader.line.control.store,
                    execute: leader.corridor.system
                })
            }
        })
        hosts.push(documents)
        const supportClient = createServiceClient<SupportDefinition>({
            definition: describeService(supportRuntime.definition),
            url: support.url,
            auth: {credentials: {account: 'agent', password: 'agent-pass'}}
        })
        const documentsClient = createServiceClient<DocumentDefinition>({
            definition: describeService(documentsRuntime.definition),
            url: documents.url,
            auth: {credentials: {account: 'customer', password: 'customer-pass'}}
        })
        sessions.push(supportClient, documentsClient)
        await supportClient.ready()
        await documentsClient.ready()
        const assistant = supportClient.resources.open('assistant')
        const processor = documentsClient.resources.open('processor')
        resources.push(assistant, processor)
        await until('product resources ready', () => !!assistant.current() && !!processor.current())
        const answer = await assistant.current()!.remote.ai.createRun({
            requestId: 'metered-answer',
            kind: 'answer',
            resourceIds: ['ticket-welcome'],
            input: {orgId: 'northstar', ticketId: 'ticket-welcome', revision: 1}
        })
        const events = () => owner.views.workspace.store.state.events
        await until('support usage committed', () => events().some(function committed(item) {
            return item.eventId == 'support-' + answer.id && item.status == 'committed'
        }))
        await until('support answer available', function ready() {
            return assistant.current()!.remote.control.result(answer.id).then(() => true).catch(() => false)
        })
        const draft = await assistant.current()!.remote.control.result(answer.id)
        assert(draft.sources.length && draft.demo)
        const file = await processor.current()!.remote.control.upload({
            orgId: 'northstar',
            name: 'usage.csv',
            bytes: Buffer.from('name,units\nHosting,12')
        })
        const extractRun = {
            requestId: 'metered-document',
            kind: 'extract' as const,
            resourceIds: [file.id],
            input: {orgId: 'northstar', documentId: file.id, revision: file.revision, processor: 'node'}
        }
        const extraction = await processor.current()!.remote.ai.createRun(extractRun)
        const stored = () => documents.leader.line.control.store.state.documents
        await until('document result', () => stored()[file.id].status == 'review')
        await until('two products accounted', function both() {
            return events().filter(item => item.status == 'committed').length == 2
        })
        const period = 'northstar:' + new Date().toISOString().slice(0, 7)
        assert.equal(billing.leader.line.control.store.state.periods[period].used, 2)
        assert.equal(stored()[file.id].table.rows[0][1], '12')
        const again = await processor.current()!.remote.ai.createRun(extractRun)
        assert.equal(again.id, extraction.id)
        let repeated = 0
        const duplicateUsage = {
            orgId: 'northstar',
            eventId: 'documents-' + extraction.id,
            metric: 'document' as const,
            units: 1,
            reference: file.id,
            signal: new AbortController().signal
        }
        await assert.rejects(documentsMeter.run(duplicateUsage, async function duplicate() {
            repeated++
            return 1
        }), /уже зарегистрирована/)
        assert.equal(repeated, 0)
        let mismatched = 0
        const incorrectMeter = createMeteredExecution({targets: {harbor: targets.northstar}})
        meters.push(incorrectMeter)
        const crossTenantUsage = {
            orgId: 'harbor',
            eventId: 'wrong-tenant',
            metric: 'search' as const,
            units: 1,
            reference: '',
            signal: new AbortController().signal
        }
        await assert.rejects(incorrectMeter.run(crossTenantUsage, async function crossTenant() {
            mismatched++
            return 1
        }), /не соответствует/)
        assert.equal(mismatched, 0)
        await owner.commands.budgetConfigure('exhaust-quota', {orgId: 'northstar', monthlyUnits: 2, concurrent: 1})
        const deniedFile = await processor.current()!.remote.control.upload({
            orgId: 'northstar',
            name: 'over-quota.csv',
            bytes: Buffer.from('name,units\nDenied,1')
        })
        await processor.current()!.remote.ai.createRun({
            requestId: 'over-quota',
            kind: 'extract',
            resourceIds: [deniedFile.id],
            input: {
                orgId: 'northstar',
                documentId: deniedFile.id,
                revision: deniedFile.revision,
                processor: 'node'
            }
        })
        await until('quota denial is visible in product', function failed() {
            return stored()[deniedFile.id].status == 'failed'
        })
        assert(stored()[deniedFile.id].error.includes('квоты'))
        assert.equal(stored()[deniedFile.id].table.rows.length, 0)
        await owner.commands.budgetConfigure('allow-next', {orgId: 'northstar', monthlyUnits: 100, concurrent: 1})
        let finishHeld: (value: string) => void = () => {}
        let running = false
        const heldUsage = {
            orgId: 'northstar',
            eventId: 'held',
            metric: 'search' as const,
            units: 1,
            reference: '',
            signal: new AbortController().signal
        }
        const held = supportMeter.run(heldUsage, function hold() {
            running = true
            return new Promise<string>(resolve => {finishHeld = resolve})
        })
        await until('first operation holds shared slot', () => running)
        try {
            const blockedUsage = {
                orgId: 'northstar',
                eventId: 'parallel-blocked',
                metric: 'document' as const,
                units: 1,
                reference: '',
                signal: new AbortController().signal
            }
            await assert.rejects(documentsMeter.run(blockedUsage, async function blocked() {
                repeated++
                return 1
            }), /параллельных/)
            assert.equal(repeated, 0)
        } finally {
            finishHeld('finished')
            await held
        }
        const lostUsage = {
            orgId: 'northstar',
            eventId: 'external-unknown',
            metric: 'search' as const,
            units: 1,
            reference: '',
            signal: new AbortController().signal
        }
        await assert.rejects(supportMeter.run(lostUsage, async function lostAnswer() {
            throw new Error('external answer lost')
        }), /external answer lost/)
        await until('uncertain remains visible', () => events().some(function uncertain(item) {
            return item.eventId == 'external-unknown' && item.status == 'unknown'
        }))
        await owner.commands.keyRevoke('revoke-products', {orgId: 'northstar', id: issued.id})
        const revokedSearch = {
            orgId: 'northstar',
            eventId: 'revoked-consumer',
            metric: 'search' as const,
            units: 1,
            reference: '',
            signal: new AbortController().signal
        }
        await assert.rejects(supportMeter.run(revokedSearch, async function denied() {
            repeated++
            return 1
        }))
        const revokedDocument = {
            orgId: 'northstar',
            eventId: 'revoked-documents',
            metric: 'document' as const,
            units: 1,
            reference: '',
            signal: new AbortController().signal
        }
        await assert.rejects(documentsMeter.run(revokedDocument, async function denied() {
            repeated++
            return 1
        }))
        assert.equal(repeated, 0)
        console.log('PASS three real SaaS services: support sources and Node document extraction use one quota ledger through common2; dedup prevents repeat work, tenant binding precedes work, uncertain reserve visible, revoked credential blocks both consumers')
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const meter of meters) meter.close()
        for (const session of sessions) session.close()
        for (const host of hosts.reverse()) await host.close()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('saas-integration-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
