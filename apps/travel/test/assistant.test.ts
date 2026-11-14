import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'
import {createTravelAssistant} from '../backend/assistant.ts'
import type {AssistantDeps} from '../backend/assistant-tools.ts'

const today = () => '2026-11-13'
const destination = (id: string, name: string) => ({id, name, country: 'Египет', latitude: 0, longitude: 0, sourceIds: []})
const destinations = [destination('hurghada', 'Хургада'), destination('sharm', 'Шарм-эль-Шейх')]
const catalog = {destinations,
    list: () => ({destination: destinations[0], sources: [], items: [], total: 0, nextOffset: null})} satisfies AssistantDeps['catalog']
const source = {id: 'fixture', name: 'Fixture', status: 'cached' as const, updatedAt: today(), description: 'Test'}
const packages = {calendar: async () => null, search: async () => ({items: [], total: 0, markers: [], nextOffset: null,
    markersTruncated: false, source, coverage: 'supplier-minima' as const,
    geo: {mapped: 0, unresolved: 0, bounds: null}, direction: {total: 0, mapped: 0, unresolved: 0, bounds: null}})} satisfies AssistantDeps['packages']

test('Параметры поездки переходят из уточнения в пакетный поиск; отдельный билет остаётся самостоятельным маршрутом', async t => {
    const app = createTravelAssistant({today, catalog, packages, model: null})
    t.after(app.close)
    const first = await app.chat({message: 'В Египет во второй половине января на 10 дней до 2 400 евро'})
    assert.equal(first.result, null)
    assert.match(first.message, /Хургада.*Шарм/)
    const second = await app.chat({message: 'Шарм', context: first.context})
    assert.equal(second.mode, 'local')
    assert.equal(second.result?.kind, 'packages')
    assert.deepEqual(second.context, {kind: 'packages', destination: 'sharm', firstDeparture: '2027-01-15', lastDeparture: '2027-01-31',
        nights: 9, adults: 2, minTotal: 0, maxTotal: 240000, minStars: 0})
    const third = await app.chat({message: 'А только 5 звёзд от 1200 до 1800 евро', context: second.context})
    assert.equal(third.context.minTotal, 120000)
    assert.equal(third.context.maxTotal, 180000)
    assert.equal(third.context.minStars, 5)
    const flight = await app.chat({message: 'Авиабилеты Таллин – Рига на завтра с багажом'})
    assert.deepEqual(flight.result, {kind: 'flights',
        query: {origin: 'TLL', destination: 'RIX', departure: '2026-11-14', returnDate: null, adults: 1, checkedBag: true}})
})

test('Техас и Токио уточняются независимо, дата сохраняется, аэропорт вылета без выбора отсутствует', async t => {
    const app = createTravelAssistant({today, catalog, packages, model: null})
    t.after(app.close)
    const origin = await app.chat({message: 'Авиабилеты из Техаса в Токио завтра'})
    assert.deepEqual(origin.airportOptions, {side: 'origin', query: 'Техаса'})
    assert.match(origin.message, /DFW/)
    const destination = await app.chat({message: 'DFW', context: origin.context})
    assert.deepEqual(destination.airportOptions, {side: 'destination', query: 'Токио'})
    assert.match(destination.message, /NRT/)
    const route = await app.chat({message: 'в NRT', context: destination.context})
    assert.deepEqual(route.result, {kind: 'flights',
        query: {origin: 'DFW', destination: 'NRT', departure: '2026-11-14', returnDate: null, adults: 1, checkedBag: false}})
    const missing = await app.chat({message: 'Авиабилет в RIX завтра'})
    assert.deepEqual(missing.airportOptions, {side: 'origin', query: ''})
    assert.equal(missing.context.flight?.origin, undefined)
})

test('Responses использует серверный ключ, общие инструменты и локальный разбор при недоступности API', async t => {
    let online = true
    const fakeFetch: typeof fetch = async (url, options) => {
        assert.equal(url, 'https://api.openai.com/v1/responses')
        assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-only')
        const request = JSON.parse(String(options?.body))
        assert.equal(request.tool_choice.name, 'update_trip')
        assert.equal(request.store, false)
        if (!online) return new Response('', {status: 429})
        const args = JSON.stringify({kind: 'catalog', destination: 'sharm'})
        return Response.json({output: [{type: 'function_call', name: 'update_trip', arguments: args}]})
    }
    const app = createTravelAssistant({today, catalog, packages, model: {key: 'test-only', name: 'test', fetch: fakeFetch}})
    t.after(app.close)
    assert.equal((await app.chat({message: 'Отели на побережье'})).mode, 'openai')
    online = false
    const result = await app.chat({message: 'Только отели в Хургаде'})
    assert.equal(result.mode, 'local')
    assert.equal(result.result?.kind, 'catalog')
})

test('MCP Streamable HTTP объявляет доступные инструменты и выполняет проверенный запрос по каталогу', async t => {
    const app = createTravelAssistant({today, catalog, packages, model: null})
    const server = createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        await app.mcp(req, res, JSON.parse(Buffer.concat(chunks).toString()))
    }).listen(0, '127.0.0.1')
    t.after(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()))
        app.close()
    })
    await once(server, 'listening')
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/travel/mcp`
    const rpc = async (method: string, params?: object) => {
        const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'},
            body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})})
        assert.equal(response.status, 200)
        return response.json()
    }
    const hello = await rpc('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}})
    assert.equal(hello.result.serverInfo.name, 'wenay-travel')
    const tools = await rpc('tools/list')
    assert.ok(tools.result.tools.some((tool: {name: string}) => tool.name === 'hotel_calendar'))
    assert.equal((await rpc('tools/call', {name: 'search_hotels', arguments: {destination: 'sharm'}})).result.structuredContent.kind, 'catalog')
    const bad = await rpc('tools/call', {name: 'search_packages', arguments: {destination: 'fake'}})
    assert.ok(bad.error || bad.result.isError)
})
