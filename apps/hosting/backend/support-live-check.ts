import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes, createHash} from 'node:crypto'
import {mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'
import type {SupportDefinition} from '../../support/backend/runtime'

// Развёртывание закрепляется digest образа, а не подвижным тегом.
function imageDigest(release: string) {
    const reference = 'wenay-examples.local/support:' + release
    const args = ['image', 'inspect', reference, '--format', '{{index .RepoDigests 0}}']
    return execFileSync('docker', args, {windowsHide: true, encoding: 'utf8'}).trim()
}

async function main() {
    const images = Object.fromEntries(['first', 'second'].map(release => [release,
        imageDigest(release)]))
    for (const value of Object.values(images)) assert(/@sha256:[a-f0-9]{64}$/.test(value), 'Build pinned support images before live check')
    const directory = await mkdtemp(path.join(os.tmpdir(), 'support-hosting-'))
    const account = 'support-' + randomBytes(5).toString('hex')
    const password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [
        {account: 'admin', password, role: 'admin', projects: []},
        {account, password, role: 'agent', projects: ['support']}
    ]})
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, mount({app}) {
        app.get('/api/client', function descriptor(_req, res) {res.json(describeService(definition))})
    }})
    const control = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const docker = createDockerResource({socketPath, owner: account})
    const deployments: Deployment[] = []
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    let app: ReturnType<typeof createServiceClient<SupportDefinition>> | undefined
    let watcher: {current(): {generation: number} | null, close(): Promise<void>} | undefined
    const profile = {port: 8080, healthPath: '/health', memoryMiB: 256, cpus: 0.5, dataVersion: 'support-1'}
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
        await control.commands.createProject('project', {id: 'support', title: 'Support acceptance'})
        await control.commands.createEnvironment('environment', {id: 'app', project: 'support', kind: 'docker', agent: account})
        for (const release of ['first', 'second']) await control.commands.publishRelease('release-' + release, {
            id: release,
            project: 'support',
            version: release,
            artifact: images[release],
            ...profile
        })
        agent = await startDockerAgent({url: host.url, account, password, socketPath, directory, readinessMs: 20000})
        let route = ''
        let ticketId = ''
        let attachmentId = ''
        for (const [index, release] of ['first', 'second', 'first'].entries()) {
            const previousGeneration = watcher?.current()?.generation ?? 0
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
                return body?.release == release
            })
            assert((await fetch(route).then(response => response.text())).includes('Northstar'))
            if (!app) {
                const descriptor = await fetch(route + '/api/client').then(response => response.json())
                app = createServiceClient<SupportDefinition>({
                    definition: descriptor,
                    url: route,
                    auth: {credentials: {account: 'customer', password: 'customer-pass'}}
                })
                await app.ready()
                await app.views.workspace.ready
                const created = await app.commands.ticketCreate('hosted-ticket', {
                    orgId: 'northstar',
                    subject: 'Заявка через хостинг',
                    body: 'Проверяем размещение и сохранение',
                    priority: 'normal'
                })
                ticketId = created.id
                watcher = app.resources.open('files')
                await wait('resource generation established', () => !!watcher?.current())
                const files = app.resources.open('files')
                try {
                    await wait('files resource', () => files.status.state.phase == 'ready')
                    attachmentId = (await files.current()!.remote.control.upload({
                        orgId: 'northstar',
                        ticketId,
                        name: 'hello.txt',
                        bytes: new TextEncoder().encode('durable attachment')
                    })).id
                } finally {await files.close()}
            } else {
                await wait('same live session reconnects', function reconnected() {
                    if (!app!.health.state.connected) return false
                    if ((watcher?.current()?.generation ?? 0) <= previousGeneration) return false
                    return !!app!.views.workspace.store.state.tickets.find(item => item.id == ticketId)
                })
                const repeat = await app.commands.ticketCreate('hosted-ticket', {
                    orgId: 'northstar',
                    subject: 'Заявка через хостинг',
                    body: 'Проверяем размещение и сохранение',
                    priority: 'normal'
                })
                assert.equal(repeat.id, ticketId)
                const files = app.resources.open('files')
                try {
                    await wait('restored attachment resource', () => files.status.state.phase == 'ready')
                    assert.equal(new TextDecoder().decode((await files.current()!.remote.control.download(attachmentId)).bytes), 'durable attachment')
                } finally {await files.close()}
            }
            console.log('PASS support through hosting: ' + (index == 2 ? 'rollback' : 'deploy ' + release) + ', stable route, RPC session, durable ticket and attachment; container limit 256 MiB')
        }
    } finally {
        await watcher?.close()
        app?.close()
        await agent?.close()
        control.close()
        await host.close()
        for (const deployment of deployments) await docker.control.remove(deployment)
        const volume = 'wenay-data-' + createHash('sha256').update(JSON.stringify([account, 'app'])).digest('hex')
        try {
            execFileSync('docker', ['volume', 'inspect', volume], {windowsHide: true, stdio: 'pipe'})
            execFileSync('docker', ['volume', 'rm', volume], {windowsHide: true, stdio: 'pipe'})
        } catch { /* Volume may not have been created. */ }
        if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected cleanup directory')
        await rm(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
