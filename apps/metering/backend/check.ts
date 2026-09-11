import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createMeteringRuntime, type MeteringDefinition} from './runtime'
import {createProcess} from './process-resource'

async function until(label: string, predicate: () => boolean) {
    const end = Date.now() + 16000
    while (!predicate()) {
        assert(Date.now() < end, label)
        await new Promise(resolve => setTimeout(resolve, 25))
    }
}

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'metering-network-'))
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let host = createProcess({script: 'server.ts', env}), url = await host.ready
    const definition = describeService(createMeteringRuntime().definition)
    const clients: ServiceClient<MeteringDefinition>[] = [], nodes: ReturnType<typeof createProcess>[] = []
    const resources: {close(): Promise<void>}[] = []
    async function client(account: string, password = account + '-pass') {
        const session = createServiceClient<MeteringDefinition>({definition, url, auth: {credentials: {account, password}}, placement: {rng: () => 0}})
        clients.push(session)
        await session.ready()
        if (!account.startsWith('key:')) await session.views.workspace.ready
        return session
    }
    try {
        for (const id of ['metering-a', 'metering-b']) {
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_UPSTREAM: url, SERVICE_NODE_ID: id}})
            nodes.push(node)
            await node.ready
        }
        const owner = await client('owner'), outsider = await client('outsider')
        const issue = owner.resources.open('keys')
        resources.push(issue)
        await until('key resource', () => !!issue.current())
        const key = await issue.current()!.remote.control.issue({
            requestId: 'network-key',
            orgId: 'northstar',
            label: 'Network client',
            scopes: ['usage:read', 'usage:write'],
            days: 1
        })
        assert(key.secret)
        const writerA = await client(key.account, key.secret), writerB = await client(key.account, key.secret)
        await owner.commands.budgetConfigure('budget', {orgId: 'northstar', monthlyUnits: 3, concurrent: 1})
        const record = {eventId: 'one-event', metric: 'search' as const, units: 2, reference: 'request-a'}
        const first = await writerA.commands.usageRecord('first', record)
        assert(first.fresh)
        assert.equal((await writerB.commands.usageRecord('different-command-same-event', record)).fresh, false)
        const races = await Promise.allSettled([
            writerA.commands.usageReserve('reserve-a', {eventId: 'reserve-a', metric: 'document', units: 1, reference: 'doc-a'}),
            writerB.commands.usageReserve('reserve-b', {eventId: 'reserve-b', metric: 'document', units: 1, reference: 'doc-b'})
        ])
        assert.equal(races.filter(item => item.status == 'fulfilled').length, 1)
        const winner = (races.find(item => item.status == 'fulfilled') as PromiseFulfilledResult<{eventId: string}>).value
        await writerA.commands.usageUncertain('mark-uncertain', {eventId: winner.eventId, reason: 'Потерян ответ обработчика'})
        await until('owner sees usage', () => owner.views.workspace.store.state.events.length == 2)
        assert.equal(outsider.views.workspace.store.state.events.length, 0)
        const endpoint = owner.view.endpoint()!
        assert(endpoint.nodeId != 'leader')
        const stable = owner.views.workspace.store
        await nodes[endpoint.nodeId == 'metering-a' ? 0 : 1].control.stop(true)
        await until('serving failover', () => !!owner.view.endpoint() && owner.view.endpoint()!.nodeId != endpoint.nodeId)
        await writerB.commands.usageSettle('settle-after-failover', {eventId: winner.eventId, units: 1})
        await until('live settled ledger', () => owner.views.workspace.store.state.events.every(item => item.status == 'committed'))
        assert.equal(owner.views.workspace.store, stable)
        for (const resource of resources) await resource.close()
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restored = await client('owner'), restoredWriter = await client(key.account, key.secret)
        assert.equal(restored.views.workspace.store.state.events.length, 2)
        assert.equal((await restoredWriter.commands.usageRecord('after-restart-event', record)).fresh, false)
        assert(!JSON.stringify(restored.views.workspace.store.state).includes(key.secret))
        const read = restoredWriter.resources.open('usage')
        resources.push(read)
        await until('retained key read', () => !!read.current())
        const remote = read.current()!.remote
        assert.equal((await remote.control.identity()).orgId, 'northstar')
        await restored.commands.keyRevoke('revoke-persisted-key', {orgId: 'northstar', id: key.id})
        await assert.rejects(restoredWriter.commands.usageRecord('revoked', {...record, eventId: 'not-allowed'}))
        await assert.rejects(remote.control.identity())
        console.log('PASS metering: authority + 2 serving, two API clients, semantic dedup, final quota race, unknown/settle, node failover, durable ledger/key restart and live key revocation')
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const session of clients) session.close()
        for (const node of nodes) await node.control.stop()
        await host.control.stop()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('metering-network-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
