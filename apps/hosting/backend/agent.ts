import {open, mkdir, unlink, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID, randomBytes, createHash} from 'node:crypto'
import {createResourceScope, createReconciler} from 'wenay-common2'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import {createDockerResource, DeploymentRejected} from './docker'
import type {HostingDefinition} from './service'
import {createGatewayResource} from './gateway'

export async function startDockerAgent(deps: {url: string, account: string, password: string, socketPath: string, directory: string, readinessMs?: number}) {
    const scope = createResourceScope()
    return scope.start(async function start(signal) {
        await mkdir(deps.directory, {recursive: true})
        const lockPath = path.join(deps.directory, 'agent.lock')
        const lock = await scope.resource.acquire({
            open: () => open(lockPath, 'wx'),
            async close(file) { try { await file.close() } finally { await unlink(lockPath) } },
        })
        await lock.writeFile(JSON.stringify({pid: process.pid, account: deps.account}))
        const definition: ServiceClientDefinition<HostingDefinition> = await fetch(deps.url+'/api/client', {signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])}).then(function descriptor(response) {
            if (!response.ok) throw new Error('control service descriptor unavailable')
            return response.json()
        })
        const client = createServiceClient<HostingDefinition>({definition, url: deps.url, auth: {credentials: {account: deps.account, password: deps.password}}})
        const closeClient = scope.resource.own(client.close)
        async function runtime(environment: string) {
            const route = client.views.assignments.store.state.environments.find(item => item.id == environment)?.route
            const origins = route ? ['SERVICE_CORS_ORIGINS=' + new URL(route).origin, 'SERVICE_PUBLIC_URL=' + new URL(route).origin] : []
            const file = path.join(deps.directory, 'runtime-' + createHash('sha256').update(environment).digest('hex') + '.json')
            try {return [...JSON.parse(await readFile(file, 'utf8')) as string[], ...origins]}
            catch (error) {
                if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
                const values = ['SERVICE_TOKEN_SECRET=' + randomBytes(32).toString('hex'), 'SERVICE_NODE_TOKEN=' + randomBytes(32).toString('hex')]
                await writeFile(file, JSON.stringify(values), {flag: 'wx', mode: 0o600})
                return [...values, ...origins]
            }
        }
        const docker = createDockerResource({socketPath: deps.socketPath, owner: deps.account, readinessMs: deps.readinessMs, runtime})
        const gateway = createGatewayResource()
        const closeGateway = scope.resource.own(gateway.close)
        function retry(id: string) { worker.control.retry(id, 5000) }

        async function maintainRoutes() {
            const ready = new Set<string>()
            const snapshot = client.views.assignments.store.snapshot()
            for (const environment of snapshot.environments.filter(item=>item.kind == 'docker')) {
                if (signal.aborted || !client.health.state.connected) return ready
                try {
                    const endpoint = await gateway.control.open(environment.id, environment.route)
                    if (!environment.route) {
                        const registered = await client.commands.registerRoute('route-'+environment.id, {environment: environment.id, endpoint})
                        if (registered.endpoint != endpoint) throw new Error('route registration did not retain the bound address')
                    }
                    ready.add(environment.id)
                    const active = snapshot.retained.find(item=>item.id == environment.activeOperation && item.status == 'succeeded')
                    const release = snapshot.releases.find(item=>item.id == active?.release)
                    if (!active || !release) {gateway.control.activate(environment.id, null); continue}
                    const observed = await docker.view.observe({operation: active.id, environment: environment.id, artifact: release.artifact, workload: release.workload}, signal)
                    if (!observed || observed.endpoint != environment.endpoint) {
                        gateway.control.activate(environment.id, null)
                        retry('route-'+environment.id)
                        continue
                    }
                    gateway.control.activate(environment.id, {operation: active.id, endpoint: observed.endpoint})
                    for (const old of snapshot.retained.filter(item=>item.environment == environment.id && item.id != active.id && item.id != environment.pending)) {
                        const previous = snapshot.releases.find(item=>item.id == old.release)
                        if (!previous) continue
                        await gateway.control.drain(old.id)
                        if (signal.aborted || !client.health.state.connected) return ready
                        const current = client.views.assignments.store.state.environments.find(item=>item.id == environment.id)
                        if (current?.activeOperation != active.id || current.pending == old.id) break
                        await docker.control.remove({operation: old.id, environment: environment.id, artifact: previous.artifact, workload: previous.workload})
                        await client.commands.confirmCleanup('cleanup-'+old.id, {operation: old.id})
                    }
                } catch (error) {
                    if (signal.aborted) return ready
                    console.error('Environment '+environment.id+': route or cleanup pending', error instanceof Error ? error.message : 'unknown error')
                    retry('route-'+environment.id)
                }
            }
            return ready
        }

        async function reconcile(snapshot: ReturnType<typeof client.views.assignments.store.snapshot>) {
            if (!client.health.state.connected) return
            const routes = await maintainRoutes()
            for (const item of snapshot.operations ?? []) {
                if (signal.aborted) break
                const environment = snapshot.environments.find(environment=>environment.id == item.environment)
                if (environment?.kind != 'docker' || !routes.has(environment.id)) continue
                const release = snapshot.releases.find(release=>release.id == item.release)
                if (!release) continue
                try {
                    const operation = item.status == 'queued' ? await client.commands.claimOperation('claim-'+item.id, {operation: item.id, revision: item.revision}) : {...item}
                    const deployment = {operation: operation.id, environment: environment.id, artifact: release.artifact, workload: release.workload}
                    const previousOperation = snapshot.retained.find(old => old.id == environment.activeOperation)
                    const previousRelease = snapshot.releases.find(old => old.id == previousOperation?.release)
                    const previous = previousOperation && previousRelease ? {operation: previousOperation.id, environment: environment.id, artifact: previousRelease.artifact, workload: previousRelease.workload} : null
                    try {
                        if (release.workload?.dataVersion && previous) {
                            gateway.control.activate(environment.id, null)
                            await gateway.control.drain(previous.operation)
                            await docker.control.remove(previous)
                        }
                        const result = await docker.control.deploy(deployment, signal)
                        await client.commands.finishOperation('finish-'+operation.id, {operation: operation.id, revision: operation.revision, success: true, observedArtifact: result.artifact, detail: 'Ready: '+result.endpoint, endpoint: result.endpoint})
                    } catch (error) {
                        if (!(error instanceof DeploymentRejected) || signal.aborted) throw error
                        await docker.control.remove(deployment)
                        const restored = release.workload?.dataVersion && previous ? await docker.control.deploy(previous, signal) : null
                        await client.commands.finishOperation('failed-'+operation.id, {operation: operation.id, revision: operation.revision, success: false, observedArtifact: restored?.artifact ?? '', detail: error.message.slice(0, 500), ...(restored ? {endpoint: restored.endpoint} : {})})
                    }
                } catch (error) {
                    if (signal.aborted) break
                    // Uncertain IO is reconciled against the same Docker name. Never report failure after a lost success reply.
                    console.error('Operation '+item.id+': reconciliation pending')
                    retry(item.id)
                }
            }
            await maintainRoutes()
        }

        await client.ready()
        const identity = await client.identity.me()
        if (!identity.roles.includes('agent')) throw new Error('agent role is required')
        await client.views.assignments.ready
        await docker.view.version()
        const worker = createReconciler({signal, read: () => client.views.assignments.store.snapshot(), run: reconcile,
            subscribe: client.views.assignments.store.listen().on,
        })
        // Closing IO unblocks the pass; the lock remains owned until all three settle.
        scope.resource.parallel([worker.close, closeGateway, closeClient])
        scope.resource.own(worker.events.errors(function failed() {console.error('Agent reconciliation failed')}))
        worker.control.request()
        return {close: scope.close, view: {account: ()=>deps.account, instance: randomUUID()}}
    })
}
