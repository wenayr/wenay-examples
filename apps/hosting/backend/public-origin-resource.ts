import {createHash} from 'node:crypto'
import {buildInputValidate, schemaCommand, SYSTEM_ACCOUNT, type ServiceCommandCtx, type ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import type {HostingState} from './service'
import {publicOrigin} from './endpoint'

const inputSchema = {environment: 'string', revision: 'number', publicOrigin: 'string'} as const
const validateInput = buildInputValidate({...inputSchema, requestId: 'string'})
type Input = {requestId: string, environment: string, revision: number, publicOrigin: string}

export function createPublicOrigin(deps: {hasProject: (state: HostingState, account: string, project: string) => boolean}) {
    function authorize(state: HostingState, actor: string, environmentId: string) {
        const account = state.accounts[actor], environment = state.environments[environmentId]
        const role = account?.role == 'admin' || account?.role == 'owner'
        const project = !!environment && !!state.projects[environment.project]
        const member = deps.hasProject(state, actor, environment?.project ?? '')
        if (!role || !project || !member) throw new Error('environment unavailable')
        return environment
    }
    let store: Store<HostingState> | null = null
    let generation = 0
    const command = schemaCommand({...inputSchema, actor: 'string'}, {allow: ['system'],
        validate(input) {if (input.publicOrigin) publicOrigin(input.publicOrigin)},
        apply(ctx: ServiceCommandCtx<HostingState>, input) {
            if (ctx.account != SYSTEM_ACCOUNT) throw new Error('Only the server may configure public origin')
            const environment = authorize(ctx.state, input.actor, input.environment)
            if (environment.kind != 'docker') throw new Error('public origin requires a Docker environment')
            if (environment.revision != input.revision) throw new Error('stale environment revision')
            const started = Object.values(ctx.state.operations).some(operation => operation.environment == environment.id)
            if (environment.active || environment.pending || started) {
                throw new Error('Configure public origin before the first deployment; changing a deployed domain is not implemented')
            }
            const origin = input.publicOrigin ? publicOrigin(input.publicOrigin) : ''
            const taken = !!origin && Object.values(ctx.state.environments).some(item => item.id != environment.id && item.publicOrigin == origin)
            if (taken) throw new Error('public origin already assigned')
            if (origin) environment.publicOrigin = origin
            else delete environment.publicOrigin
            environment.revision++
            return {environment: environment.id, publicOrigin: origin, revision: environment.revision}
        }})
    type SetOrigin = (requestId: string, input: Parameters<typeof command.apply>[1]) => Promise<ReturnType<typeof command.apply>>
    let setOrigin: SetOrigin | undefined
    const resource = {allow: ['admin', 'owner'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const opened = generation
        let closed = false
        function guard(environment: string) {
            ctx.signal.throwIfAborted()
            const obsolete = closed || opened != generation
            if (obsolete || !store || !setOrigin) throw new Error('public origin resource closed')
            authorize(store.state, ctx.principal.account, environment)
        }
        async function set(input: Input) {
            guard(input.environment)
            validateInput(input)
            if (!input.requestId || input.requestId.length > 120) throw new Error('requestId: 1..120 characters')
            const requestId = createHash('sha256').update(JSON.stringify([ctx.principal.account, 'public-origin', input.requestId])).digest('hex')
            const result = await setOrigin!(requestId, {
                actor: ctx.principal.account, environment: input.environment, revision: input.revision, publicOrigin: input.publicOrigin
            })
            guard(input.environment)
            guard(result.environment)
            return result
        }
        return {facade: {control: {set}}, close() {closed = true}}
    }}
    return {command, resource, mount(deps: {store: Store<HostingState>, setOrigin: SetOrigin}) {
        const mounted = ++generation
        store = deps.store
        setOrigin = deps.setOrigin
        return function close() {
            if (mounted != generation) return
            generation++
            store = null
            setOrigin = undefined
        }
    }}
}
