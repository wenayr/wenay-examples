import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import type {ChatState} from './service'

export const workspaceRegistry = {
    team: {name: 'Команда', resourceName: 'chat', membershipCommand: 'teamMemberSet'},
    personal: {name: 'Личное пространство', resourceName: 'chatPersonal', membershipCommand: 'personalMemberSet'}
} as const
export type tWorkspaceId = keyof typeof workspaceRegistry
export type tMembershipRole = 'owner' | 'member'

export function initialWorkspaces() {
    return {
        team: {id: 'team', name: workspaceRegistry.team.name, members: {alice: 'owner', bob: 'member'} as Record<string, tMembershipRole>},
        personal: {id: 'personal', name: workspaceRegistry.personal.name, members: {alice: 'owner'} as Record<string, tMembershipRole>}
    }
}

export function workspaceMember(state: ChatState, workspaceId: tWorkspaceId, account: string) {
    return Object.hasOwn(state.accounts, account) && state.accounts[account].enabled
        && Object.hasOwn(state.workspaces[workspaceId].members, account)
}

export function workspaceRoles(state: ChatState, account: string) {
    if (!Object.hasOwn(state.accounts, account) || !state.accounts[account].enabled) return []
    const roles = ['member']
    for (const id of Object.keys(workspaceRegistry) as tWorkspaceId[]) {
        if (!workspaceMember(state, id, account)) continue
        roles.push('workspace:' + id)
        if (state.workspaces[id].members[account] == 'owner') roles.push('workspace-owner:' + id)
    }
    return roles
}

export function projectWorkspaces(state: ChatState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const workspaces = (Object.keys(workspaceRegistry) as tWorkspaceId[]).filter(id => workspaceMember(state, id, account)).map(function project(id) {
        const workspace = state.workspaces[id]
        const members = Object.entries(workspace.members).filter(([account]) => workspaceMember(state, id, account))
            .map(([account, role]) => ({account, name: state.accounts[account].name, role}))
        return {id, ...workspaceRegistry[id], name: workspace.name, members}
    })
    // ServiceClient mirrors view roots into an object store; arrays belong under a stable object field.
    return {workspaces}
}

// Binding the command to one workspace lets native access check its current owner role before receipt replay.
export function createMembershipCommand(workspaceId: tWorkspaceId) {
    return schemaCommand({account: 'string', role: {enum: ['none', 'member', 'owner']}} as const, {
        allow: ['workspace-owner:' + workspaceId],
        apply(ctx: ServiceCommandCtx<ChatState>, input) {
            const workspace = ctx.state.workspaces[workspaceId]
            if (!workspace || !workspaceMember(ctx.state, workspaceId, ctx.account) || workspace.members[ctx.account] != 'owner') {
                throw new Error('Изменять участников может только текущий владелец пространства')
            }
            if (!Object.hasOwn(ctx.state.accounts, input.account) || !ctx.state.accounts[input.account].enabled) {
                throw new Error('Аккаунт участника не существует или отключён')
            }
            const owners = Object.values(workspace.members).filter(role => role == 'owner').length
            if (workspace.members[input.account] == 'owner' && input.role != 'owner' && owners <= 1) {
                throw new Error('Нельзя удалить или понизить последнего владельца')
            }
            if (input.role == 'none') delete workspace.members[input.account]
            else workspace.members[input.account] = input.role
            return {workspaceId, account: input.account, role: input.role}
        }
    })
}
