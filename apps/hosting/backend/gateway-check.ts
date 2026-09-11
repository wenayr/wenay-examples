import assert from 'node:assert/strict'
import http from 'node:http'
import {createGatewayResource} from './gateway'

async function listen(server: http.Server) {
    await new Promise<void>(resolve=>server.listen(0, '127.0.0.1', resolve))
    return 'http://127.0.0.1:'+(server.address() as {port: number}).port
}

async function main() {
    let started!: ()=>void
    const slowStarted = new Promise<void>(resolve=>{started = resolve})
    let release!: ()=>void
    const proceed = new Promise<void>(resolve=>{release = resolve})
    const old = http.createServer(async function oldVersion(request, response) {
        if (request.url == '/slow') {started(); await proceed}
        response.end('old')
    })
    const next = http.createServer(async function newVersion(request, response) {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        response.setHeader('connection', 'x-internal')
        response.setHeader('x-internal', 'must-not-pass')
        response.end(JSON.stringify({version: 'new', url: request.url, method: request.method, body: Buffer.concat(chunks).toString(), secret: request.headers['x-secret'], host: request.headers.host}))
    })
    const oldEndpoint = await listen(old)
    const nextEndpoint = await listen(next)
    let gateway = createGatewayResource()
    let slow: Promise<string> | undefined
    try {
        const stable = await gateway.control.open('demo')
        assert.equal((await fetch(stable)).status, 503)
        assert.throws(()=>gateway.control.activate('demo', {operation: 'a'.repeat(64), endpoint: 'https://example.com'}))
        assert.throws(()=>gateway.control.activate('demo', {operation: 'a'.repeat(64), endpoint: stable}), /upstream/)
        gateway.control.activate('demo', {operation: 'a'.repeat(64), endpoint: oldEndpoint})
        slow = fetch(stable+'/slow', {signal: AbortSignal.timeout(5000)}).then(response=>response.text())
        void slow.catch(()=>{})
        await slowStarted
        gateway.control.activate('demo', {operation: 'b'.repeat(64), endpoint: nextEndpoint})
        let drained = false
        const draining = gateway.control.drain('a'.repeat(64)).then(function done() {drained = true})
        const response = await new Promise<{headers: http.IncomingHttpHeaders, body: string}>(function post(resolve, reject) {
            const request = http.request(stable+'/path?q=1', {method: 'POST', headers: {'connection': 'x-secret', 'x-secret': 'must-not-pass'}, signal: AbortSignal.timeout(5000)}, function incoming(response) {
                const chunks: Buffer[] = []
                response.on('data', chunk=>chunks.push(chunk))
                response.on('error', reject)
                response.on('end', ()=>resolve({headers: response.headers, body: Buffer.concat(chunks).toString()}))
            })
            request.on('error', reject)
            request.end('payload')
        })
        assert.equal(response.headers['x-internal'], undefined)
        assert.deepEqual(JSON.parse(response.body), {version: 'new', url: '/path?q=1', method: 'POST', body: 'payload', host: new URL(stable).host})
        assert.equal(drained, false, 'old in-flight request must finish before cleanup')
        release()
        assert.equal(await slow, 'old')
        await draining
        assert.equal(drained, true)
        await gateway.close()
        gateway = createGatewayResource()
        assert.equal(await gateway.control.open('demo', stable), stable, 'restart rebinds exactly the same port')
        const competitor = createGatewayResource()
        try {await assert.rejects(competitor.control.open('demo', stable), /EADDRINUSE/)} finally {await competitor.close()}
        assert.equal((await fetch(stable)).status, 503, 'restart does not serve an unverified target')
        console.log('PASS HTTP gateway: stable port, streaming body/path/query, hop headers, in-flight drain, endpoint restriction and occupied-port refusal')
    } finally {
        release?.()
        await slow?.catch(()=>{})
        await gateway.close()
        old.closeAllConnections()
        next.closeAllConnections()
        await Promise.all([new Promise<void>(resolve=>old.close(()=>resolve())), new Promise<void>(resolve=>next.close(()=>resolve()))])
    }
}

main().catch(function failed(error) {console.error(error); process.exitCode = 1})
