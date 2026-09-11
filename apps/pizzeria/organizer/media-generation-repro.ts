import assert from 'node:assert/strict'
import {createAudioSource, decodeMediaFrame} from 'wenay-common2/media'

// Controlled browser IO fixture: the actual published source/codec remain unchanged.
async function main() {
    const original = globalThis.MediaRecorder
    let recorder: Recorder | undefined
    class Recorder {
        ondataavailable?: (event: {data: {size: number, arrayBuffer(): Promise<ArrayBuffer>}}) => Promise<void>
        constructor() {recorder = this}
        static isTypeSupported() {return true}
        start() {}
        stop() {}
    }
    globalThis.MediaRecorder = Recorder as unknown as typeof MediaRecorder
    const stream = {getTracks: () => [{stop() {}}]} as unknown as MediaStream
    const source = createAudioSource({mode: 'record', stream})
    const frames: number[][] = []
    const off = source[1].on(bytes => frames.push([...decodeMediaFrame(bytes).payload]))
    try {
        assert.equal(await source.start(), 'live')
        let release!: (bytes: ArrayBuffer) => void
        const delayed = recorder!.ondataavailable!({data: {size: 1, arrayBuffer: () => new Promise(resolve => {release = resolve})}})
        source.stop()
        assert.equal(await source.start(), 'live')
        release(new Uint8Array([17]).buffer)
        await delayed
        if (process.argv.includes('--expect-fixed')) assert.equal(frames.length, 0, 'old recorder chunk leaked into a new source generation')
        else assert.deepEqual(frames, [[17]], 'M1 reproduction changed: re-audit the published API')
        console.log(process.argv.includes('--expect-fixed') ? 'PASS M1 regression' : 'REPRODUCED M1: delayed old recorder chunk emitted after stop/start; browser IO fixture, no microphone')
    } finally {source.stop(); off(); globalThis.MediaRecorder = original}
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
