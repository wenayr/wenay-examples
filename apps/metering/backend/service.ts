import type {tServiceDefinition, tServicePrincipal} from 'wenay-common2/service'
import {createMeteringState, type MeteringState} from './model'
import {createMeteringDomain, meteringRoles, verifyApiSecret} from './domain'
import {verifySecret} from './identity'
import {createBillingDomain, billingWorkspace, withUsageDeliveries} from './billing-domain'

export function createMeteringService(deps: {now?: () => number, retryMs?: number} = {}) {
    const now = deps.now ?? Date.now
    const domain = createMeteringDomain(deps)
    const billing = createBillingDomain(deps)
    return {definition: {
        name: 'metering', storeId: 'metering-store', originId: 'metering-origin', version: 1, limits: {perMinute: 120},
        initial: createMeteringState(),
        access: {rolesOf: (state: MeteringState, account: string) => meteringRoles(state, account, now()),
            login: {input: {account: 'string', password: 'string'}, resolve(state: MeteringState, input: {account: string, password: string}) {
                if (input.account.startsWith('key:')) return verifyApiSecret(state, input.account, input.password, now()) ? input.account : null
                const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
                return verifySecret(account?.secret, input.password) ? input.account : null
            }}
        }, commands: {...withUsageDeliveries(domain.commands, deps), ...billing.commands},
        views: {workspace: {allow: ['owner', 'auditor'], project(state: MeteringState, principal: tServicePrincipal | null) {
            return {...domain.views.workspace.project(state, principal), ...billingWorkspace(state, principal)}
        }}}
    } satisfies tServiceDefinition<MeteringState>}
}
export const meteringDefinition = createMeteringService().definition
