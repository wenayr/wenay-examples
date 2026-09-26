import type {tServiceDefinition} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import {hashSecret, verifySecret, type tSecret} from './identity'
import {createChatResource} from './chat-resource'
import path from 'node:path'
import {createMembershipCommand, initialWorkspaces, projectWorkspaces, workspaceMember, workspaceRoles} from './workspaces'

export type ChatState = {
    accounts: Record<string, {name: string, secret: tSecret, enabled: boolean}>
    workspaces: ReturnType<typeof initialWorkspaces>
}

export function createChatService(deps: {directory: string}) {
    const initial: ChatState = {accounts: {
        alice: {name: 'Алиса', secret: hashSecret('alice-pass'), enabled: true},
        bob: {name: 'Боб', secret: hashSecret('bob-pass'), enabled: true}
    }, workspaces: initialWorkspaces()}
    let store: Store<ChatState> | null = null
    function member(account: string) {
        return workspaceMember(store?.state ?? initial, 'team', account)
    }
    const chat = createChatResource({directory: deps.directory, member, allow: ['workspace:team']})
    const chatPersonal = createChatResource({directory: path.join(deps.directory, 'personal'),
        member: account => workspaceMember(store?.state ?? initial, 'personal', account), allow: ['workspace:personal'], personal: true})
    const definition = {
        name: 'chat', storeId: 'chat-store', originId: 'chat-origin', version: 2, initial,
        migrate(state: ChatState) {return {...state, workspaces: state.workspaces ?? initialWorkspaces()}},
        access: {rolesOf: workspaceRoles,
        login: {input: {account: 'string', password: 'string'}, resolve(state: ChatState, input: {account: string, password: string}) {
            const found = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return found?.enabled && verifySecret(found.secret, input.password) ? input.account : null
        }}},
        commands: {teamMemberSet: createMembershipCommand('team'), personalMemberSet: createMembershipCommand('personal')},
        views: {workspaces: {allow: ['member'], project: projectWorkspaces}},
        resources: {chat: chat.resource, chatPersonal: chatPersonal.resource}
    } satisfies tServiceDefinition<ChatState>
    function mount(input: Store<ChatState>) {
        store = input
        return close
    }
    function close() {chat.close()
        chatPersonal.close()
        store = null
    }
    return {definition, mount, close}
}
export type ChatDefinition = ReturnType<typeof createChatService>['definition']
