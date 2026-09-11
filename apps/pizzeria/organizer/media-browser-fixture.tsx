import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import {attachVideoCanvas} from 'wenay-common2/media'
import {useMediaSource} from 'wenay-react2/communication'
import type {organizerDefinition} from './service'

function Check() {
    const [stream, setStream] = useState<MediaStream | null>(null)
    const [result, setResult] = useState('Не начато')
    const source = useRef<HTMLCanvasElement>(null)
    const target = useRef<HTMLCanvasElement>(null)
    useEffect(function draw() {
        let alternate = false
        const timer = setInterval(function paint() {
            const canvas = source.current!
            const ctx = canvas.getContext('2d')!
            ctx.fillStyle = alternate ? '#ff0000' : '#0000ff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            alternate = !alternate
        }, 400)
        return () => clearInterval(timer)
    }, [])
    useEffect(function ownStream() {return () => stream?.getTracks().forEach(track => track.stop())}, [stream])
    return <main style={{fontFamily: 'system-ui', padding: 24}}><h1>Два клиента · меняющиеся кадры</h1>
        <p>Синтетический canvas, без захвата экрана и микрофона. Реальные SC1, RPC, media codec, relay и React hook.</p>
        <canvas width={640} height={360} ref={source} style={{width: 320}}/>
        <canvas width={640} height={360} ref={target} style={{width: 320}}/>
        <p role="status">{result}</p>
        <button onClick={function toggle() {if (stream) setStream(null); else setStream(source.current!.captureStream(5))}}>{stream ? 'Остановить тест' : 'Начать тест'}</button>
        {stream && <Run stream={stream} target={target.current!} result={setResult}/>}
    </main>
}

function Run({stream, target, result}: {stream: MediaStream, target: HTMLCanvasElement, result: (value: string) => void}) {
    const options = useMemo(() => ({stream, fps: 5, width: 640, height: 360, codec: 'jpeg' as const, worker: false}), [stream])
    const media = useMediaSource('video', options)
    useEffect(function connect() {
        let active = true
        const dispose: (() => unknown)[] = []
        async function start() {
            const definition = await fetch('/api/client').then(response => response.json()) as ServiceClientDefinition<typeof organizerDefinition>
            if (!active) return
            const owner = createServiceClient({definition, url: location.origin, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
            const worker = createServiceClient({definition, url: location.origin, auth: {credentials: {account: 'worker', password: 'worker-pass'}}})
            dispose.push(() => {owner.close(); worker.close()})
            const a = owner.resources.open('screen'), b = worker.resources.open('screen')
            dispose.push(() => {void a.close(); void b.close()})
            const until = Date.now() + 8000
            while (active && (a.status.state.phase != 'ready' || b.status.state.phase != 'ready')) {
                if (Date.now() > until) throw new Error('Ресурсы не готовы')
                await new Promise(resolve => setTimeout(resolve, 20))
            }
            if (!active) return
            const sender = a.current()!.remote, receiver = b.current()!.remote
            const epoch = await sender.control.begin()
            if (!active) return
            const player = attachVideoCanvas({on(callback) {return receiver.frames.on(function frame(value, at) {
                const packet = value as {epoch: number, bytes: Uint8Array}
                if (packet.epoch == epoch) callback(packet.bytes, at)
            })}}, target)
            dispose.push(player.off)
            let pending = false, sent = 0
            const off = media.listen.on(async function send(bytes) {
                if (!active || pending) return
                pending = true
                try {if (await sender.control.frame(epoch, bytes)) sent++} catch (error) {if (active) result(String(error))}
                finally {pending = false}
            })
            dispose.push(off)
            const colors = new Set<string>()
            const timer = setInterval(function inspect() {
                const pixel = target.getContext('2d')!.getImageData(10, 10, 1, 1).data
                if (pixel[0] > 200 && pixel[2] < 30) colors.add('красный')
                if (pixel[2] > 200 && pixel[0] < 30) colors.add('синий')
                result((colors.size == 2 ? 'PASS' : 'Проверяем') + ': приняты и нарисованы ' + [...colors].join(', ') + '; отправлено кадров ' + sent)
            }, 150)
            dispose.push(() => clearInterval(timer))
            if (await media.start() != 'live') throw new Error('Источник не запущен')
        }
        void start().catch(error => {if (active) result(String(error))})
        return function close() {active = false; media.stop(); dispose.reverse().forEach(close => close()); result('Тест остановлен; источники и подключения закрыты')}
    }, [stream])
    return null
}
createRoot(document.getElementById('root')!).render(<Check/> )
