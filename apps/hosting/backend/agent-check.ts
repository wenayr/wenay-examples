import assert from 'node:assert/strict'
import http from 'node:http'
import {randomBytes} from 'node:crypto'
import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createHostingRuntime} from './runtime'
import {startDockerAgent} from './agent'

async function main() {
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'hosting-agent-check-'))
    const socketPath = process.platform == 'win32' ? '\\\\.\\pipe\\hosting-agent-'+randomBytes(8).toString('hex') : path.join(directory, 'docker.sock')
    const containers = new Map<string, any>()
    let creates = 0
    const app = http.createServer(function healthy(_request, response) {response.end('healthy')})
    await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
    const port = (app.address() as {port: number}).port
    const fixture = http.createServer(async function docker(request, response) {
        const url = new URL(request.url!, 'http://localhost')
        response.setHeader('content-type', 'application/json')
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        if (url.pathname.endsWith('/version')) {
            response.end('{"Version":"fixture","Os":"linux"}')
            return
        }
        if (url.pathname.includes('/images/')) {
            response.end('{}')
            return
        }
        if (url.pathname.endsWith('/create')) {
            const name = url.searchParams.get('name')!
            const config = JSON.parse(Buffer.concat(chunks).toString())
            creates++
            const value = {
                Id: name,
                Config: config,
                State: {Running: false},
                NetworkSettings: {Ports: {'8080/tcp': [{HostIp: '127.0.0.1', HostPort: String(port)}]}}
            }
            containers.set(name, value)
            response.end(JSON.stringify({Id: name}))
            return
        }
        const name = decodeURIComponent(url.pathname.split('/')[3] ?? '')
        const container = containers.get(name)
        if (!container) {
            response.writeHead(404)
            response.end('{}')
            return
        }
        if (url.pathname.endsWith('/start')) {
            container.State.Running = true
            response.writeHead(204)
            response.end()
            return
        }
        if (request.method == 'DELETE') {
            containers.delete(name)
            response.writeHead(204)
            response.end()
            return
        }
        response.end(JSON.stringify(container))
    })
    await new Promise<void>(resolve => fixture.listen(socketPath, resolve))
    const password = randomBytes(24).toString('hex')
    const runtime = createHostingRuntime({accounts: [
        {account: 'admin', role: 'admin', projects: [], password},
        {account: 'agent', role: 'agent', projects: ['demo'], password},
        {account: 'other-agent', role: 'agent', projects: ['demo'], password},
    ]})
    const definition = runtime.definition
    const env = {
        SERVICE_PORT: '0',
        SERVICE_DATA_DIR: path.join(directory, 'control'),
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
        SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    function mount({app, leader}: Parameters<NonNullable<Parameters<typeof createServiceLeaderHost<typeof definition>>[0]['mount']>>[0]) {
        app.get('/api/client', (_request, response) => response.json(describeService(definition)))
        return runtime.mount(leader.line.control.store, leader.corridor.system)
    }
    let host = await createServiceLeaderHost({definition, env, mount})
    let client = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
    const agentDeps = {url: host.url, account: 'agent', password, socketPath, directory: path.join(directory, 'agent')}
    let agent: Awaited<ReturnType<typeof startDockerAgent>> | undefined
    async function waitFor(check: () => boolean | Promise<boolean>) {
        const deadline = Date.now()+10_000
        while (!await check()) {
            if (Date.now() > deadline) throw new Error('agent did not reconcile')
            await new Promise<void>(resolve => setTimeout(resolve, 25))
        }
    }
    try {
        await client.ready()
        await client.commands.createProject('project', {id: 'demo', title: 'Demo'})
        await client.commands.createEnvironment('environment', {id: 'app', project: 'demo', kind: 'docker', agent: 'agent'})
        const publicOrigin = 'https://app.example.test'
        const originResource = client.resources.open('publicOrigin')
        await waitFor(() => !!originResource.current())
        await originResource.current()!.remote.control.set({requestId: 'public-origin', environment: 'app', revision: 0, publicOrigin})
        originResource.close()
        await client.commands.publishRelease('release', {id: 'one', project: 'demo', version: '1', artifact: 'demo/app@sha256:'+'a'.repeat(64)})
        const operation = await client.commands.deploy('deploy', {environment: 'app', release: 'one', revision: 1})
        agent = await startDockerAgent(agentDeps)
        await assert.rejects(startDockerAgent(agentDeps), /EEXIST/, 'second agent cannot share the same local lock')
        await client.views.dashboard.ready
        await waitFor(() => client.views.dashboard.store.state.environments[0]?.active == 'one')
        assert.equal(client.views.dashboard.store.state.environments[0].endpoint, 'http://127.0.0.1:'+port)
        assert.equal(client.views.dashboard.store.state.operations.find(item => item.id == operation.id)?.status, 'succeeded')
        const stable = client.views.dashboard.store.state.environments[0].route!
        const deployedEnv = containers.get('wenay-' + operation.id).Config.Env as string[]
        assert.deepEqual(deployedEnv.filter(value => value.startsWith('SERVICE_PUBLIC_URL=')), ['SERVICE_PUBLIC_URL=' + publicOrigin])
        assert.deepEqual(deployedEnv.filter(value => value.startsWith('SERVICE_CORS_ORIGINS=')), ['SERVICE_CORS_ORIGINS=' + publicOrigin])
        assert(stable.startsWith('http://127.0.0.1:'), 'configured public origin does not expose the internal gateway')
        await waitFor(async () => (await fetch(stable)).status == 200)
        assert.equal(await fetch(stable).then(response => response.text()), 'healthy')
        await Promise.all([agent.close(), agent.close()])
        const next = await client.commands.deploy('deploy-again', {environment: 'app', release: 'one', revision: 3})
        // Represents recovery after an earlier executor created the candidate and lost its reply.
        const previous = containers.get('wenay-'+operation.id)
        const labels = {...previous.Config.Labels, 'wenay.operation': next.id}
        containers.set('wenay-' + next.id, {
            ...previous,
            Id: 'wenay-' + next.id,
            Config: {...previous.Config, Labels: labels}
        })
        const before = creates
        agent = await startDockerAgent(agentDeps)
        await waitFor(() => client.views.dashboard.store.state.operations.some(item => item.id == next.id && item.status == 'succeeded'))
        await waitFor(() => client.views.dashboard.store.state.operations.some(item => item.id == operation.id && item.cleaned))
        assert.equal(client.views.dashboard.store.state.environments[0].route, stable)
        assert.equal(await fetch(stable).then(response => response.text()), 'healthy')
        assert(!containers.has('wenay-'+operation.id), 'retired candidate is deleted')
        assert(containers.has('wenay-'+next.id), 'active candidate is retained')
        assert.equal(creates, before, 'restarted agent reuses the existing candidate')
        await agent.close()
        client.close()
        await host.close()
        host = await createServiceLeaderHost({definition, env, mount})
        client = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'admin', password}}})
        await client.ready()
        await client.views.dashboard.ready
        assert.equal(client.views.dashboard.store.state.environments[0].route, stable, 'route persists in the control archive')
        assert.equal(client.views.dashboard.store.state.environments[0].publicOrigin, publicOrigin, 'public origin survives control restart')
        agent = await startDockerAgent({...agentDeps, url: host.url})
        await waitFor(async () => (await fetch(stable)).status == 200)
        assert.equal(creates, before, 'control restart restores routing without redeploying')
        const reporter = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'agent', password}}})
        try {
            await reporter.ready()
            await assert.rejects(reporter.commands.confirmCleanup('active-cleanup-denied', {operation: next.id}), /not eligible/)
            await assert.rejects(reporter.commands.registerRoute('change-route-denied', {environment: 'app', endpoint: 'http://127.0.0.1:1'}), /immutable/)
            const badRoute = {environment: 'app', endpoint: 'http://127.0.0.1:65536'}
            const denied = reporter.commands.registerRoute('invalid-route-denied', badRoute)
            await assert.rejects(denied, /valid port/)
        } finally {reporter.close()}
        const other = createServiceClient({definition: describeService(definition), url: host.url, auth: {credentials: {account: 'other-agent', password}}})
        try {
            await other.ready()
            await assert.rejects(other.commands.registerRoute('foreign-route', {environment: 'app', endpoint: stable}), /unavailable/)
            await assert.rejects(other.commands.confirmCleanup('foreign-cleanup', {operation: operation.id}), /unavailable/)
        } finally {other.close()}
        console.log('PASS real common2 agent/control connection, stable route across archive/agent restart, old candidate cleanup, active protection, local lock and recovery (Docker HTTP fixture)')
    } finally {
        await agent?.close()
        client.close()
        await host.close()
        app.closeAllConnections()
        fixture.closeAllConnections()
        await Promise.all([new Promise<void>(resolve => app.close(() => resolve())), new Promise<void>(resolve => fixture.close(() => resolve()))])
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
