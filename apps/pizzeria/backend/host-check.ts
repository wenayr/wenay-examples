import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {io} from 'socket.io-client'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createDishMedia} from './dish-media'

async function main() {
    const root = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(root, 'pizzeria-host-check-'))
    const origin = 'http://localhost:5173'
    const deniedOrigin = 'http://untrusted.invalid'
    let disposed = 0
    const signals = process.listenerCount('SIGTERM')
    const host = await createServiceLeaderHost({
        definition: {name: 'host-check', storeId: 'host-check', originId: 'host-check', initial: {value: 0}, commands: {}},
        env: {SERVICE_PORT: '0'}, origins: [origin],
        mount({app, signal}) {
            createDishMedia({directory, authorize(token) {if (token != 'editor') throw new Error('forbidden')}}).mount(app)
            return async function disposeMount() {
                assert(signal.aborted, 'mount receives cancellation before disposal')
                await Promise.resolve()
                disposed++
            }
        },
    })
    async function preflight(from: string) {
        return fetch(host.url+'/api/media/photos', {
            method: 'OPTIONS',
            headers: {origin: from, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type'}
        })
    }
    function websocket(from: string) {
        return new Promise<boolean>(function connected(resolve) {
            const socket = io(host.url, {transports: ['websocket'], reconnection: false, timeout: 2000, extraHeaders: {origin: from}})
            function finish(ok: boolean) {
                socket.disconnect()
                resolve(ok)
            }
            socket.once('connect', function allowed() {finish(true)})
            socket.once('connect_error', function denied() {finish(false)})
        })
    }
    try {
        assert.equal(process.listenerCount('SIGTERM'), signals, 'embedded host owns no process signals')
        assert.equal((await preflight(origin)).headers.get('access-control-allow-origin'), origin)
        assert.equal((await preflight(deniedOrigin)).headers.get('access-control-allow-origin'), null)
        assert.equal(await websocket(origin), true)
        assert.equal(await websocket(deniedOrigin), false, 'HTTP and WS share the same allowlist')
        const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
        const id = createHash('sha256').update(photo).digest('hex')+'.png'
        await writeFile(path.join(directory, id), photo)
        const oldPhoto = await fetch(host.url+'/api/media/photos/'+id, {headers: {origin}})
        assert.equal(oldPhoto.headers.get('content-type'), 'image/png')
        assert.equal(oldPhoto.headers.get('x-content-type-options'), 'nosniff')
        assert.equal(oldPhoto.headers.get('access-control-allow-origin'), origin)
        assert.deepEqual(Buffer.from(await oldPhoto.arrayBuffer()), photo, 'pre-migration photos keep their URLs and bytes')
        async function upload(token: string, bytes: Buffer) {
            return fetch(host.url+'/api/media/photos', {
                method: 'POST',
                headers: {authorization: 'Bearer '+token, 'content-type': 'image/png'},
                body: new Uint8Array(bytes)
            })
        }
        assert.equal((await upload('customer', photo)).status, 403)
        assert.equal((await upload('editor', Buffer.from('<svg/>'))).status, 400)
        assert.equal((await upload('editor', Buffer.alloc(2*1024*1024+1))).status, 413)
        assert.equal((await (await upload('editor', photo)).json()).value.id, id, 'deduplication includes old photo files')
        await Promise.all([host.close(), host.close()])
        assert.equal(disposed, 1, 'concurrent close awaits exactly one mount disposer')
        assert.equal(host.httpServer.listening, false)
        await assert.rejects(fetch(host.url, {signal: AbortSignal.timeout(1000)}))
        console.log('PASS host: public runtime ownership, HTTP/WS CORS, async cleanup, legacy photo URLs, upload ACL and limits')
    } finally {
        await host.close()
        assert.equal(path.dirname(await realpath(directory)), root)
        await rm(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
