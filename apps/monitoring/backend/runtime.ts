import {createMonitoringService} from './service'
import {createMonitorAssistant} from './assistant-resource'
export function createMonitoringRuntime(deps: Parameters<typeof createMonitoringService>[0] & Parameters<typeof createMonitorAssistant>[0] = {}) {
    const service = createMonitoringService(deps), assistant = createMonitorAssistant(deps)
    return {definition: {...service.definition, resources: {assistant: assistant.resource}}, mount: assistant.mount}
}
export type MonitoringDefinition = ReturnType<typeof createMonitoringRuntime>['definition']
