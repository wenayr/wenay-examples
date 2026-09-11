import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHttpProbe, probeTargets} from './http-probe'
async function main() {
    let privateHits = 0
    const server = createServer(function fixture(request, response) {
        if (request.url == '/ok') {
            response.end('ok')
            return
        }
        if (request.url == '/bad') {
            response.writeHead(503).end('down')
            return
        }
        if (request.url == '/large') {
            response.end('a'.repeat(20000))
            return
        }
        if (request.url == '/redirect') {
            response.writeHead(302, {location: '/private'}).end()
            return
        }
        if (request.url == '/private') {
            privateHits++
            response.end('private')
            return
        }
        if (request.url == '/headers') {
            response.setHeader('X-Large', 'a'.repeat(10000))
            response.end()
            return
        }
        if (request.url == '/hang') return
        response.writeHead(404).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as {port: number}).port
    try {
        const names = ['ok', 'bad', 'large', 'redirect', 'hang', 'headers']
        const targets = names.map(function target(id) {
            return {id, name: id, url: 'http://operator.invalid:' + port + '/' + id, address: '127.0.0.1'}
        })
        const probe = createHttpProbe({targets})
        const check = (presetId: string) => probe.control.check({presetId, timeoutMs: 150, signal: new AbortController().signal})
        assert.equal((await check('ok')).outcome, 'up', 'request reaches pinned address without resolving operator.invalid')
        assert.equal((await check('bad')).code, 503)
        assert.match((await check('large')).detail, /16 КиБ/)
        assert.match((await check('redirect')).detail, /Перенаправление/)
        assert.equal(privateHits, 0)
        assert.equal((await check('headers')).outcome, 'down')
        const started = Date.now()
        assert.equal((await check('hang')).outcome, 'down')
        assert(Date.now() - started < 1000)
        assert.equal((await check('unknown')).outcome, 'unknown')
        assert.throws(() => probeTargets(JSON.stringify([{id: 'bad', name: 'Bad', url: 'file:///etc/passwd', address: '127.0.0.1'}])))
        assert.throws(() => probeTargets(JSON.stringify([{id: 'bad', name: 'Bad', url: 'http://127.0.0.2/', address: '127.0.0.1'}])))
        assert.throws(() => probeTargets(JSON.stringify([{id: 'bad', name: 'Bad', url: 'http://user:pass@host/', address: '127.0.0.1'}])))
        console.log('PASS HTTP probe: operator address pinning without DNS, response/header caps, timeout, no redirect to private target, malformed target rejection, no external requests')
    } finally {server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
