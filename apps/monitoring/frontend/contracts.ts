import type {ServiceClient} from 'wenay-common2/service/client'
import type {MonitoringDefinition} from '../backend/runtime'
import type {MonitoringWorkspace, publicStatus} from '../backend/domain'
import type {useCommandAction} from '../shared/react/command-action'
export type Commands = ReturnType<typeof useCommandAction<ServiceClient<MonitoringDefinition>['commands']>>
export type Resources = ServiceClient<MonitoringDefinition>['resources']
export type Organization = MonitoringWorkspace['organizations'][number]
export type PublicStatus = ReturnType<typeof publicStatus>
export const roles = {owner: 'Владелец', oncall: 'Дежурный', observer: 'Наблюдатель', probe: 'Обработчик'}
const moment = new Intl.DateTimeFormat('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
})

export function date(at: number) {
    return at ? moment.format(at) : 'Ещё нет измерений'
}
