import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes, createHash} from 'node:crypto'
import {mkdtemp, rm, realpath} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'
import type {MeteringDefinition} from '../../metering/backend/runtime'

// Развёртывание закрепляется digest образа, а не подвижным тегом.
function imageDigest(release: string) {
    const reference = 'wenay-examples.local/metering:' + release
    const args = ['image', 'inspect', reference, '--format', '{{index .RepoDigests 0}}']
    return execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'}).trim()
}

async function main() {
    const images = Object.fromEntries(['first', 'second'].map(release => [release,
        imageDigest(release)]))
    for (const image of Object.values(images)) assert(/@sha256:[a-f0-9]{64}$/.test(image), 'Build pinned metering images before live check')
    const temporary = await realpath(os.tmpdir())
    const directory = await mkdtemp(path.join(temporary, 'metering-hosting-'))
    const account = 'metering-' + randomBytes(5).toString('hex')
    const password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [
        {account: 'admin', password, role: 'admin', projects: []},
        {account, password, role: 'agent', projects: ['metering']}
    ]})
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, mount({app}) {
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(definition))})
    }})
    const control = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const docker = createDockerResource({socketPath, owner: account})
    const deployments: Deployment[] = []
    const clients: ServiceClient<MeteringDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    const profile = {port: 8080, healthPath: '/health', memoryMiB: 256, cpus: 0.5, dataVersion: 'metering-1'}
    const volume = 'wenay-data-' + createHash('sha256').update(JSON.stringify([account, 'app'])).digest('hex')
    async function wait(label: string, predicate: () => boolean | Promise<boolean>) {
        const until = Date.now() + 35000
        while (!await predicate()) {
            assert(Date.now() < until, label)
            await new Promise(resolve => setTimeout(resolve, 70))
        }
    }
    try {
        await control.ready()
        await control.views.dashboard.ready
        await control.commands.createProject('project', {id: 'metering', title: 'Metering acceptance'})
        await control.commands.createEnvironment('environment', {id: 'app', project: 'metering', kind: 'docker', agent: account})
        for (const release of ['first', 'second']) await control.commands.publishRelease('release-' + release, {
            id: release,
            project: 'metering',
            version: release,
            artifact: images[release],
            ...profile
        })
        agent = await startDockerAgent({url: host.url, account, password, socketPath, directory, readinessMs: 20000})
        let route = ''
        let owner: ServiceClient<MeteringDefinition> | undefined
        let writer: ServiceClient<MeteringDefinition> | undefined
        let key: {id: string, account: string, secret: string} | undefined
        let watcher: ReturnType<ServiceClient<MeteringDefinition>['resources']['open']> | undefined
        const reservation = {eventId: 'hosted-reservation', metric: 'document' as const, units: 20, reference: 'durable-document'}
        for (const [index, release] of ['first', 'second', 'first'].entries()) {
            const generation = watcher?.current()?.generation ?? 0
            const current = control.views.dashboard.store.state.environments[0]
            const input = {environment: 'app', release, revision: current.revision}
            const operation = index == 2 ? await control.commands.rollback('rollback', input) : await control.commands.deploy('deploy-' + index, input)
            deployments.push({operation: operation.id, environment: 'app', artifact: images[release], workload: profile})
            await wait('deployment terminal', function done() {
                return control.views.dashboard.store.state.operations.some(function finished(item) {
                    return item.id == operation.id && ['succeeded', 'failed'].includes(item.status)
                })
            })
            const completed = control.views.dashboard.store.state.operations.find(item => item.id == operation.id)
            assert.equal(completed?.status, 'succeeded', completed?.detail ?? 'deployment failed')
            const endpoint = control.views.dashboard.store.state.environments[0].route!
            route ||= endpoint
            assert.equal(endpoint, route)
            await wait('release through stable gateway', async function healthy() {
                const answer = fetch(route + '/health', {signal: AbortSignal.timeout(2000)})
                const body = await answer.then(response => response.json()).catch(() => null)
                return body?.release == release && body?.application == 'metering'
            })
            assert((await fetch(route).then(response => response.text())).includes('Counter'))
            const descriptor = await fetch(route + '/api/client').then(response => response.json())
            if (!owner) {
                owner = createServiceClient<MeteringDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: 'owner', password: 'owner-pass'}}
                })
                clients.push(owner)
                await owner.ready()
                await owner.views.workspace.ready
                const keys = owner.resources.open('keys')
                resources.push(keys)
                watcher = keys
                await wait('key resource ready', () => !!keys.current())
                const issued = await keys.current()!.remote.control.issue({
                    requestId: 'hosted-key',
                    orgId: 'northstar',
                    label: 'Hosting acceptance',
                    scopes: ['usage:read', 'usage:write'],
                    days: 1
                })
                assert(issued.secret)
                key = {id: issued.id, account: issued.account, secret: issued.secret}
                // The secret remains an in-memory login input; archives store only its hash.
                writer = createServiceClient<MeteringDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: key.account, password: key.secret}}
                })
                clients.push(writer)
                await writer.ready()
                const activeUsage = writer.resources.open('usage')
                resources.push(activeUsage)
                await wait('writer usage resource ready', () => !!activeUsage.current())
                assert.equal((await activeUsage.current()!.remote.control.identity()).keyId, key.id)
                assert.equal((await writer.commands.usageReserve('reserve-first', reservation)).status, 'reserved')
            } else {
                await wait('same owner view/resource reconnect', () => owner!.health.state.connected && (watcher?.current()?.generation ?? 0) > generation)
                // Command-only sessions reconnect on current()/ready(); resource connections are independent.
                await writer!.ready()
                // A fresh login after deployment proves the persisted hash still validates the original secret.
                const restored = createServiceClient<MeteringDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: key!.account, password: key!.secret}}
                })
                clients.push(restored)
                await restored.ready()
                const usage = restored.resources.open('usage')
                resources.push(usage)
                await wait('restored usage resource', () => !!usage.current())
                const remote = usage.current()!.remote
                assert.equal((await remote.control.identity()).keyId, key!.id)
                const period = new Date().toISOString().slice(0, 7)
                const ledger = await remote.control.read({period, limit: 25})
                assert.equal(ledger.events.length, 1)
                assert.equal(ledger.events[0].eventId, reservation.eventId)
                if (index == 1) {
                    assert.equal(ledger.totals.reserved, 20)
                    assert.equal(ledger.totals.active, 1)
                    assert.equal((await restored.commands.usageReserve('reserve-second-receipt', reservation)).fresh, false)
                    assert.equal((await writer!.commands.usageSettle('settle-second', {eventId: reservation.eventId, units: 12})).units, 12)
                } else {
                    assert.equal(ledger.totals.used, 12)
                    assert.equal(ledger.totals.reserved, 0)
                    assert.equal(ledger.totals.active, 0)
                    assert.equal((await writer!.commands.usageSettle('settle-rollback-receipt', {eventId: reservation.eventId, units: 12})).fresh, false)
                    await owner.commands.keyRevoke('revoke-restored-key', {orgId: 'northstar', id: key!.id})
                    await assert.rejects(restored.commands.usageRecord('revoked-key', {...reservation, eventId: 'must-not-exist'}))
                    await assert.rejects(remote.control.identity())
                }
            }
            const expected = index == 0 ? 'reserved' : 'committed'
            await wait('workspace ledger updated', function recorded() {
                const events = owner!.views.workspace.store.state.events
                return events.length == 1 && events[0].status == expected
            })
            assert(!JSON.stringify(owner.views.workspace.store.state).includes(key!.secret))
            const inspect = JSON.parse(execFileSync('docker', ['inspect', volume + '-writer'], {windowsHide: true, encoding: 'utf8'}))[0]
            assert.equal(inspect.HostConfig.Memory, 256 * 1024 * 1024)
            assert.equal(inspect.Config.Labels['wenay.owner'], account)
            const args = ['stats', '--no-stream', '--format', '{{.MemUsage}}', volume + '-writer']
            const usage = execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'}).trim()
            console.log('PASS metering hosted ' + (index == 2 ? 'rollback' : release) + ': stable route, session reconnect, persistent key/ledger; memory ' + usage)
        }
    } finally {
        for (const resource of resources) await resource.close().catch(() => {})
        for (const client of clients) client.close()
        await agent?.close()
        control.close()
        await host.close()
        for (const deployment of deployments) await docker.control.remove(deployment)
        try {
            execFileSync('docker', ['volume', 'inspect', volume], {windowsHide: true, stdio: 'pipe'})
            execFileSync('docker', ['volume', 'rm', volume], {windowsHide: true, stdio: 'pipe'})
        } catch { /* This run may have failed before creating its randomly namespaced volume. */ }
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('metering-hosting-'))
        await rm(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})

