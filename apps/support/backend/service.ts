import type {tServiceDefinition} from 'wenay-common2/service'
import {createSupportDomain, supportRoles} from './domain'
import {createSupportState, type SupportState} from './model'
import {verifySecret} from './identity'
import {verifyProductSecret} from './product-credentials'

export {DEMO_LOGINS} from './model'

export function createSupportService(deps: {now?: () => number} = {}) {
    const domain = createSupportDomain(deps)
    const now = deps.now ?? Date.now
    return {
        definition: {
            name: 'support', storeId: 'support-store', originId: 'support-origin', version: 1,
            initial: createSupportState(),
            access: {
                rolesOf: (state: SupportState, account: string) => supportRoles(state, account, now()),
                login: {
                    input: {account: 'string', password: 'string'},
                    resolve(state: SupportState, input: {account: string, password: string}) {
                        if (input.account.startsWith('product:')) return verifyProductSecret(state, input.account, input.password, now()) ? input.account : null
                        const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
                        return verifySecret(account?.secret, input.password) ? input.account : null
                    }
                }
            },
            ...domain
        } satisfies tServiceDefinition<SupportState>
    }
}

export const supportDefinition = createSupportService().definition
export const serviceDefinition = supportDefinition
export type SupportDefinition = typeof supportDefinition
