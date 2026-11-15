import assert from 'node:assert/strict'
import test from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {createPackageLive} from '../backend/package-live.ts'
import {resolveProviderBufferConfig} from '../backend/provider-buffer-config.ts'
import {packageLiveDemand} from '../src/package-live-contract.ts'

const first = '/api/travel/package-matrix?hotelId=tez%3A1061&firstDeparture=2030-01-20'
const second = '/api/travel/packages?destination=hurghada'
function request(keys = [first], headers: Record<string, string> = {}) {
    const url = new URL('https://travel.example/api/travel/package-events')
    url.searchParams.set('demand', JSON.stringify(packageLiveDemand(keys)))
    return new Request(url, {headers})
}

function events(response: Response) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    async function next(name: string) {
        while (true) {
            const end = buffered.indexOf('\n\n')
            if (end >= 0) {
                const frame = buffered.slice(0, end)
                buffered = buffered.slice(end + 2)
                const lines = frame.split('\n')
                if (!lines.includes('event: ' + name)) continue
                const data = lines.find(line => line.startsWith('data: '))?.slice(6)
                return {id: lines.find(line => line.startsWith('id: '))?.slice(4), data: data ? JSON.parse(data) : null}
            }
            const value = await reader.read()
            if (value.done) throw new Error('Stream closed before ' + name)
            buffered += decoder.decode(value.value, {stream: true})
        }
    }
    return {next, close: () => reader.cancel()}
}

test('two subscribers share one reconcile owner; last disconnect stops recurring work', {timeout: 3000}, async t => {
    let reads = 0
    const live = createPackageLive({
        read: async () => {
            reads++
            return Response.json({source: {updatedAt: '2030-01-01T00:00:00Z'}, price: 100})
        },
        scope: async () => 'public', config: {...resolveProviderBufferConfig(), sharedCheckMs: 50},
    })
    t.after(live.resource.close)
    const [left, right] = await Promise.all([live.handle(request()), live.handle(request())])
    assert.equal(left!.status, 200)
    assert.equal(right!.status, 200)
    const a = events(left!)
    const b = events(right!)
    t.after(a.close)
    t.after(b.close)
    const [one, two] = await Promise.all([a.next('resource'), b.next('resource')])
    assert.equal(one.data.version, two.data.version)
    assert.equal(reads, 1)
    await delay(110)
    assert.ok(reads >= 2)
    assert.equal(live.health.snapshot().resourceChanges, 1)
    await a.close()
    assert.equal(live.health.snapshot().activeClients, 1)
    await b.close()
    const stoppedAt = reads
    await delay(110)
    assert.equal(reads, stoppedAt)
    assert.equal(live.health.snapshot().activeClients, 0)
    assert.equal(live.health.snapshot().activeResources, 0)
})

test('opening reservations and resource preflight reject capacity before any upstream work', {timeout: 3000}, async t => {
    let reads = 0
    let releaseScope = () => {}
    const scope = new Promise<string>(resolve => { releaseScope = () => resolve('public') })
    const live = createPackageLive({
        read: async () => {
            reads++
            return Response.json({price: 100})
        },
        scope: () => scope, config: resolveProviderBufferConfig('request-only'), limits: {clients: 2, resources: 1},
    })
    t.after(live.resource.close)
    const openingA = live.handle(request())
    const openingB = live.handle(request())
    const excess = await live.handle(request())
    assert.equal(excess!.status, 503)
    assert.equal(excess!.headers.get('retry-after'), '5')
    assert.equal(reads, 0)
    releaseScope()
    const [a, b] = await Promise.all([openingA, openingB])
    await a!.body!.cancel()
    await b!.body!.cancel()
    const before = reads
    const full = await live.handle(request([first, second]))
    assert.equal(full!.status, 503)
    assert.equal(reads, before)
    assert.equal(live.health.snapshot().activeClients, 0)
    assert.equal(live.health.snapshot().activeResources, 0)
    const valid = await live.handle(request())
    assert.equal(valid!.status, 200)
    await valid!.body!.cancel()
})

test('request-only sends updates from explicit observations without a hidden poll loop', {timeout: 3000}, async t => {
    let reads = 0
    const live = createPackageLive({
        read: async () => {
            reads++
            return Response.json({price: 100})
        }, scope: async () => 'public',
        config: {...resolveProviderBufferConfig('request-only'), sharedCheckMs: 10},
    })
    t.after(live.resource.close)
    const stream = events((await live.handle(request()))!)
    t.after(stream.close)
    const initial = await stream.next('resource')
    await delay(40)
    assert.equal(reads, 1)
    await live.source.observed(new Request('https://travel.example' + first), Response.json({price: 120}))
    const changed = await stream.next('resource')
    assert.notEqual(changed.data.version, initial.data.version)
    assert.equal(reads, 1)
    assert.equal(live.health.snapshot().automatic, false)
})

test('same epoch resumes the retained tail; another isolate resets and owner scopes remain separate', {timeout: 3000}, async t => {
    const make = () => createPackageLive({
        read: async request => Response.json({ownerView: request.headers.get('oai-authenticated-user-id')}),
        scope: async request => request.headers.get('oai-authenticated-user-id') ?? 'public', config: resolveProviderBufferConfig('request-only'),
    })
    const live = make()
    const other = make()
    t.after(live.resource.close)
    t.after(other.resource.close)
    const stream = events((await live.handle(request([first], {'oai-authenticated-user-id': 'a'})))!)
    t.after(stream.close)
    const initial = await stream.next('resource')
    await live.source.observed(new Request('https://travel.example' + first,
        {headers: {'oai-authenticated-user-id': 'a'}}), Response.json({price: 120}))
    const changed = await stream.next('resource')
    await stream.close()
    const resumed = events((await live.handle(request([first], {'oai-authenticated-user-id': 'a', 'last-event-id': initial.id!})))!)
    t.after(resumed.close)
    assert.equal((await resumed.next('resource')).data.version, changed.data.version)
    const reset = events((await other.handle(request([first], {'oai-authenticated-user-id': 'a', 'last-event-id': changed.id!})))!)
    t.after(reset.close)
    assert.equal(typeof (await reset.next('reset')).data.epoch, 'string')
    const separate = events((await live.handle(request([first], {'oai-authenticated-user-id': 'b'})))!)
    t.after(separate.close)
    assert.notEqual((await separate.next('resource')).data.version, initial.data.version)
    assert.equal(live.health.snapshot().activeResources, 2)
})
