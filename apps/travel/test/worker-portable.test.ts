import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {createContext, runInContext} from 'node:vm'
import {test} from 'node:test'
import {build} from 'vite'
import {createTezInventory} from '../backend/partners/tez-inventory.ts'

const checkedAt = '2030-01-01T10:00:00.000Z'
const trip = {destinationId: 'hurghada', first: '2030-01-24', last: '2030-01-24', nights: 7,
    adults: 2, minTotal: 0, maxTotal: 500_000}

function row(total: number) {
    const board = ['HB', 'Полупансион', 2474, 2146]
    const room = [2471, 'Standard · море', 2147]
    const data: unknown[] = ['24.01.2030', [], '', 7, '', ['', '', 5734], ['', 'SAND BEACH 3 *', '', 1061],
        board, room, [[2, 0, 0]], {currency: 'EUR', total}, [['opaque-agency-reference']]]
    data[17] = {tariff: 'opaque'}
    data[22] = 'source-rate'
    return {data, expected: 'tez-offer:' + createHash('sha256').update(JSON.stringify([
        'tez:1061', trip.first, 7, board, room, data[17], data[22], 'opaque-agency-reference', total * 100,
    ])).digest('hex').slice(0, 24)}
}

function response(total: number) {
    return Response.json({success: true, departureCityId: 3746, data: [row(total).data], info: [['More results', 'false']]})
}

test('portable SHA-256 keeps existing fare identity and explicit window/range refresh bypasses current observations', async () => {
    let calls = 0
    let total = 1384
    let failed = false
    let clock = Date.parse(checkedAt)
    const provider = createTezInventory({now: () => new Date(clock), fetch: async () => {
        calls++
        if (failed) throw new Error('Controlled supplier failure')
        return response(total)
    }})
    const first = await provider.window(trip)
    assert.equal(first.quotes[0].id, row(1384).expected)
    const cached = await provider.window(trip)
    assert.equal(calls, 1)
    assert.equal(cached.source.status, 'cached')
    assert.equal(cached.source.stale, undefined)
    total = 1412
    clock += 1000
    const refreshed = await provider.window(trip, undefined, true)
    assert.equal(calls, 2)
    assert.equal(refreshed.quotes[0].id, row(1412).expected)
    assert.equal(refreshed.source.status, 'live')
    assert.ok(provider.range)
    const range = await provider.range(trip, 'tez:1061', trip.first, [6, 7, 8])
    assert.equal(range.quotes[0].id, row(1412).expected)
    await provider.range(trip, 'tez:1061', trip.first, [8, 6, 7])
    assert.equal(calls, 3)
    total = 1440
    clock += 1000
    const freshRange = await provider.range(trip, 'tez:1061', trip.first, [6, 7, 8], undefined, true)
    assert.equal(calls, 4)
    assert.equal(freshRange.quotes[0].id, row(1440).expected)
    failed = true
    clock += 1000
    const stale = await provider.range(trip, 'tez:1061', trip.first, [6, 7, 8], undefined, true)
    assert.equal(calls, 5)
    assert.equal(stale.source.status, 'cached')
    assert.equal(stale.source.stale, true)
    assert.equal(stale.source.updatedAt, freshRange.source.updatedAt)
    assert.equal(stale.quotes[0].id, freshRange.quotes[0].id)
    failed = false
    total = 1475
    const recovered = await provider.range(trip, 'tez:1061', trip.first, [6, 7, 8], undefined, true)
    assert.equal(calls, 6)
    assert.equal(recovered.source.stale, undefined)
    assert.equal(recovered.quotes[0].id, row(1475).expected)
})

test('the public Wenay client queue and portable inventory bundle run without Node globals or dynamic code generation', async () => {
    const result = await build({
        root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, publicDir: false, logLevel: 'silent',
        build: {write: false, minify: true, target: 'es2022', lib: {
            entry: fileURLToPath(new URL('../backend/partners/tez-inventory.ts', import.meta.url)),
            name: 'TezWorkerProbe', formats: ['es', 'iife'],
        }},
    })
    const outputs = Array.isArray(result) ? result : [result]
    const files = outputs.flatMap(output => 'output' in output ? output.output : [])
    const chunks = files.filter(file => file.type == 'chunk')
    assert.equal(chunks.length, 2)
    for (const chunk of chunks) {
        assert.deepEqual(chunk.imports, [])
        assert.equal(/\beval\s*\(/.test(chunk.code), false)
    }
    const iife = chunks.find(chunk => /\bTezWorkerProbe\s*=/.test(chunk.code))
    assert.ok(iife)
    const context = createContext({
        console, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response, Headers, DOMException, AbortController, AbortSignal,
        Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, self: {},
    }, {codeGeneration: {strings: false, wasm: false}})
    runInContext(iife.code, context)
    const worker = context.TezWorkerProbe as {createTezInventory: typeof createTezInventory}
    const provider = worker.createTezInventory({now: () => new Date(checkedAt), fetch: async () => response(1384)})
    const observed = await provider.day(trip, 'tez:1061', trip.first)
    assert.equal(observed.source.status, 'live')
    assert.equal(observed.quotes[0].id, row(1384).expected)
    assert.equal(observed.quotes[0].latitude, 27.26083928002099)
})
