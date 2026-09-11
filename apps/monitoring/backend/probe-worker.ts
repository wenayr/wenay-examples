import {randomUUID} from 'node:crypto'
import {createReconciler} from 'wenay-common2'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {ServiceLeader} from 'wenay-common2/service/server'
import type {MonitoringDefinition} from './runtime'
import {createHttpProbe, type ProbeTarget} from './http-probe'

type Assignments = ReturnType<MonitoringDefinition['views']['assignments']['project']>
type ProbeCommands = Pick<ServiceClient<MonitoringDefinition>['commands'], 'probeClaim' | 'probeReport'>

export async function createProbeWorker(deps: {url: string, account: string, password: string, targets: readonly ProbeTarget[], takeoverMs?: number}) {
    const descriptor = await fetch(deps.url + '/api/client', {signal: AbortSignal.timeout(8000)}).then(response => response.json())
    const client: ServiceClient<MonitoringDefinition> = createServiceClient<MonitoringDefinition>({
        definition: {...descriptor, views: {assignments: descriptor.views.assignments}},
        url: deps.url,
        auth: {credentials: {account: deps.account, password: deps.password}}
    })
    try {
        await client.ready()
        await client.views.assignments.ready
    }
    catch (error) {
        client.close()
        throw error
    }
    const worker = createProbeLoop({account: deps.account, targets: deps.targets, takeoverMs: deps.takeoverMs,
        commands: client.commands, read: () => client.views.assignments.store.snapshot(), subscribe: client.views.assignments.store.listen().on})
    return {
        view: client.view,
        async close() {
            await worker.close()
            client.close()
        }
    }
}

// The embedded worker is already inside the authority process. It keeps the same public
// role-aware corridor and projection, without routing through an external gateway address.
type EmbeddedDeps = {
    leader: ServiceLeader<MonitoringDefinition>,
    account: string,
    password: string,
    targets: readonly ProbeTarget[],
    takeoverMs?: number
}

export function createEmbeddedProbeWorker(deps: EmbeddedDeps) {
    const authenticated = deps.leader.serve.login({account: deps.account, password: deps.password})
    const account = deps.leader.identity.principal(authenticated.token).account
    const commands = deps.leader.corridor.fragment(account)
    function read() {return deps.leader.access.snapshot('assignments', deps.leader.access.principalOf({account})) as Assignments}
    read()
    return createProbeLoop({account, targets: deps.targets, takeoverMs: deps.takeoverMs, commands, read, subscribe: deps.leader.line.control.store.listen().on})
}

type LoopDeps = {
    account: string,
    targets: readonly ProbeTarget[],
    takeoverMs?: number,
    commands: ProbeCommands,
    read: () => Assignments,
    subscribe: (changed: () => void) => () => void
}

function createProbeLoop(deps: LoopDeps) {
    const probe = createHttpProbe({targets: deps.targets})
    const worker = createReconciler({read: deps.read, subscribe: deps.subscribe,
        async run(snapshot, ctx) {
            for (const target of snapshot.targets ?? []) {
                ctx.signal.throwIfAborted()
                const due = Math.max(target.claimUntil, target.nextAt + (target.preferred == deps.account ? 0 : deps.takeoverMs ?? 5000))
                if (due > Date.now()) {
                    ctx.retry(target.id, due - Date.now())
                    continue
                }
                const claimed = await deps.commands.probeClaim(randomUUID(), {orgId: target.orgId, id: target.id, revision: target.revision})
                if (!claimed.claim) {
                    ctx.retry(target.id, 1000)
                    continue
                }
                const result = await probe.control.check({presetId: claimed.presetId!, timeoutMs: claimed.timeoutMs!, signal: ctx.signal})
                ctx.signal.throwIfAborted()
                await deps.commands.probeReport(randomUUID(), {
                    orgId: target.orgId,
                    id: target.id,
                    revision: target.revision,
                    attempt: claimed.claim.attempt,
                    ...result
                })
            }
        }})
    const stopErrors = worker.events.errors(() => worker.control.retry('connection', 1000))
    worker.control.request()
    return {
        async close() {
            stopErrors()
            await worker.close()
        }
    }
}
