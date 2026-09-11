import type {tServiceDefinition} from 'wenay-common2/service'
import {createDocumentDomain, documentRoles} from './domain'
import {createDocumentState, type DocumentState} from './model'
import {verifySecret} from './identity'

export function createDocumentService(deps: {now?: () => number} = {}) {
    return {definition: {
        name: 'documents', storeId: 'documents-store', originId: 'documents-origin', version: 1,
        initial: createDocumentState(),
        access: {
            rolesOf: documentRoles,
            login: {input: {account: 'string', password: 'string'}, resolve(state: DocumentState, input: {account: string, password: string}) {
                const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
                return verifySecret(account?.secret, input.password) ? input.account : null
            }}
        }, ...createDocumentDomain(deps)
    } satisfies tServiceDefinition<DocumentState>}
}
export const documentsDefinition = createDocumentService().definition
