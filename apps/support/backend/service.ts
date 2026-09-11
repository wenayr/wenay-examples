import type {tServiceDefinition} from 'wenay-common2/service'
import {createSupportDomain, supportRoles} from './domain'
import {createSupportState, type SupportState} from './model'
import {verifySecret} from './identity'

export {DEMO_LOGINS} from './model'

export function createSupportService(deps: {now?: () => number} = {}) {
    const domain = createSupportDomain(deps)
    return {
        definition: {
            name: 'support', storeId: 'support-store', originId: 'support-origin', version: 1,
            initial: createSupportState(),
            access: {
                rolesOf: supportRoles,
                login: {
                    input: {account: 'string', password: 'string'},
                    resolve(state: SupportState, input: {account: string, password: string}) {
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
