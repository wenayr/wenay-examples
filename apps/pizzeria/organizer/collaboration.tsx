import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import type {ServiceResourceController} from 'wenay-common2/service/client'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {BoardFacade} from './collaboration-resource'
import {BOARD_INTERVAL, type BoardActivity, type BoardParticipant, type BoardPresence, type tBoardSurface} from './collaboration-model'

export type BoardResources = {open(name: 'board'): ServiceResourceController<BoardFacade>}

export function useBoardPresence(deps: {resources?: BoardResources, enabled: boolean, surface?: tBoardSurface}) {
    const [error, setError] = useState('')
    const [follow, setFollow] = useState('')
    const activity = useRef<BoardActivity>({cursor: null, selected: ''})
    const dirty = useRef(false)
    const owned = useOwnedClient({key: deps.resources, enabled: !!deps.resources && deps.enabled,
        create: function open() {
            setError('')
            return {...deps.resources!.open('board'), ready: Promise.resolve()}
        }, onCloseError: function failed() {setError('Не удалось подтвердить отключение от доски')},
    })
    const resource = owned.client
    const status = useClientStore(useMemo(() => resource ? {store: resource.status} : null, [resource]))
    const current = status.state?.phase == 'ready' ? resource?.current() : null
    const remote = current?.remote
    const mirror = useOwnedClient({key: remote, enabled: !!remote, create: function subscribe(signal) {
        const store = createStore<BoardPresence>({self: '', participants: []})
        const sync = syncStoreReplayBatch(store, remote!.view, {onError: function interrupted() {
            if (!signal.aborted) setError('Поток присутствия прерван')
        }})
        return {store, ready: sync.ready, close: sync}
    }})
    const view = useClientStore(mirror.ready ? mirror.client : null)

    useEffect(function publishActivity() {
        setFollow('')
        activity.current = {cursor: null, selected: '', drag: null, surface: deps.surface ?? 'tasks'}
        dirty.current = true
        if (!remote) return
        setError('')
        let active = true
        let pending = false
        let last = 0
        async function flush() {
            if (!active || pending || (!dirty.current && (document.hidden || Date.now() - last < 2000))) return
            pending = true
            dirty.current = false
            last = Date.now()
            try {
                const accepted = await remote!.control.update(activity.current)
                if (active && !accepted) dirty.current = true
            } catch {
                if (active) setError('Присутствие временно недоступно')
            } finally {pending = false}
        }
        function hidden() {
            if (document.hidden) activity.current = {cursor: null, selected: '', drag: null, surface: deps.surface ?? 'tasks'}
            dirty.current = true
            void flush()
        }
        const timer = setInterval(flush, BOARD_INTERVAL + 10)
        document.addEventListener('visibilitychange', hidden)
        void flush()
        return function stop() {active = false; clearInterval(timer); document.removeEventListener('visibilitychange', hidden)}
    }, [remote, deps.surface])

    const participants = remote && view.ready ? view.state?.participants ?? [] : []
    const self = view.state?.self ?? ''
    const others = participants.filter(person => person.id != self && (person.surface ?? 'tasks') == (deps.surface ?? 'tasks'))
    function update(next: Partial<BoardActivity>) {
        activity.current = {...activity.current, ...next}
        dirty.current = true
    }
    function interact() {setFollow('')}
    const selected = others.find(person => person.id == follow)?.selected ?? ''
    return {others, self, selected, follow, setFollow, update, interact, generation: current?.generation ?? 0,
        phase: status.state?.phase ?? 'opening',
        error: error || (owned.error || mirror.error || view.error ? 'Не удалось подключить совместную работу' : '')}
}

export function BoardPeople({presence, show}: {presence: ReturnType<typeof useBoardPresence>, show: () => void}) {
    const {others, follow, setFollow} = presence
    const phase = {opening: 'Подключаем участников…', ready: 'На доске', offline: 'Восстанавливаем связь…', denied: 'Нет доступа к совместной работе', failed: 'Совместная работа недоступна', closed: 'Совместная работа отключена'}
    return <div className="work-presence" aria-label="Участники доски"><span>{phase[presence.phase]}{presence.phase == 'ready' && ` · ${others.length + 1}`}</span>
        {others.map((person, index) => <button key={person.id} type="button" aria-pressed={follow == person.id}
            title={person.selected ? 'Следить за выбранной карточкой' : 'Участник пока не выбрал доступную вам карточку'}
            onClick={function followPerson() {show(); setFollow(follow == person.id ? '' : person.id)}}>
            <i style={{background: personColor(person.id)}}/>{person.name}{others.filter(other => other.account == person.account).length > 1 ? ` · вкладка ${index + 1}` : ''}
        </button>)}
        {follow && <button type="button" onClick={function stopFollow() {setFollow('')}}>Прекратить слежение</button>}
        {follow && <small>{presence.selected ? 'Показываем выбранную карточку. Ваше действие завершит слежение.' : 'Ждём выбора доступной вам карточки'}</small>}
        {presence.error && <small role="status">{presence.error}</small>}
    </div>
}

export function personColor(id: string) {
    let hash = 0
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return ['#2861b6', '#9441a0', '#b25024', '#00796b', '#755b14'][Math.abs(hash) % 5]
}

export function BoardMarks({id, participants}: {id: string, participants: BoardParticipant[]}) {
    const selected = participants.filter(person => person.selected == id)
    return <>
        {!!selected.length && <div className="work-watchers">{selected.map(person => <span key={person.id} style={{color: personColor(person.id)}}>{person.name} смотрит</span>)}</div>}
        {participants.filter(person => person.cursor?.task == id).map(person => <span className="work-peer-cursor" aria-hidden="true" key={person.id}
            style={{left: `${person.cursor!.x * 100}%`, top: `${person.cursor!.y * 100}%`, color: personColor(person.id)}}>➤<b>{person.name}</b></span>)}
    </>
}
