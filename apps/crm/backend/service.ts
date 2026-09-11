import type {tServiceDefinition} from 'wenay-common2/service'
import {createCrmState, type CrmState} from './model'
import {createCrmDomain, crmRoles} from './domain'
import {createTenantOrganizer} from './organizer'
import {verifySecret} from './identity'
import {createImportDomain} from './imports'

export function createCrmService(deps: {now?: () => number} = {}) {
    const organizer = createTenantOrganizer()
    const domain = createCrmDomain({...deps, accepted: organizer.accepted})
    const imports = createImportDomain()
    return {definition: {
        name: 'crm', storeId: 'crm-store', originId: 'crm-origin', version: 1, limits: {perMinute: 120},
        initial: createCrmState(),
        access: {rolesOf: crmRoles, login: {input: {account: 'string', password: 'string'}, resolve(state: CrmState, input: {account: string, password: string}) {
            const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return verifySecret(account?.secret, input.password) ? input.account : null
        }}},
        commands: {...domain.commands, ...organizer.commands, ...imports.commands}, views: {...domain.views, ...organizer.views, ...imports.views}
    } satisfies tServiceDefinition<CrmState>}
}
export const crmDefinition = createCrmService().definition
