import {mkdir, open, unlink} from 'node:fs/promises'
import path from 'node:path'
import {createResourceScope, createReconciler} from 'wenay-common2'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import {createLxdResource, MachineRejected} from './lxd'
import type {HostingDefinition} from './service'

export async function startLxdAgent(deps: {url: string, account: string, password: string, directory: string, socketPath: string, project: string, pool: string, network: string}) {
    const scope = createResourceScope()
    return scope.start(async function start(signal) {
        const resource = createLxdResource({...deps, owner: deps.account})
        await mkdir(deps.directory, {recursive: true})
        const lockPath = path.join(deps.directory, 'agent.lock')
        const lock = await scope.resource.acquire({
            open: () => open(lockPath, 'wx'),
            async close(file) { try { await file.close() } finally { await unlink(lockPath) } },
        })
        async function reconcile(snapshot: ReturnType<typeof client.views.machineAssignments.store.snapshot>) {
            if (signal.aborted || !client.health.state.connected) return
            for (const item of snapshot.operations) {
                if (signal.aborted) return
                const machine = snapshot.machines.find(machine=>machine.id == item.machine)
                if (!machine) continue
                try {
                    const operation = item.status == 'queued' ? await client.commands.claimMachineOperation('machine-claim-'+item.id, {operation: item.id, revision: item.revision}) : item
                    let result: Awaited<ReturnType<typeof resource.control.ensure>>
                    try {result = await resource.control.ensure(machine, operation.target, signal)}
                    catch (error) {
                        if (!(error instanceof MachineRejected) || signal.aborted) throw error
                        await client.commands.finishMachineOperation('machine-failed-'+item.id, {operation: item.id, revision: operation.revision, success: false, providerName: '', image: '', power: '', detail: error.message})
                        continue
                    }
                    await client.commands.finishMachineOperation('machine-finish-'+item.id, {operation: item.id, revision: operation.revision, success: true,
                        providerName: result.providerName, image: result.image, power: result.power, detail: 'Power verified; guest preparation unverified'})
                } catch (error) {
                    if (signal.aborted) return
                    console.error('Machine operation '+item.id+': reconciliation pending')
                    worker.control.retry('assignments', 5000)
                }
            }
        }

        await lock.writeFile(JSON.stringify({pid: process.pid, account: deps.account}))
        const response = await fetch(deps.url+'/api/client', {signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])})
        if (!response.ok) throw new Error('control service descriptor unavailable')
        const definition: ServiceClientDefinition<HostingDefinition> = await response.json()
        const client = createServiceClient({definition, url: deps.url, auth: {credentials: {account: deps.account, password: deps.password}}})
        const closeClient = scope.resource.own(client.close)
        await client.ready()
        if (!(await client.identity.me()).roles.includes('agent')) throw new Error('agent role is required')
        await client.views.machineAssignments.ready
        const worker = createReconciler({signal, read: () => client.views.machineAssignments.store.snapshot(), run: reconcile,
            subscribe: client.views.machineAssignments.store.listen().on,
        })
        scope.resource.parallel([worker.close, closeClient])
        scope.resource.own(worker.events.errors(function failed() {console.error('LXD reconciliation failed')}))
        worker.control.request()
        return {close: scope.close, view: {account: ()=>deps.account}}
    })
}
