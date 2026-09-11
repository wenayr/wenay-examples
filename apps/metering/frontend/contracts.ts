import type {ServiceClient, tClientCommands} from 'wenay-common2/service/client'
import type {MeteringDefinition} from '../backend/runtime'
import type {useCommandAction} from '../shared/react/command-action'

export type Commands = ReturnType<typeof useCommandAction<tClientCommands<MeteringDefinition>>>
export type Resources = ServiceClient<MeteringDefinition>['resources']
export type MeteringWorkspace = ReturnType<MeteringDefinition['views']['workspace']['project']>
export type KeyCredentials = {orgId: string, id: string, secret: string}
export const roles = {owner: 'Владелец', auditor: 'Аудитор', api: 'API-клиент'} as const
export const metrics = {search: 'Поиск', document: 'Документы'} as const
export const statuses = {reserved: 'В резерве', committed: 'Учтено', released: 'Освобождено', unknown: 'Исход неизвестен'} as const
export const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
export const date = (value: number) => new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(value)
