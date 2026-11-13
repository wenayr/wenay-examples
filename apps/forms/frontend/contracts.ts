import {useMemo} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {FormsDefinition} from '../backend/runtime'
import type {FormsWorkspace} from '../backend/domain'
import type {useCommandAction} from '../shared/react/command-action'

export type Resources = ServiceClient<FormsDefinition>['resources']
export type Commands = ReturnType<typeof useCommandAction<ServiceClient<FormsDefinition>['commands']>>
export type Organization = FormsWorkspace['organizations'][number]
export type FormRow = FormsWorkspace['forms'][number]
export function useFormResource<K extends 'editor'|'answers'|'publicform'|'exports'|'grouping'>(resources: Resources, name: K) {
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open(name), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client?{store: owned.client.status}: null, [owned.client]))
    return status.state?.phase=='ready'?owned.client?.current()?.remote: null
}
export function openEditor(resources: Resources){return resources.open('editor')}
export type EditorRemote = NonNullable<ReturnType<ReturnType<typeof openEditor>['current']>>['remote']
export type Detail = Awaited<ReturnType<EditorRemote['control']['detail']>>
export const roles = {owner: 'Владелец', author: 'Автор', analyst: 'Аналитик'}
export const kinds = {text: 'Короткий ответ', longtext: 'Развёрнутый ответ', number: 'Число', choice: 'Один из вариантов', boolean: 'Да или нет'}
export function date(at: number){return new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(at)}
export function download(file: {name: string, mime: string, bytes: Uint8Array}){
    const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], {type: file.mime}))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

