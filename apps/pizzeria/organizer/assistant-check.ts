import assert from 'node:assert/strict'
import {createAssistant, validateVoice} from './assistant-resource'

async function main() {
    let allowed = true, aborted = false, saves = 0
    const voice = new Uint8Array(46)
    const view = new DataView(voice.buffer)
    for (const [at, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) voice.set(new TextEncoder().encode(text), at)
    view.setUint32(4, 38, true)
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 32000, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    view.setUint32(40, 2, true)
    validateVoice(voice)
    assert.throws(() => validateVoice(new Uint8Array([1])))
    const corrupt = new Uint8Array(voice)
    corrupt[40] = 3
    assert.throws(() => validateVoice(corrupt))
    let release: ((value: {text: string}) => void) | undefined
    const host = createAssistant({allowed: () => allowed, read: async () => voice, messages: () => ['Первое сообщение', 'Второе сообщение'],
        save: async () => {saves++},
        provider: {
            transcribe({signal}) {
                return new Promise(function hold(resolve) {
                    release = resolve
                    signal.addEventListener('abort', () => {aborted = true})
                })
            }
        },
    })
    const session = host.connection('worker')
    try {
        const run = session.fragment.createRun({requestId: 'cancel', kind: 'transcribe', resourceIds: ['room'], input: {room: 'room', file: 'voice'}})
        for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5))
        assert(release)
        assert.equal(session.fragment.createRun({
            requestId: 'cancel',
            kind: 'transcribe',
            resourceIds: ['room'],
            input: {room: 'room', file: 'voice'}
        }).id, run.id)
        assert.throws(() => session.fragment.createRun({requestId: 'second', kind: 'demo-tasks', resourceIds: ['room'], input: {room: 'room', text: 'Работа'}}))
        session.fragment.cancelRun(run.id)
        release!({text: 'Поздний ответ не создаёт результат'})
        await new Promise(resolve => setTimeout(resolve, 20))
        assert(aborted)
        assert.equal(saves, 0)
        release = undefined
        aborted = false
        session.fragment.createRun({requestId: 'revoke', kind: 'transcribe', resourceIds: ['room'], input: {room: 'room', file: 'voice'}})
        for (let i = 0; i < 20 && !release; i++) await new Promise(resolve => setTimeout(resolve, 5))
        assert(release)
        allowed = false
        host.reconcile()
        assert(aborted)
        const late = release as (value: {text: string}) => void
        late({text: 'Поздний ответ после отзыва'})
        await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(saves, 0)
        assert.throws(() => session.fragment.createRun({requestId: 'forbidden', kind: 'demo-summary', resourceIds: ['room'], input: {room: 'room'}}))
        console.log('PASS assistant: WAV boundary, duplicate run, concurrency, cancel and revoke abort provider, late output not saved; no paid calls')
    } finally {session.close()
    host.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
