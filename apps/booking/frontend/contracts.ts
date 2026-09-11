import type {ServiceClient} from 'wenay-common2/service/client'
import type {BookingDefinition} from '../backend/runtime'
import type {BookingWorkspace} from '../backend/domain'
import type {useCommandAction} from '../shared/react/command-action'

export type Commands = ReturnType<typeof useCommandAction<ServiceClient<BookingDefinition>['commands']>>
export type Resources = ServiceClient<BookingDefinition>['resources']
export type Organization = BookingWorkspace['organizations'][number]
export const roles = {owner: 'Владелец', staff: 'Специалист', customer: 'Клиент'}
export const statuses = {
    held: 'Время удерживается',
    confirmed: 'Подтверждена',
    cancelled: 'Отменена',
    expired: 'Удержание истекло'
}
export const deposits = {
    none: 'Без предоплаты',
    pending: 'Ожидает предоплаты',
    paid: 'Предоплата учтена',
    failed: 'Предоплата не прошла',
    refundDue: 'Требуется возврат'
}
export function when(at: number, zone: string) {
    return new Intl.DateTimeFormat('ru', {
        timeZone: zone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'shortOffset'
    }).format(at)
}
export function clock(at: number, zone: string) {
    return new Intl.DateTimeFormat('ru', {timeZone: zone, hour: '2-digit', minute: '2-digit'}).format(at)
}
