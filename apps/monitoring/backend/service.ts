import type {tServiceDefinition} from 'wenay-common2/service'
import {createMonitoringDomain, monitoringRoles} from './domain'
import {createMonitoringState, type MonitoringState, type Preset} from './model'
import {verifySecret} from './identity'
import {createTenantOrganizer} from './organizer'

export function createMonitoringService(deps: Parameters<typeof createMonitoringDomain>[0] & {presets?: Preset[]} = {}) {
    const organizer = createTenantOrganizer()
    const domain = createMonitoringDomain({...deps, incidentOpened: organizer.incidentOpened})
    return {definition: {
        name: 'monitoring', storeId: 'monitoring-store', originId: 'monitoring-origin',
        version: 1, limits: {perMinute: 1200}, initial: createMonitoringState(deps),
        access: {rolesOf: monitoringRoles, login: {
            input: {account: 'string', password: 'string'},
            resolve(state: MonitoringState, input: {account: string, password: string}) {
            const account = Object.hasOwn(state.accounts, input.account) ? state.accounts[input.account] : undefined
            return verifySecret(account?.secret, input.password) ? input.account : null
        }}}, commands: {...domain.commands, ...organizer.commands}, views: {...domain.views, ...organizer.views}
    } satisfies tServiceDefinition<MonitoringState>}
}
export const monitoringDefinition = createMonitoringService().definition
