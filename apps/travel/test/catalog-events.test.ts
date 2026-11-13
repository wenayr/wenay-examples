import {strict as assert} from 'node:assert'
import test from 'node:test'
import {createServer} from 'node:http'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {createCatalogEvents} from '../backend/catalog-events.ts'

test('SSE передаёт изменения региона, совмещает пропущенные события и сбрасывает устаревший курсор', async t => {
    const events = createCatalogEvents({history: 2})
    const server = createServer((request, response) => {
        const url = new URL(request.url!, 'http://localhost')
        events.subscribe(request, response, 'paphos', url.searchParams.get('since'))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
        events.close()
        server.closeAllConnections()
        await new Promise<void>(done => server.close(() => done()))
    })
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
    async function open(cursor: string, headers = {}) {
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
        const response = await fetch(base + '?since=' + encodeURIComponent(cursor), {headers, signal})
        assert.match(response.headers.get('content-type')!, /event-stream/)
        const reader = response.body!.getReader()
        let text = ''
        async function next() {
            while (!text.includes('event: ')) {
                const {done, value} = await reader.read()
                assert.equal(done, false)
                text += new TextDecoder().decode(value)
            }
            return text
        }
        return {next, abort: () => controller.abort()}
    }
    const first = events.revision('paphos')
    const subscription = await open(first)
    events.changed('hurghada')
    events.changed('paphos')
    const id1 = events.revision('paphos')
    const frame = await subscription.next()
    assert.ok(frame.includes('id: ' + id1))
    assert.match(frame, /event: catalog/)
    assert.doesNotMatch(frame, /hurghada/)
    subscription.abort()
    events.changed('paphos')
    const missed = await open('invalid', {'Last-Event-ID': id1})
    assert.match(await missed.next(), /event: catalog/)
    missed.abort()
    events.changed('paphos')
    for (const invalid of [first, events.revision('hurghada'), 'previous-boot', '']) {
        const reset = await open(invalid)
        assert.match(await reset.next(), /event: reset/)
        reset.abort()
    }
})
