import {createHostingDefinition, hasProject, type AccountConfig} from './service'
import {createPublicOrigin} from './public-origin-resource'

export function createHostingRuntime(deps: {accounts: AccountConfig[]}) {
    const base = createHostingDefinition(deps)
    const origin = createPublicOrigin({hasProject})
    const definition = {...base, commands: {...base.commands, publicOriginSet: origin.command}, resources: {publicOrigin: origin.resource}}
    return {definition, mount(store: Parameters<typeof origin.mount>[0]['store'], system: {
        publicOriginSet: Parameters<typeof origin.mount>[0]['setOrigin']
    }) {return origin.mount({store, setOrigin: system.publicOriginSet})}}
}
export type HostingRuntimeDefinition = ReturnType<typeof createHostingRuntime>['definition']
