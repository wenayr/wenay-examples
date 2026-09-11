import React, {useEffect, useRef, useState} from 'react'
import {useMediaSource} from 'wenay-react2/communication'
import {decodeMediaFrame} from 'wenay-common2/media'
import {captureUnavailable} from './capture-support'

export function VoiceRecord({send, disabled}: {send: (bytes: Uint8Array) => Promise<boolean>, disabled: boolean}) {
    const source = useMediaSource('audio', {mode: 'pcm', format: 'int16', sampleRate: 16000, channels: 1, packetMs: 20, worklet: false})
    const chunks = useRef<Uint8Array[]>([])
    const count = useRef(0)
    const rate = useRef(16000)
    const recording = useRef(false)
    const [active, setActive] = useState(false)
    const [requesting, setRequesting] = useState(false)
    const [error, setError] = useState('')
    const [draft, setDraft] = useState<Uint8Array | null>(null)
    const [url, setUrl] = useState('')
    const unavailable = captureUnavailable('voice')
    function stop() {
        recording.current = false
        source.stop(); setActive(false)
        if (!count.current) {setError('Запись пуста'); return}
        const bytes = new Uint8Array(44 + count.current)
        const view = new DataView(bytes.buffer)
        function ascii(at: number, value: string) {for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)}
        ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
        view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate.current, true); view.setUint32(28, rate.current * 2, true)
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, count.current, true)
        let offset = 44; for (const chunk of chunks.current) {bytes.set(chunk, offset); offset += chunk.length}
        setDraft(bytes)
    }
    useEffect(function frames() {
        const off = source.listen.on(function frame(bytes) {
            if (!recording.current) return
            const frame = decodeMediaFrame(bytes)
            if (frame.kind != 'audio-pcm' || frame.codec != 'pcm16' || frame.channels != 1) return
            if (count.current + frame.payload.length > 480_000) {stop(); return}
            rate.current = frame.sampleRate ?? 16000
            chunks.current.push(new Uint8Array(frame.payload)); count.current += frame.payload.length
        })
        return off
    }, [source.source])
    useEffect(function deadline() {if (active) {const timer = setTimeout(stop, 12000); return () => clearTimeout(timer)}}, [active])
    useEffect(function preview() {
        if (!draft) {setUrl(''); return}
        const url = URL.createObjectURL(new Blob([new Uint8Array(draft)], {type: 'audio/wav'})); setUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [draft])
    async function start() {
        if (requesting || disabled || unavailable) return
        setRequesting(true)
        chunks.current = []; count.current = 0; setDraft(null); setError(''); recording.current = true
        const state = await source.start()
        setRequesting(false)
        if (state != 'live') {recording.current = false; setError('Микрофон недоступен'); return}
        setActive(true)
    }
    return <div><p>Голосовое сообщение · до 12 секунд</p><button disabled={!active && (disabled || requesting || !!unavailable)} onClick={() => active ? stop() : void start()}>{requesting ? 'Ожидаем разрешение микрофона…' : active ? 'Остановить запись' : 'Записать голос'}</button>
        {unavailable && <p role="status">{unavailable}</p>}
        {url && <><audio controls src={url}/><button disabled={disabled} onClick={async function upload() {if (draft && await send(draft)) setDraft(null)}}>Отправить голосовое</button><button onClick={() => setDraft(null)}>Удалить запись</button></>}
        {error && <p role="status">{error}</p>}
    </div>
}
