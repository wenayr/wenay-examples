import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import type {ServiceResourceController} from 'wenay-common2/service/client'
import {useServiceAction} from '../shared/react/service-action'
import type {ChatFacade, ChatView} from './chat-resource'
import type {WorkView} from './model'
import {VoiceRecord} from './voice-record'
import {AssistantPanel} from './assistant'
import type {Proposal} from './assistant-resource'

export type ChatResources = {open(name: 'chat'): ServiceResourceController<ChatFacade>}
export type ChatRemote = NonNullable<ReturnType<ServiceResourceController<ChatFacade>['current']>>['remote']

type tApply = (id: string, items: Proposal['items']) => Promise<boolean>
export function ChatPanel({resources, work, apply}: {resources: ChatResources, work: WorkView, apply: tApply}) {
    const [expanded, setExpanded] = useState(false)
    return <section className="work-chat"><button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Закрыть общение' : 'Общение'}</button>{expanded && <ChatSession resources={resources} work={work} apply={apply}/>}</section>
}

function ChatSession({resources, work, apply}: {resources: ChatResources, work: WorkView, apply: tApply}) {
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open('chat'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const mirror = useOwnedClient({key: remote, enabled: !!remote, create: function subscribe() {
        const store = createStore<ChatView>({rooms: [], room: '', messages: [], older: '', typing: []})
        const sync = syncStoreReplayBatch(store, remote!.view)
        return {store, ready: sync.ready, close: sync}
    }})
    const view = useClientStore(mirror.ready ? mirror.client : null)
    return remote && view.state ? <ChatContent key={owned.client?.current()?.generation} remote={remote} value={view.state} work={work} apply={apply}/> : <p>{status.state?.phase == 'denied' ? 'Нет доступа к общению' : 'Подключаем общение…'}</p>
}

function ChatContent({remote, value, work, apply}: {remote: ChatRemote, value: ChatView, work: WorkView, apply: tApply}) {
    const action = useServiceAction(remote)
    const [title, setTitle] = useState('')
    const [participants, setParticipants] = useState<string[]>([work.me])
    const [task, setTask] = useState('')
    const [text, setText] = useState('')
    const [reply, setReply] = useState('')
    const [edit, setEdit] = useState<{id: string, revision: number} | null>(null)
    const [search, setSearch] = useState('')
    const [audio, setAudio] = useState('')
    const [voiceFile, setVoiceFile] = useState('')
    const urls = useRef<string[]>([])
    const lastTyping = useRef(0)
    const postRequest = useRef({signature: '', id: ''})
    const createRequest = useRef({signature: '', id: ''})
    const voiceRequest = useRef<{bytes: Uint8Array | null, id: string}>({bytes: null, id: ''})
    const room = value.rooms.find(room => room.id == value.room)
    useEffect(function cleanRoom() {setText(''); setReply(''); setEdit(null); setAudio(''); setVoiceFile(''); urls.current.forEach(URL.revokeObjectURL); urls.current = []}, [value.room])
    useEffect(function cleanup() {return function close() {urls.current.forEach(URL.revokeObjectURL)}}, [])
    async function send(event: React.FormEvent) {
        event.preventDefault()
        if (!room) return
        const signature = JSON.stringify({room: room.id, text, reply, edit})
        if (signature != postRequest.current.signature) postRequest.current = {signature, id: crypto.randomUUID()}
        const requestId = postRequest.current.id
        const ok = await action.action(() => edit ? remote.control.edit({requestId, room: room.id, message: edit.id, revision: edit.revision, text}) : remote.control.post({requestId, room: room.id, text, reply}))
        if (ok) {setText(''); setReply(''); setEdit(null); postRequest.current = {signature: '', id: ''}}
    }
    async function download(id: string, name: string) {
        if (!room) return
        await action.action(async function fetchFile() {
            const bytes = await remote.control.download(room!.id, id)
            const isAudio = /\.(webm|ogg|wav|mp3)$/i.test(name)
            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type: isAudio ? (/\.wav$/i.test(name) ? 'audio/wav' : /\.mp3$/i.test(name) ? 'audio/mpeg' : 'audio/webm') : 'application/octet-stream'}))
            urls.current.push(url)
            if (isAudio) {setAudio(url); setVoiceFile(id)}
            else {const link = document.createElement('a'); link.href = url; link.download = name; link.click()}
        })
    }
    return <div className="chat-layout"><aside><h3>Разговоры</h3>{value.rooms.map(item => <button key={item.id} aria-pressed={item.id == value.room} disabled={action.busy} onClick={() => void action.action(() => remote.control.select(item.id, ''))}>{item.title}{item.unread ? ` · ${item.unread}` : ''}</button>)}
        <details><summary>Новый разговор</summary><form onSubmit={async function create(event) {
            event.preventDefault()
            const signature = JSON.stringify({title, participants, task})
            if (createRequest.current.signature != signature) createRequest.current = {signature, id: crypto.randomUUID()}
            if (await action.action(() => remote.control.create({requestId: createRequest.current.id, title, participants, task}))) {setTitle(''); createRequest.current = {signature: '', id: ''}}
        }}>
            <label>Название разговора<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)}/></label>
            {work.people.map(person => <label className="work-check" key={person.account}><input type="checkbox" checked={participants.includes(person.account)} disabled={person.account == work.me} onChange={event => setParticipants(event.target.checked ? [...participants, person.account] : participants.filter(id => id != person.account))}/>{person.name}</label>)}
            <label>Обсуждение задачи<select value={task} onChange={event => setTask(event.target.value)}><option value="">Самостоятельный разговор</option>{Object.values(work.tasks).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
            <button disabled={action.busy}>Создать разговор</button>
        </form></details></aside><div>
        {room ? <><h3>{room.title}</h3><p>Участники: {room.members.join(', ')}. Добавленные участники видят всю историю; удалённые теряют доступ.</p>
            {room.task && <p>Задача: {work.tasks[room.task]?.title}</p>}
            {room.owner == work.me && <details><summary>Состав разговора</summary>{work.people.map(person => <label className="work-check" key={person.account}><input type="checkbox" checked={room.members.includes(person.account)} disabled={action.busy || person.account == work.me} onChange={event => void action.action(() => remote.control.membership({requestId: crypto.randomUUID(), room: room.id, revision: room.revision, participants: event.target.checked ? [...room.members, person.account] : room.members.filter(id => id != person.account)}))}/>{person.name}</label>)}</details>}
            <form onSubmit={function find(event) {event.preventDefault(); void action.action(() => remote.control.search(room.id, search))}}><label>Поиск по истории разговора<input type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)}/></label><button disabled={action.busy}>Найти</button><button type="button" disabled={action.busy} onClick={() => {setSearch(''); void action.action(() => remote.control.search(room.id, ''))}}>Сбросить поиск</button></form>
            <div className="work-toolbar"><button disabled={!value.older || action.busy} onClick={() => void action.action(() => remote.control.select(room.id, value.older))}>Раньше</button><button disabled={action.busy} onClick={() => void action.action(() => remote.control.select(room.id, ''))}>Последние сообщения</button><button disabled={!value.messages.length || action.busy} onClick={() => void action.action(() => remote.control.read({requestId: crypto.randomUUID(), room: room.id, message: value.messages.at(-1)!.id}))}>Отметить прочитанным</button></div>
            <div className="chat-messages" aria-label="Сообщения">{value.messages.map(message => <article key={message.id} className="chat-message"><small>{work.people.find(person => person.account == message.createdBy)?.name ?? message.createdBy} · {new Date(message.createdAt).toLocaleString()}{message.editRevision > 0 && ' · исправлено'}</small>
                {message.blocks.map(block => block.kind == 'text' ? <p key={block.id}>{block.text}</p> : block.kind == 'resource' ? <button key={block.id} disabled={action.busy} onClick={() => void download(block.resourceId, block.label ?? 'Файл')}>Открыть {block.label ?? 'вложение'}</button> : block.kind == 'custom' && block.type == 'reply' ? <small key={block.id}>Ответ на сообщение</small> : null)}
                <div className="work-toolbar"><button onClick={() => {setReply(message.id); setEdit(null)}}>Ответить</button>{message.createdBy == work.me && <><button onClick={() => {setEdit({id: message.id, revision: message.editRevision}); setReply(''); setText(message.blocks.filter(block => block.kind == 'text').map(block => block.text).join('\n'))}}>Исправить</button><button disabled={action.busy} onClick={() => void action.action(() => remote.control.edit({requestId: crypto.randomUUID(), room: room.id, message: message.id, text: '', revision: message.editRevision}))}>Удалить</button></>}</div>
            </article>)}</div>
            {!!value.typing.length && <small>{value.typing.join(', ')} печатает…</small>}
            {(reply || edit) && <p>{edit ? 'Исправление своего сообщения' : 'Ответ на выбранное сообщение'} <button onClick={() => {setReply(''); setEdit(null)}}>Отмена</button></p>}
            <form onSubmit={send}><label>Сообщение<textarea required maxLength={4000} value={text} onChange={event => {setText(event.target.value); if (Date.now() - lastTyping.current > 1500) {lastTyping.current = Date.now(); void remote.control.typing(room.id).catch(() => {})}}}/></label><button disabled={action.busy}>{edit ? 'Сохранить исправление' : 'Отправить'}</button></form>
            <label>Вложение до 512 КБ<input type="file" disabled={action.busy} onChange={function file(event) {const file = event.target.files?.[0]; event.target.value = ''; if (file) void action.action(async function upload() {if (file.size > 512 * 1024) throw new Error('Файл больше 512 КБ'); await remote.control.upload({requestId: crypto.randomUUID(), room: room.id, name: file.name, bytes: new Uint8Array(await file.arrayBuffer())})})}}/></label>
            {audio && <audio controls src={audio}/>}
            <VoiceRecord key={room.id} disabled={action.busy} send={bytes => action.action(async function uploadVoice() {
                if (voiceRequest.current.bytes != bytes) voiceRequest.current = {bytes, id: crypto.randomUUID()}
                const id = await remote.control.upload({requestId: voiceRequest.current.id, room: room.id, name: 'Голосовое.wav', bytes})
                setVoiceFile(id)
            })}/>
            <AssistantPanel key={'ai-' + room.id} remote={remote} room={room.id} work={work} apply={apply} file={voiceFile}/>
        </> : <p>Выберите разговор или создайте новый</p>}
        {action.error && <p role="alert">{action.error}</p>}
    </div></div>
}
