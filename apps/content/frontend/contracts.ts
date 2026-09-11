import {useMemo} from 'react'
import {useClientStore,useOwnedClient} from 'wenay-react2/react'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {ContentDefinition} from '../backend/runtime'
import type {ContentWorkspace} from '../backend/domain'
import type {useCommandAction} from '../shared/react/command-action'
export type Resources=ServiceClient<ContentDefinition>['resources']
export type Commands=ReturnType<typeof useCommandAction<ServiceClient<ContentDefinition>['commands']>>
export type Organization=ContentWorkspace['organizations'][number]
export function useContentResource<K extends 'published'|'files'|'assistant'>(resources:Resources,name:K) {
    const owned=useOwnedClient({key:resources,create:()=>({...resources.open(name),ready:Promise.resolve()})})
    const status=useClientStore(useMemo(()=>owned.client?{store:owned.client.status}:null,[owned.client]))
    return status.state?.phase=='ready'?owned.client?.current()?.remote:null
}
export const roles={owner:'Владелец',author:'Автор',editor:'Редактор',publisher:'Издатель',reader:'Читатель'}
export const blockKinds={heading:'Заголовок',text:'Текст',image:'Изображение',quote:'Цитата',button:'Кнопка со ссылкой'}
export function date(at:number){return at?new Intl.DateTimeFormat('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(at):'Новый материал'}
export function publicUrl(orgId:string,slug=''){return location.origin+'/#read='+encodeURIComponent(orgId)+(slug?'/'+encodeURIComponent(slug):'')}
export function newBlock(kind:keyof typeof blockKinds='text'){return {id:'b-'+crypto.randomUUID(),kind,text:kind=='heading'?'Новый заголовок':kind=='quote'?'Слова, которые хочется запомнить':kind=='button'?'Узнать больше':kind=='image'?'Описание изображения':'Новый абзац',assetId:'',href:kind=='button'?'https://example.com':''}}
