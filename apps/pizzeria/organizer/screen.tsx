import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import {useMediaSource} from 'wenay-react2/communication'
import {attachVideoCanvas} from 'wenay-common2/media'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import type {ServiceResourceController} from 'wenay-common2/service/client'
import type {ScreenFacade, ScreenState} from './screen-resource'
import {captureUnavailable} from './capture-support'

export type ScreenResources = {open(name: 'screen'): ServiceResourceController<ScreenFacade>}

export function ScreenPanel({resources}: {resources: ScreenResources}) {
    const [enabled, setEnabled] = useState(false)
    return <section className="work-screen">
        <button aria-expanded={enabled} onClick={function toggle() {setEnabled(!enabled)}}>
            {enabled ? 'Закрыть показ экрана' : 'Экран · подключиться'}
        </button>
        {enabled && <ScreenSession resources={resources}/>}</section>
}

function ScreenSession({resources}: {resources: ScreenResources}) {
    const [error, setError] = useState('')
    const [stream, setStream] = useState<MediaStream | null>(null)
    const selecting = useRef(false)
    const [choosing, setChoosing] = useState(false)
    const unavailable = captureUnavailable('screen')
    const live = useRef(true)
    const canvas = useRef<HTMLCanvasElement>(null)
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open('screen'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const mirror = useOwnedClient({key: remote, enabled: !!remote, create: function mirror() {
        const store = createStore<ScreenState>({owner: '', account: '', epoch: 0})
        const sync = syncStoreReplayBatch(store, remote!.view, {onError: () => setError('Связь с экраном прервана')})
        return {store, ready: sync.ready, close: sync}
    }})
    const view = useClientStore(mirror.ready ? mirror.client : null)
    const state = view.state
    useEffect(function lifetime() {
        live.current = true
        return function close() {live.current = false}
    }, [])
    useEffect(function disconnected() {setStream(null)}, [remote])
    useEffect(function ownStream() {return function releaseStream() {stream?.getTracks().forEach(track => track.stop())}}, [stream])
    async function select() {
        if (!remote || selecting.current || unavailable) return
        selecting.current = true
        setChoosing(true)
        setError('')
        try {
            const selected = await navigator.mediaDevices.getDisplayMedia({video: {width: {max: 1280}, height: {max: 720}, frameRate: {max: 5}}, audio: false})
            if (!live.current || owned.client?.current()?.remote != remote) {
                selected.getTracks().forEach(track => track.stop())
                return
            }
            setStream(selected)
        } catch {if (live.current) setError('Экран не выбран или браузер запретил захват')}
        finally {
            selecting.current = false
            if (live.current) setChoosing(false)
        }
    }
    useEffect(function receive() {
        if (!remote || !state?.owner || !canvas.current) return
        const epoch = state.epoch
        const player = attachVideoCanvas({on(cb) {return remote.frames.on(function packet(frame, sentAt) {
            const value = frame as {epoch: number, bytes: Uint8Array}
            if (value?.epoch == epoch) cb(value.bytes, sentAt)
        })}}, canvas.current, {onError: () => setError('Не удалось отобразить кадр')})
        return player.off
    }, [remote, state?.owner, state?.epoch])
    return <div><p>Два участника, один экран, без звука и записи. Показ ограничен 5 кадрами в секунду.</p>
        <button
            disabled={!remote || !!stream || !!state?.owner || choosing || !!unavailable}
            onClick={select}
        >
            {choosing ? 'Выберите окно или вкладку в браузере…' : 'Выбрать экран'}
        </button>
        {unavailable && <p role="status">{unavailable}</p>}
        {stream && remote && <Broadcast
            key={owned.client?.current()?.generation}
            stream={stream}
            remote={remote}
            stop={() => setStream(null)}
            fail={setError}
        />}
        {state?.owner ? <>
            <p>Экран показывает {state.account}</p>
            <canvas
                ref={canvas}
                style={{width: '100%', maxHeight: '55vh', objectFit: 'contain', background: '#111'}}
            />
        </> : <p>Ждём начала показа</p>}
        {(error || owned.error || status.state?.phase == 'failed') && (
            <p role="status">
                {error || 'Не удалось подключиться: в комнате могут уже находиться двое'}
            </p>
        )}
    </div>
}

type ScreenRemote = NonNullable<ReturnType<ServiceResourceController<ScreenFacade>['current']>>['remote']

type BroadcastProps = {
    stream: MediaStream,
    remote: ScreenRemote,
    stop: () => void,
    fail: (error: string) => void
}

function Broadcast({stream, remote, stop, fail}: BroadcastProps) {
    const options = useMemo(() => ({stream, fps: 5, width: 1280, height: 720, codec: 'jpeg' as const, quality: 0.6, worker: false}), [stream])
    const media = useMediaSource('video', options)
    useEffect(function broadcast() {
        let active = true
        let pending = false
        let epoch = 0
        const off = media.listen.on(async function send(bytes) {
            if (!active || pending || !epoch) return
            pending = true
            try {
                await remote.control.frame(epoch, bytes)
            } catch {
                if (!active) return
                fail('Показ остановлен: подключение или права изменились')
                stop()
            }
            finally {pending = false}
        })
        async function start() {
            try {
                epoch = await remote.control.begin()
                if (!active) {
                    await remote.control.end()
                    return
                }
                if (await media.start() != 'live') throw new Error('Источник экрана недоступен')
            }
            catch {
                if (active) {
                    fail('Не удалось начать показ')
                    stop()
                }
            }
        }
        const ended = () => stop()
        stream.getTracks().forEach(track => track.addEventListener('ended', ended))
        void start()
        return function close() {
            active = false
            off()
            media.stop()
            stream.getTracks().forEach(track => {
                track.removeEventListener('ended', ended)
                track.stop()
            })
            void remote.control.end().catch(() => {})
        }
    }, [remote, stream])
    return <button onClick={stop}>Остановить показ</button>
}
