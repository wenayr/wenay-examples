import type {tClientCommands, createServiceClient} from 'wenay-common2/service/client'
import type {SupportDefinition} from '../backend/runtime'
import type {useCommandAction} from '../shared/react/command-action'

export type CommandController = ReturnType<typeof useCommandAction<tClientCommands<SupportDefinition>>>
export type SupportResources = ReturnType<typeof createServiceClient<SupportDefinition>>['resources']

export const roleLabels = {owner: 'Владелец', lead: 'Руководитель', agent: 'Специалист', customer: 'Клиент', revoked: 'Доступ закрыт'} as const
export const statusLabels = {open: 'Открыто', waiting: 'Ожидает', resolved: 'Решено'} as const
export const priorityLabels = {normal: 'Обычный', high: 'Высокий', urgent: 'Срочный'} as const
export const articleLabels = {draft: 'Черновик', published: 'Опубликовано', archived: 'Архив'} as const

export function dateLabel(at: number) {
    return new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(at)
}

export function Avatar({name, small = false}: {name: string, small?: boolean}) {
    return <span className={'avatar' + (small ? ' small' : '')} aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('ru')}</span>
}
