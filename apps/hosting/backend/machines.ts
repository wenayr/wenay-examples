import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {machineIdentity, validateMachineSpec, type MachineSpec} from './machine-spec'
import type {HostingState} from './service'

type tPower = 'running' | 'stopped'
export type Machine = {
    id: string,
    project: string,
    agent: string,
    spec: MachineSpec,
    revision: number,
    desired: tPower,
    power: tPower | 'unknown',
    preparation: 'unverified',
    pending: string,
    providerName: string
}
export type MachineOperation = {
    id: string,
    machine: string,
    project: string,
    agent: string,
    target: tPower,
    revision: number,
    status: 'queued' | 'running' | 'succeeded' | 'failed',
    detail: string
}
type Context = ServiceCommandCtx<HostingState>

export function createMachines(deps: {
    identifier: (value: string) => void,
    requireProject: (ctx: Context, project: string) => void,
    hasProject: (state: HostingState, account: string, project: string) => boolean,
    operationId: (ctx: Context) => string,
}) {
    function enqueue(ctx: Context, machine: Machine, target: tPower) {
        const id = deps.operationId(ctx)
        const operation: MachineOperation = {
            id,
            machine: machine.id,
            project: machine.project,
            agent: machine.agent,
            target,
            revision: 0,
            status: 'queued',
            detail: ''
        }
        ctx.state.machineOperations[id] = operation
        machine.pending = id
        machine.desired = target
        machine.revision++
        return {...operation}
    }

    function agentOperation(ctx: Context, input: {operation: string, revision: number}) {
        const operation = ctx.state.machineOperations[input.operation]
        const own = operation && operation.agent == ctx.account
        const allowed = own && deps.hasProject(ctx.state, ctx.account, operation.project)
        if (!allowed) throw new Error('machine operation unavailable')
        const machine = ctx.state.machines[operation.machine]
        if (operation.revision != input.revision || machine.pending != operation.id) throw new Error('stale machine operation')
        return {operation, machine}
    }

    function visible(state: HostingState, principal: tServicePrincipal | null) {
        const account = principal?.account ?? ''
        return Object.values(state.machines).filter(item => deps.hasProject(state, account, item.project))
    }

    return {
        commands: {
            createMachine: schemaCommand({
                id: 'string',
                project: 'string',
                agent: 'string',
                kind: 'string',
                image: 'string',
                cpus: 'number',
                memoryMiB: 'number',
                diskGiB: 'number',
                sshKey: 'string'
            }, {
                allow: ['admin', 'owner'],
                validate(input) {
                    deps.identifier(input.id)
                    validateMachineSpec({...input, kind: input.kind as MachineSpec['kind']})
                },
                apply(ctx: Context, input) {
                    deps.requireProject(ctx, input.project)
                    if (ctx.state.machines[input.id]) throw new Error('machine already exists')
                    const agent = ctx.state.accounts[input.agent]?.role == 'agent'
                    const assigned = deps.hasProject(ctx.state, input.agent, input.project)
                    if (!agent || !assigned) throw new Error('agent unavailable for project')
                    const spec: MachineSpec = {
                        kind: input.kind as MachineSpec['kind'],
                        image: input.image,
                        cpus: input.cpus,
                        memoryMiB: input.memoryMiB,
                        diskGiB: input.diskGiB,
                        sshKey: input.sshKey
                    }
                    const machine: Machine = {
                        id: input.id,
                        project: input.project,
                        agent: input.agent,
                        spec,
                        revision: 0,
                        desired: 'running',
                        power: 'unknown',
                        preparation: 'unverified',
                        pending: '',
                        providerName: ''
                    }
                    ctx.state.machines[machine.id] = machine
                    return enqueue(ctx, machine, 'running')
                },
            }),
            setMachinePower: schemaCommand({machine: 'string', revision: 'number', target: 'string'}, {
                allow: ['admin', 'owner', 'operator'],
                validate(input) {if (!['running', 'stopped'].includes(input.target)) throw new Error('invalid power target')},
                apply(ctx: Context, input) {
                    const machine = ctx.state.machines[input.machine]
                    if (!machine) throw new Error('machine unavailable')
                    deps.requireProject(ctx, machine.project)
                    if (machine.revision != input.revision || machine.pending) throw new Error('stale or busy machine')
                    return enqueue(ctx, machine, input.target as tPower)
                },
            }),
            claimMachineOperation: schemaCommand({operation: 'string', revision: 'number'}, {
                allow: ['agent'],
                apply(ctx: Context, input) {
                    const {operation} = agentOperation(ctx, input)
                    if (operation.status != 'queued') throw new Error('machine operation is not queued')
                    operation.status = 'running'
                    operation.revision++
                    return {...operation}
                },
            }),
            finishMachineOperation: schemaCommand({
                operation: 'string',
                revision: 'number',
                success: 'boolean',
                providerName: 'string',
                image: 'string',
                power: 'string',
                detail: 'string'
            }, {
                allow: ['agent'],
                validate(input) {if (input.detail.length > 500) throw new Error('detail exceeds 500 characters')},
                apply(ctx: Context, input) {
                    const {operation, machine} = agentOperation(ctx, input)
                    if (operation.status != 'running') throw new Error('machine operation is not running')
                    const identity = machineIdentity({...machine, owner: machine.agent})
                    const named = input.providerName == identity.name
                    const expected = named && input.image == machine.spec.image
                    if (input.success && (!expected || input.power != operation.target)) {
                        throw new Error('observed machine does not match request')
                    }
                    operation.status = input.success ? 'succeeded' : 'failed'
                    operation.detail = input.detail
                    operation.revision++
                    machine.pending = ''
                    machine.revision++
                    // Hypervisor power is not evidence that cloud-init, a runtime or an application is ready.
                    machine.preparation = 'unverified'
                    if (input.success) {
                        machine.power = operation.target
                        machine.providerName = input.providerName
                    }
                    else machine.power = 'unknown'
                    return {...operation}
                },
            }),
        },
        views: {
            machineDashboard: {
                allow: ['admin', 'owner', 'operator', 'observer'], keys: ['accounts', 'machines', 'machineOperations'],
                project(state: HostingState, principal: tServicePrincipal | null) {
                    const machines = visible(state, principal)
                    return {machines, operations: Object.values(state.machineOperations).filter(item => machines.some(machine => machine.id == item.machine))}
                },
            },
            machineAssignments: {
                allow: ['agent'], keys: ['accounts', 'machines', 'machineOperations'],
                project(state: HostingState, principal: tServicePrincipal | null) {
                    const machines = visible(state, principal).filter(item => item.agent == principal?.account)
                    const operations = Object.values(state.machineOperations).filter(function live(item) {
                        if (!machines.some(machine => machine.id == item.machine)) return false
                        return ['queued', 'running'].includes(item.status)
                    })
                    return {machines, operations}
                },
            },
        },
    }
}
