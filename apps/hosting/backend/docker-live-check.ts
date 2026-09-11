import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtemp, realpath, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createHostingDefinition} from './service'
import {startDockerAgent} from './agent'
import {createDockerResource, type Deployment} from './docker'

async function main() {
    const prepared = await readFile(path.resolve('data/example-images.json'), 'utf8').then(JSON.parse).catch(()=>({})) as {node?: string, python?: string}
    const nodeImage = process.env.HOSTING_NODE_IMAGE ?? prepared.node
    const pythonImage = process.env.HOSTING_PYTHON_IMAGE ?? prepared.python
    if (!nodeImage || !pythonImage) throw new Error('Set HOSTING_NODE_IMAGE and HOSTING_PYTHON_IMAGE to locally installed repository@sha256:digest images built from examples/node and examples/python')
    const socketPath = process.env.DOCKER_SOCKET ?? (process.platform == 'win32' ? '\\\\.\\pipe\\dockerDesktopLinuxEngine' : '/var/run/docker.sock')
    const owner = 'test-'+randomBytes(8).toString('hex')
    const docker = createDockerResource({socketPath, owner})
    const engine = await docker.view.version()
    assert.equal(engine.Os, 'linux', 'Linux Docker Engine is required')
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'hosting-live-'))
    const password = randomBytes(24).toString('hex')
    const definition = createHostingDefinition({accounts: [{account: 'admin', role: 'admin', projects: [], password}, {account: owner, role: 'agent', projects: ['demo'], password}]})
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, mount({app}) {app.get('/api/client', (_request, response)=>response.json(describeService(definition)))}})
    const client = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const resources: Deployment[] = []
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    let stable = ''
    async function waitFor(check: ()=>boolean | Promise<boolean>) {
        const deadline = Date.now()+45_000
        while (!await check()) {
            if (Date.now() > deadline) throw new Error('deployment did not finish')
            await new Promise<void>(resolve=>setTimeout(resolve, 100))
        }
    }
    try {
        await client.ready()
        await client.commands.createProject('project', {id: 'demo', title: 'Live Docker test'})
        await client.commands.createEnvironment('environment', {id: 'app', project: 'demo', kind: 'docker', agent: owner})
        const limits = {memoryMiB: 64, cpus: 0.25}
        await client.commands.publishRelease('node', {id: 'node', project: 'demo', version: 'node-1', artifact: nodeImage, ...limits})
        await client.commands.publishRelease('python', {id: 'python', project: 'demo', version: 'python-1', artifact: pythonImage, ...limits})
        await client.commands.publishRelease('unhealthy', {id: 'unhealthy', project: 'demo', version: 'unhealthy-1', artifact: nodeImage, healthPath: '/not-ready', ...limits})
        await client.views.dashboard.ready
        const agentDeps = {url: host.url, account: owner, password, socketPath, directory: path.join(directory, 'agent'), readinessMs: 3000}
        agent = await startDockerAgent(agentDeps)
        for (const [index, release] of ['node', 'python', 'node'].entries()) {
            await waitFor(()=>!client.views.dashboard.store.state.environments[0]?.pending)
            const environment = client.views.dashboard.store.state.environments[0]
            const input = {environment: 'app', release, revision: environment.revision}
            const operation = index == 2 ? await client.commands.rollback('rollback', input) : await client.commands.deploy('deploy-'+index, input)
            resources.push({operation: operation.id, environment: 'app', artifact: release == 'node' ? nodeImage : pythonImage})
            await waitFor(()=>client.views.dashboard.store.state.operations.some(item=>item.id == operation.id && ['succeeded', 'failed'].includes(item.status)))
            const current = client.views.dashboard.store.state
            const completed = current.operations.find(item=>item.id == operation.id)
            assert.equal(completed?.status, 'succeeded', completed?.detail ?? 'operation did not succeed')
            const endpoint = current.environments[0].endpoint!
            stable ||= current.environments[0].route!
            assert.equal(current.environments[0].route, stable, 'gateway address remains stable across versions')
            await waitFor(async function routed() {
                const response = await fetch(stable, {signal: AbortSignal.timeout(2000)})
                return response.ok && (await response.json()).runtime == release
            })
            await waitFor(()=>resources.filter(item=>item.operation != operation.id).every(item=>client.views.dashboard.store.state.operations.some(operation=>operation.id == item.operation && operation.cleaned)))
            const body = await fetch(endpoint, {signal: AbortSignal.timeout(2000)}).then(response=>response.json())
            assert.equal(body.runtime, release)
            console.log('PASS actual '+release+' container'+(index == 2 ? ' after rollback' : ''))
            if (index == 0) {
                await agent.close()
                agent = await startDockerAgent(agentDeps)
                const failed = await client.commands.deploy('unhealthy-deploy', {environment: 'app', release: 'unhealthy', revision: current.environments[0].revision})
                resources.push({operation: failed.id, environment: 'app', artifact: nodeImage})
                await waitFor(()=>client.views.dashboard.store.state.operations.some(item=>item.id == failed.id && item.status == 'failed'))
                const afterFailure = client.views.dashboard.store.state.environments[0]
                assert.equal(afterFailure.active, 'node', 'failed readiness must retain the active release')
                assert.equal(afterFailure.endpoint, endpoint, 'failed readiness must retain the active endpoint')
                assert.equal(afterFailure.route, stable)
                assert.equal((await fetch(stable, {signal: AbortSignal.timeout(2000)}).then(response=>response.json())).runtime, 'node')
                assert.equal((await fetch(endpoint, {signal: AbortSignal.timeout(2000)}).then(response=>response.json())).runtime, 'node')
                console.log('PASS actual readiness failure retains the healthy Node endpoint')
            }
        }
        console.log('PASS real Docker Engine '+engine.Version+': Node -> Python -> Node rollback through common2')
    } finally {
        await agent?.close()
        client.close()
        await host.close()
        for (const deployment of resources) await docker.control.remove(deployment)
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {console.error(error); process.exitCode = 1})
