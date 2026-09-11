import assert from 'node:assert/strict'
import http from 'node:http'
import {Server} from 'socket.io'
import {io} from 'socket.io-client'
import {createGatewayResource} from './gateway'

async function main() {
    async function app(name: string) {
        const server = http.createServer()
        const socket = new Server(server)
        socket.on('connection', client => {client.on('echo', (text, ack) => ack(name + ':' + text))})
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        return {url: 'http://127.0.0.1:' + (server.address() as {port: number}).port, close: () => new Promise<void>(resolve => socket.close(() => resolve()))}
    }
    const old = await app('old'), next = await app('next'), gateway = createGatewayResource()
    const url = await gateway.control.open('websocket')
    gateway.control.activate('websocket', {operation: 'a'.repeat(64), endpoint: old.url})
    const client = io(url, {transports: ['websocket'], reconnectionDelay: 100})
    async function connected() {
        const until = Date.now() + 5000
        while (!client.connected) {
            assert(Date.now() < until)
            await new Promise(resolve => setTimeout(resolve, 20))
        }
    }
    try {
        await connected()
        assert.equal(await client.timeout(2000).emitWithAck('echo', 'before'), 'old:before')
        gateway.control.activate('websocket', {operation: 'b'.repeat(64), endpoint: next.url})
        const disconnected = new Promise<void>(resolve => client.once('disconnect', () => resolve()))
        await gateway.control.drain('a'.repeat(64))
        await disconnected
        await connected()
        assert.equal(await client.timeout(2000).emitWithAck('echo', 'after'), 'next:after')
        console.log('PASS gateway WebSocket: actual Socket.IO upgrade, bidirectional payload, bounded drain and reconnect to replacement at stable URL')
    } finally {client.close()
    await gateway.close()
    await old.close()
    await next.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
