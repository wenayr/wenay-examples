import type {ServiceClient} from 'wenay-common2/service/client'
import type {DocumentDefinition} from '../backend/runtime'
import type {DocumentWorkspace} from '../backend/domain'
import {useCommandAction} from '../shared/react/command-action'

export type Resources = ServiceClient<DocumentDefinition>['resources']
export type ProcessorRemote = NonNullable<ReturnType<ReturnType<Resources['open']>['current']>>['remote']
export type Commands = ReturnType<typeof useCommandAction<ServiceClient<DocumentDefinition>['commands']>>
export type DocumentMetadata = DocumentWorkspace['documents'][number]
export type DocumentDetail = Awaited<ReturnType<ProcessorRemote['control']['detail']>>
export const roleLabels = {owner: 'Владелец', reviewer: 'Проверяющий', uploader: 'Загрузка документов'}
export const statusLabels = {
    uploaded: 'Загружен',
    processing: 'Обработка',
    review: 'На проверке',
    approved: 'Подтверждён',
    failed: 'Нужна проверка',
    cancelled: 'Отменён',
    uncertain: 'Нужна сверка',
    deleted: 'Удалён'
}
export function formatDate(at: number) {return new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(at)}

export function downloadFile(file: {name: string, bytes: Uint8Array}) {
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], {type: 'application/octet-stream'}))
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
