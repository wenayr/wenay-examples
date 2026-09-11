import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes, createHash} from 'node:crypto'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'

export async function waitForHosted(label: string, predicate: () => boolean | Promise<boolean>) {
    const limit = Date.now() + 35000
    while (!await predicate()) {assert(Date.now() < limit, label); await new Promise(resolve => setTimeout(resolve, 70))}
}

// Acceptance-only fixture shared by two independent products, not a deployment SDK.
export async function checkHostedApplication(deps: {name: 'booking' | 'crm' | 'forms' | 'monitoring', verify: (context: {url: string, release: string, iteration: number}) => Promise<void>, close: () => Promise<void>}) {
    const images = Object.fromEntries(['first', 'second'].map(release => [release, execFileSync('docker', ['image', 'inspect', 'wenay-examples.local/' + deps.name + ':' + release, '--format', '{{index .RepoDigests 0}}'], {windowsHide: true, encoding: 'utf8'}).trim()]))
    for (const image of Object.values(images)) assert(/@sha256:[a-f0-9]{64}$/.test(image), 'Build pinned images before acceptance')
    const temporary = await realpath(os.tmpdir()), directory = await mkdtemp(path.join(temporary, deps.name + '-hosting-'))
    const account = deps.name + '-' + randomBytes(5).toString('hex'), password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [{account: 'admin', password, role: 'admin', projects: []}, {account, password, role: 'agent', projects: [deps.name]}]})
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, mount({app}) {
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(definition))})
    }})
    const control = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const docker = createDockerResource({socketPath, owner: account})
    const deployments: Deployment[] = []
    const profile = {port: 8080, healthPath: '/health', memoryMiB: 256, cpus: 0.5, dataVersion: deps.name + '-1'}
    const volume = 'wenay-data-' + createHash('sha256').update(JSON.stringify([account, 'app'])).digest('hex')
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    try {
        await control.ready(); await control.views.dashboard.ready
        await control.commands.createProject('project', {id: deps.name, title: deps.name + ' acceptance'})
        await control.commands.createEnvironment('environment', {id: 'app', project: deps.name, kind: 'docker', agent: account})
        for (const release of ['first', 'second']) await control.commands.publishRelease('release-' + release, {id: release, project: deps.name, version: release, artifact: images[release], ...profile})
        agent = await startDockerAgent({url: host.url, account, password, socketPath, directory, readinessMs: 20000})
        let route = ''
        for (const [iteration, release] of ['first', 'second', 'first'].entries()) {
            const input = {environment: 'app', release, revision: control.views.dashboard.store.state.environments[0].revision}
            const operation = iteration == 2 ? await control.commands.rollback('rollback', input) : await control.commands.deploy('deploy-' + iteration, input)
            deployments.push({operation: operation.id, environment: 'app', artifact: images[release], workload: profile})
            await waitForHosted('deployment terminal', () => control.views.dashboard.store.state.operations.some(value => value.id == operation.id && ['succeeded', 'failed'].includes(value.status)))
            const completed = control.views.dashboard.store.state.operations.find(value => value.id == operation.id)
            assert.equal(completed?.status, 'succeeded', completed?.detail ?? 'deployment failed')
            const endpoint = control.views.dashboard.store.state.environments[0].route!
            route ||= endpoint
            assert.equal(endpoint, route, 'gateway URL stays stable')
            await waitForHosted('current release through gateway', () => fetch(route + '/health', {signal: AbortSignal.timeout(2000)}).then(response => response.json()).then(body => body.release == release && body.application == deps.name).catch(() => false))
            try {await deps.verify({url: route, release, iteration})}
            catch (error) {
                try {
                    const failed = JSON.parse(execFileSync('docker', ['inspect', volume + '-writer'], {windowsHide: true, encoding: 'utf8'}))[0]
                    if (failed.Config.Labels['wenay.owner'] == account) console.error(execFileSync('docker', ['logs', '--tail', '30', volume + '-writer'], {windowsHide: true, encoding: 'utf8', stdio: 'pipe'}))
                } catch { /* The owned container may have already been removed. */ }
                throw error
            }
            const container = JSON.parse(execFileSync('docker', ['inspect', volume + '-writer'], {windowsHide: true, encoding: 'utf8'}))[0]
            assert.equal(container.HostConfig.Memory, 256 * 1024 * 1024)
            assert.equal(container.Config.Labels['wenay.owner'], account)
            const usage = execFileSync('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', volume + '-writer'], {windowsHide: true, encoding: 'utf8'}).trim()
            console.log('PASS ' + deps.name + ' hosted ' + (iteration == 2 ? 'rollback' : release) + ': stable gateway, durable product state; memory ' + usage)
        }
    } finally {
        await deps.close()
        await agent?.close(); control.close(); await host.close()
        for (const deployment of deployments) await docker.control.remove(deployment)
        try {
            execFileSync('docker', ['volume', 'inspect', volume], {windowsHide: true, stdio: 'pipe'})
            execFileSync('docker', ['volume', 'rm', volume], {windowsHide: true, stdio: 'pipe'})
        } catch { /* Only this run's randomly namespaced volume is considered for cleanup. */ }
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith(deps.name + '-hosting-'))
        await rm(directory, {recursive: true, force: true})
    }
}
