import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServiceDefinition, type tServicePrincipal} from 'wenay-common2/service'
import {workload, type Workload} from './workload'
import {createMachines, type Machine, type MachineOperation} from './machines'
import {localEndpoint} from './endpoint'

export const roles = ['admin', 'owner', 'operator', 'observer', 'agent'] as const
export const targetKinds = ['container', 'virtual-machine', 'kubernetes', 'docker'] as const
type tRole = typeof roles[number]
type tTargetKind = typeof targetKinds[number]
type tOperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type AccountConfig = {account: string, password: string, role: tRole, projects: string[]}
type Release = {id: string, project: string, version: string, artifact: string, createdBy: string, workload?: Workload}
type Environment = {id: string, project: string, kind: tTargetKind, agent: string, revision: number, desired: string, active: string, pending: string, endpoint?: string, route?: string, activeOperation?: string}
type Operation = {id: string, environment: string, project: string, release: string, previous: string, action: 'deploy' | 'rollback', status: tOperationStatus, revision: number, agent: string, requestedBy: string, detail: string, cleaned?: boolean}
export type HostingState = {
    accounts: Record<string, {role: tRole, projects: string[]}>
    projects: Record<string, {id: string, title: string}>
    releases: Record<string, Release>
    environments: Record<string, Environment>
    operations: Record<string, Operation>
    machines: Record<string, Machine>
    machineOperations: Record<string, MachineOperation>
}
type Context = ServiceCommandCtx<HostingState>

function identifier(value: string) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(value) || Object.hasOwn(Object.prototype, value)) throw new Error('expected a non-reserved lowercase identifier, 1..63 characters')
}

function hasProject(state: HostingState, account: string, project: string) {
    const member = state.accounts[account]
    return member?.role == 'admin' || !!member?.projects.includes(project)
}

function requireProject(ctx: Context, project: string) {
    identifier(project)
    if (!ctx.state.projects[project] || !hasProject(ctx.state, ctx.account, project)) throw new Error('project unavailable')
}

function operationId(ctx: Context) {
    return createHash('sha256').update(JSON.stringify([ctx.account, ctx.requestId])).digest('hex')
}

export function createHostingDefinition(deps: {accounts: AccountConfig[]}) {
    const initial: HostingState = {accounts: {}, projects: {}, releases: {}, environments: {}, operations: {}, machines: {}, machineOperations: {}}
    const machines = createMachines({identifier, requireProject, hasProject, operationId})
    const secrets = new Map<string, {salt: Buffer, hash: Buffer}>()
    for (const account of deps.accounts) {
        identifier(account.account)
        if (secrets.has(account.account) || !roles.includes(account.role) || typeof account.password != 'string' || account.password.length < 16 || account.password.length > 1024 || account.password.startsWith('REPLACE-WITH-')) throw new Error('invalid or duplicate account configuration; replace example passwords with unique secrets of 16..1024 characters')
        for (const project of account.projects) identifier(project)
        const salt = randomBytes(16)
        secrets.set(account.account, {salt, hash: scryptSync(account.password, salt, 32)})
        initial.accounts[account.account] = {role: account.role, projects: [...account.projects]}
    }
    if (!deps.accounts.some(account=>account.role == 'admin')) throw new Error('an administrator is required')

    function requestDeployment(ctx: Context, input: {environment: string, release: string, revision: number}, action: 'deploy' | 'rollback') {
        const environment = ctx.state.environments[input.environment]
        if (!environment) throw new Error('environment unavailable')
        requireProject(ctx, environment.project)
        if (environment.revision != input.revision) throw new Error('stale environment revision')
        if (environment.pending) throw new Error('environment already has a pending operation')
        const release = ctx.state.releases[input.release]
        if (!release || release.project != environment.project) throw new Error('release unavailable')
        const active = ctx.state.releases[environment.active]
        if (active && active.workload?.dataVersion != release.workload?.dataVersion) throw new Error('storage contract changed: use a separate environment and an explicit migration/restore')
        if (action == 'rollback' && !Object.values(ctx.state.operations).some(item=>item.environment == environment.id && item.release == release.id && item.status == 'succeeded')) throw new Error('rollback requires a previously successful release in this environment')
        const id = operationId(ctx)
        const operation: Operation = {id, environment: environment.id, project: environment.project, release: release.id, previous: environment.active, action, status: 'queued', revision: 0, agent: environment.agent, requestedBy: ctx.account, detail: ''}
        ctx.state.operations[id] = operation
        environment.desired = release.id
        environment.pending = id
        environment.revision++
        return {...operation}
    }

    function agentOperation(ctx: Context, input: {operation: string, revision: number}) {
        const operation = ctx.state.operations[input.operation]
        if (!operation || operation.agent != ctx.account || !hasProject(ctx.state, ctx.account, operation.project)) throw new Error('operation unavailable')
        if (operation.revision != input.revision) throw new Error('stale operation revision')
        const environment = ctx.state.environments[operation.environment]
        if (environment.pending != operation.id) throw new Error('operation no longer owns environment')
        return {operation, environment}
    }

    const deploymentInput = {environment: 'string', release: 'string', revision: 'number'} as const
    return {
        name: 'hosting', storeId: 'hosting-store', originId: 'hosting-origin', version: 2,
        initial,
        migrate(state: HostingState, fromVersion: number) {
            if (fromVersion != 1) throw new Error('unsupported hosting archive version')
            return {...state, machines: {}, machineOperations: {}}
        },
        access: {
            rolesOf: (state: HostingState, account: string)=>state.accounts[account] ? [state.accounts[account].role] : [],
            login: {input: {account: 'string', password: 'string'}, resolve(state: HostingState, input: {account: string, password: string}) {
                const secret = secrets.get(input.account)
                if (!secret || !state.accounts[input.account] || input.password.length > 1024) return null
                return timingSafeEqual(scryptSync(input.password, secret.salt, 32), secret.hash) ? input.account : null
            }},
        },
        commands: {
            ...machines.commands,
            registerRoute: schemaCommand({environment: 'string', endpoint: 'string'}, {
                allow: ['agent'],
                validate(input) {localEndpoint(input.endpoint)},
                apply(ctx: Context, input) {
                    const environment = ctx.state.environments[input.environment]
                    if (!environment || environment.kind != 'docker' || environment.agent != ctx.account || !hasProject(ctx.state, ctx.account, environment.project)) throw new Error('environment unavailable')
                    if (environment.route && environment.route != input.endpoint) throw new Error('stable route is immutable')
                    if (Object.values(ctx.state.environments).some(item=>item.id != environment.id && item.route == input.endpoint)) throw new Error('route already assigned')
                    environment.route = input.endpoint
                    return {endpoint: input.endpoint}
                },
            }),
            confirmCleanup: schemaCommand({operation: 'string'}, {
                allow: ['agent'],
                apply(ctx: Context, input) {
                    const operation = ctx.state.operations[input.operation]
                    if (!operation || operation.agent != ctx.account || !hasProject(ctx.state, ctx.account, operation.project)) throw new Error('operation unavailable')
                    const environment = ctx.state.environments[operation.environment]
                    if (environment.kind != 'docker' || !environment.activeOperation || environment.activeOperation == operation.id || environment.pending == operation.id || !['succeeded', 'failed'].includes(operation.status)) throw new Error('operation is not eligible for cleanup')
                    operation.cleaned = true
                    return {operation: operation.id, cleaned: true}
                },
            }),
            createProject: schemaCommand({id: 'string', title: 'string'}, {
                allow: ['admin'],
                validate(input) {
                    identifier(input.id)
                    if (!input.title.trim() || input.title.length > 120) throw new Error('invalid project title')
                },
                apply(ctx: Context, input) {
                    if (ctx.state.projects[input.id]) throw new Error('project already exists')
                    ctx.state.projects[input.id] = {...input}
                    return {...input}
                },
            }),
            createEnvironment: schemaCommand({id: 'string', project: 'string', kind: 'string', agent: 'string'}, {
                allow: ['admin', 'owner'],
                validate(input) {
                    identifier(input.id)
                    if (!targetKinds.includes(input.kind as tTargetKind)) throw new Error('unsupported target kind')
                },
                apply(ctx: Context, input) {
                    requireProject(ctx, input.project)
                    if (ctx.state.environments[input.id]) throw new Error('environment already exists')
                    if (ctx.state.accounts[input.agent]?.role != 'agent' || !hasProject(ctx.state, input.agent, input.project)) throw new Error('agent unavailable for project')
                    const environment: Environment = {...input, kind: input.kind as tTargetKind, revision: 0, desired: '', active: '', pending: ''}
                    ctx.state.environments[input.id] = environment
                    return {...environment}
                },
            }),
            publishRelease: schemaCommand({id: 'string', project: 'string', version: 'string', artifact: 'string', port: 'number?', healthPath: 'string?', memoryMiB: 'number?', cpus: 'number?', dataVersion: 'string?'}, {
                allow: ['admin', 'owner', 'operator'],
                validate(input) {
                    identifier(input.id)
                    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.version)) throw new Error('invalid version')
                    if (!/^[a-z0-9][a-z0-9./:_-]{0,240}@sha256:[a-f0-9]{64}$/.test(input.artifact)) throw new Error('release requires an OCI reference pinned by SHA-256 digest')
                    workload({port: input.port, healthPath: input.healthPath, memoryMiB: input.memoryMiB, cpus: input.cpus, dataVersion: input.dataVersion})
                },
                apply(ctx: Context, input) {
                    requireProject(ctx, input.project)
                    if (ctx.state.releases[input.id] || Object.values(ctx.state.releases).some(item=>item.project == input.project && item.version == input.version)) throw new Error('release is immutable; publish a new version')
                    const release: Release = {id: input.id, project: input.project, version: input.version, artifact: input.artifact, createdBy: ctx.account,
                        workload: workload({port: input.port, healthPath: input.healthPath, memoryMiB: input.memoryMiB, cpus: input.cpus, dataVersion: input.dataVersion})}
                    ctx.state.releases[input.id] = release
                    return {...release}
                },
            }),
            deploy: schemaCommand(deploymentInput, {allow: ['admin', 'owner', 'operator'], apply(ctx: Context, input) {return requestDeployment(ctx, input, 'deploy')}}),
            rollback: schemaCommand(deploymentInput, {allow: ['admin', 'owner', 'operator'], apply(ctx: Context, input) {return requestDeployment(ctx, input, 'rollback')}}),
            cancelQueued: schemaCommand({operation: 'string', revision: 'number'}, {
                allow: ['admin', 'owner', 'operator'],
                apply(ctx: Context, input) {
                    const operation = ctx.state.operations[input.operation]
                    if (!operation) throw new Error('operation unavailable')
                    requireProject(ctx, operation.project)
                    if (operation.revision != input.revision || operation.status != 'queued') throw new Error('only the current queued operation can be cancelled')
                    const environment = ctx.state.environments[operation.environment]
                    operation.status = 'cancelled'
                    operation.revision++
                    environment.pending = ''
                    environment.desired = environment.active
                    environment.revision++
                    return {...operation}
                },
            }),
            claimOperation: schemaCommand({operation: 'string', revision: 'number'}, {
                allow: ['agent'],
                apply(ctx: Context, input) {
                    const {operation} = agentOperation(ctx, input)
                    if (operation.status != 'queued') throw new Error('operation is not queued')
                    operation.status = 'running'
                    operation.revision++
                    return {...operation}
                },
            }),
            finishOperation: schemaCommand({operation: 'string', revision: 'number', success: 'boolean', observedArtifact: 'string', detail: 'string', endpoint: 'string?'}, {
                allow: ['agent'],
                validate(input) {
                    if (input.detail.length > 500) throw new Error('detail exceeds 500 characters')
                    if (input.endpoint) localEndpoint(input.endpoint)
                },
                apply(ctx: Context, input) {
                    const {operation, environment} = agentOperation(ctx, input)
                    if (operation.status != 'running') throw new Error('operation is not running')
                    if (input.success && input.observedArtifact != ctx.state.releases[operation.release].artifact) throw new Error('observed artifact does not match requested release')
                    if (!input.success && input.endpoint && input.observedArtifact != ctx.state.releases[operation.previous]?.artifact) throw new Error('restored artifact does not match previous release')
                    operation.status = input.success ? 'succeeded' : 'failed'
                    operation.detail = input.detail
                    operation.revision++
                    if (input.success) {environment.active = operation.release; environment.activeOperation = operation.id; environment.endpoint = input.endpoint ?? ''}
                    else if (input.endpoint) environment.endpoint = input.endpoint
                    environment.pending = ''
                    environment.revision++
                    return {...operation}
                },
            }),
        },
        views: {
            ...machines.views,
            dashboard: {
                allow: ['admin', 'owner', 'operator', 'observer'],
                keys: ['accounts', 'projects', 'releases', 'environments', 'operations'],
                project(state: HostingState, principal: tServicePrincipal | null) {
                    const account = principal?.account ?? ''
                    return {
                        projects: Object.values(state.projects).filter(item=>hasProject(state, account, item.id)),
                        releases: Object.values(state.releases).filter(item=>hasProject(state, account, item.project)),
                        environments: Object.values(state.environments).filter(item=>hasProject(state, account, item.project)),
                        operations: Object.values(state.operations).filter(item=>hasProject(state, account, item.project)),
                    }
                },
            },
            assignments: {
                allow: ['agent'], keys: ['accounts', 'operations', 'environments', 'releases'],
                project(state: HostingState, principal: tServicePrincipal | null) {
                    const account = principal?.account ?? ''
                    const environments = Object.values(state.environments).filter(item=>item.agent == account && hasProject(state, account, item.project))
                    const operations = Object.values(state.operations).filter(item=>item.agent == account && hasProject(state, account, item.project) && ['queued', 'running'].includes(item.status))
                    const retained = Object.values(state.operations).filter(item=>environments.some(environment=>environment.id == item.environment) && ['succeeded', 'failed'].includes(item.status) && !item.cleaned)
                    return {environments, operations, retained, releases: Object.values(state.releases).filter(item=>[...operations, ...retained].some(operation=>operation.release == item.id))}
                },
            },
        },
    } satisfies tServiceDefinition<HostingState>
}

export type HostingDefinition = ReturnType<typeof createHostingDefinition>
