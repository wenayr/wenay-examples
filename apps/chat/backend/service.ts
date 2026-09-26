import type {tServiceDefinition} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import {hashSecret, verifySecret, type tSecret} from './identity'
import {createChatResource} from './chat-resource'

export type ChatState = {accounts: Record<string, {name: string, secret: tSecret, enabled: boolean}>}

export function createChatService(deps: {directory: string}) {
    const initial: ChatState = {accounts: {
        alice: {name: 'Алиса', secret: hashSecret('alice-pass'), enabled: true},
        bob: {name: 'Боб', secret: hashSecret('bob-pass'), enabled: true}
    }}
    let store: Store<ChatState> | null = null
    function member(account: string) {
        const accounts = store?.state.accounts ?? initial.accounts
        return Object.hasOwn(accounts, account) && accounts[account].enabled
    }
    const chat = createChatResource({directory: deps.directory, member})
    const definition = {
        name: 'chat', storeId: 'chat-store', originId: 'chat-origin', version: 1, initial,
        access: {rolesOf: (state: ChatState, account: string) =>
            Object.hasOwn(state.accounts, account) && state.accounts[account].enabled ? ['member'] : [],
        login: {input: {account: 'string', password: 'string'}, resolve(state: ChatState, input: {account: string, password: string}) {
            const found = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return found?.enabled && verifySecret(found.secret, input.password) ? input.account : null
        }}},
        commands: {}, views: {members: {allow: ['member'], project(state: ChatState) {
            return Object.entries(state.accounts).filter(([, account]) => account.enabled).map(([account, value]) => ({account, name: value.name}))
        }}}, resources: {chat: chat.resource}
    } satisfies tServiceDefinition<ChatState>
    function mount(input: Store<ChatState>) {
        store = input
        return function close() {chat.close()
        store = null}
    }
    return {definition, mount}
}
export type ChatDefinition = ReturnType<typeof createChatService>['definition']
