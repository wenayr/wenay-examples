import type {tServiceDefinition} from 'wenay-common2/service'
import {createDocumentDomain, documentRoles} from './domain'
import {createDocumentState, type DocumentState} from './model'
import {verifySecret} from './identity'
import {productRoles, verifyProductSecret} from './product-credentials'

export function createDocumentService(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    return {definition: {
        name: 'documents', storeId: 'documents-store', originId: 'documents-origin', version: 1,
        initial: createDocumentState(),
        access: {
            rolesOf(state: DocumentState, account: string) {
                return account.startsWith('product:') ? productRoles(state, account, now()) : documentRoles(state, account)
            },
            login: {input: {account: 'string', password: 'string'}, resolve(state: DocumentState, input: {account: string, password: string}) {
                if (input.account.startsWith('product:')) return verifyProductSecret(state, input.account, input.password, now()) ? input.account : null
                const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
                return verifySecret(account?.secret, input.password) ? input.account : null
            }}
        }, ...createDocumentDomain(deps)
    } satisfies tServiceDefinition<DocumentState>}
}
export const documentsDefinition = createDocumentService().definition
