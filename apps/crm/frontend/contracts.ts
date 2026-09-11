import type {ServiceClient} from 'wenay-common2/service/client'
import type {CrmDefinition} from '../backend/runtime'
import type {CrmWorkspace} from '../backend/domain'
import type {useCommandAction} from '../shared/react/command-action'

export type Commands = ReturnType<typeof useCommandAction<ServiceClient<CrmDefinition>['commands']>>
export type Resources = ServiceClient<CrmDefinition>['resources']
export function openCrm(resources: Resources) {return resources.open('crm')}
export type Remote = NonNullable<ReturnType<ReturnType<typeof openCrm>['current']>>['remote']
export type Organization = CrmWorkspace['organizations'][number]
export type DealRow = CrmWorkspace['deals'][number]
export type Detail = Awaited<ReturnType<Remote['control']['detail']>>
export const roles = {owner: 'Владелец', lead: 'Руководитель', manager: 'Менеджер', customer: 'Клиент'}
export const stages = {incoming: 'Новый контакт', qualified: 'Обсуждение', proposal: 'Предложение', won: 'Успешно', lost: 'Закрыто'}
export function money(amount: number) {return new Intl.NumberFormat('ru', {maximumFractionDigits: 2}).format(amount / 100) + ' у. е.'}
export function date(at: number) {return new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(at)}
export function download(file: {name: string, mime: string, text: string}) {
    const url = URL.createObjectURL(new Blob([file.text], {type: file.mime}))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
