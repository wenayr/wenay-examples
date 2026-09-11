import type {tServiceDefinition} from 'wenay-common2/service'
import {createContentState, type ContentState} from './model'
import {createContentDomain, contentRoles, own} from './domain'
import {verifySecret} from './identity'

export function createContentService(deps: {now?: () => number} = {}) {
    return {definition: {name: 'content', storeId: 'content-store', originId: 'content-origin', version: 1, limits: {perMinute: 120},
        initial: createContentState(), access: {rolesOf: contentRoles, login: {input: {account: 'string', password: 'string'}, resolve(state: ContentState, input: {account: string, password: string}) {
            return verifySecret(own(state.accounts, input.account)?.secret, input.password) ? input.account : null
        }}}, ...createContentDomain(deps)} satisfies tServiceDefinition<ContentState>}
}
export const contentDefinition = createContentService().definition
