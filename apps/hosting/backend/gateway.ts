import http from 'node:http'
import {localEndpoint} from './endpoint'

type Target = {operation: string, endpoint: string}

const HOP_BY_HOP = [
    'connection', 'proxy-connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'
]

// Принимаем только обычный путь: `//host` уводит запрос на чужой адрес.
function localPath(url: string | undefined) {
    return !!url && url.startsWith('/') && !url.startsWith('//')
}

function forwarded(headers: http.IncomingHttpHeaders) {
    // Хоп-бай-хоп заголовки дальше не идут, вместе с перечисленными в Connection.
    const listed = (headers.connection ?? '').toLowerCase().split(',').map(value => value.trim())
    const excluded = new Set([...HOP_BY_HOP, ...listed])
    return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key)))
}

export function createGatewayResource() {
    const routes = new Map<string, {server: http.Server, endpoint: string, target: Target | null}>()
    const inFlight = new Map<string, Set<Promise<void>>>()
    const streams = new Map<string, Set<() => void>>()
    let closed = false

    async function open(id: string, endpoint?: string) {
        if (closed) throw new Error('gateway is closed')
        const previous = routes.get(id)
        if (previous) {
            if (endpoint && previous.endpoint != endpoint) throw new Error('gateway address changed unexpectedly')
            return previous.endpoint
        }
        const route = {server: http.createServer(), endpoint: '', target: null as Target | null}
        route.server.maxConnections = 64
        route.server.headersTimeout = 5000
        route.server.requestTimeout = 30_000
        route.server.on('request', function proxy(request, response) {
            const target = route.target
            if (!target || !localPath(request.url) || request.method == 'CONNECT') {
                response.writeHead(target ? 400 : 503, {'connection': 'close', 'cache-control': 'no-store'})
                response.end(target ? 'Invalid request' : 'Application unavailable')
                return
            }
            let done!: () => void
            const operation = target.operation
            const completion = new Promise<void>(resolve => {done = resolve})
            const pending = inFlight.get(target.operation) ?? new Set<Promise<void>>()
            pending.add(completion)
            inFlight.set(target.operation, pending)
            const headers = forwarded(request.headers)
            headers.host = new URL(route.endpoint).host
            headers.via = headers.via ? headers.via+', 1.1 wenay-gateway' : '1.1 wenay-gateway'
            delete headers['x-forwarded-for']
            delete headers['x-forwarded-host']
            delete headers['x-forwarded-proto']
            const upstream = http.request({hostname: '127.0.0.1', port: localEndpoint(target.endpoint), path: request.url, method: request.method, headers,
                signal: AbortSignal.timeout(30_000),
            }, function received(incoming) {
                response.writeHead(incoming.statusCode ?? 502, forwarded(incoming.headers))
                incoming.on('error', function failed() {response.destroy()})
                incoming.pipe(response)
            })
            function finish() {
                upstream.destroy()
                pending.delete(completion)
                if (!pending.size) inFlight.delete(operation)
                done()
            }
            response.once('close', finish)
            upstream.on('error', function failed() {
                if (response.headersSent) response.destroy()
                else {
                    response.writeHead(502, {'connection': 'close'})
                    response.end('Upstream unavailable')
                }
            })
            request.on('error', function failed() {upstream.destroy()})
            request.pipe(upstream)
        })
        route.server.on('upgrade', function websocket(request, socket, head) {
            const target = route.target
            const upgrading = request.headers.upgrade?.toLowerCase() == 'websocket'
            const wanted = request.method == 'GET' && upgrading
            if (!target || !wanted || !localPath(request.url)) {
                socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
                return
            }
            const headers = forwarded(request.headers)
            headers.host = new URL(route.endpoint).host
            headers.connection = 'Upgrade'
            headers.upgrade = 'websocket'
            delete headers['x-forwarded-for']
            delete headers['x-forwarded-host']
            delete headers['x-forwarded-proto']
            const upstream = http.request({hostname: '127.0.0.1', port: localEndpoint(target.endpoint), path: request.url, method: 'GET', headers})
            let remote: typeof socket | null = null
            let finished = false
            const connections = streams.get(target.operation) ?? new Set<() => void>()
            streams.set(target.operation, connections)
            function finish() {
                if (finished) return
                finished = true
                upstream.destroy()
                remote?.destroy()
                socket.destroy()
                connections.delete(finish)
                if (!connections.size) streams.delete(target!.operation)
            }
            connections.add(finish)
            socket.on('error', finish)
            socket.on('close', finish)
            upstream.on('error', finish)
            upstream.setTimeout(5000, finish)
            upstream.on('response', finish)
            upstream.on('upgrade', function connected(response, incoming, first) {
                if (finished) {
                    incoming.destroy()
                    return
                }
                remote = incoming
                upstream.setTimeout(0)
                if (response.statusCode != 101) {
                    finish()
                    return
                }
                const accepted = {...forwarded(response.headers), connection: 'Upgrade', upgrade: 'websocket'}
                const present = Object.entries(accepted).filter(([, value]) => value != undefined)
                const lines = present.map(([key, value]) => key + ': ' + value).join('\r\n')
                socket.write('HTTP/1.1 101 Switching Protocols\r\n' + lines + '\r\n\r\n')
                incoming.on('error', finish)
                incoming.on('close', finish)
                if (first.length) socket.write(first)
                if (head.length) incoming.write(head)
                socket.pipe(incoming)
                incoming.pipe(socket)
            })
            upstream.end()
        })
        await new Promise<void>(function listen(resolve, reject) {
            route.server.once('error', reject)
            route.server.listen(endpoint ? localEndpoint(endpoint) : 0, '127.0.0.1', function listening() {
                route.server.off('error', reject)
                resolve()
            })
        })
        if (closed) {
            route.server.closeAllConnections()
            await new Promise<void>(resolve => route.server.close(() => resolve()))
            throw new Error('gateway is closed')
        }
        route.endpoint = 'http://127.0.0.1:'+(route.server.address() as {port: number}).port
        routes.set(id, route)
        return route.endpoint
    }

    function activate(id: string, target: Target | null) {
        const route = routes.get(id)
        if (!route) throw new Error('gateway must be opened before activation')
        if (target) {
            localEndpoint(target.endpoint)
            const taken = [...routes.values()].some(item => item.endpoint == target.endpoint)
            if (!/^[a-f0-9]{64}$/.test(target.operation) || taken) {
                throw new Error('invalid gateway upstream')
            }
        }
        route.target = target ? {...target} : null
    }

    async function drain(operation: string) {
        // Long-lived clients reconnect through the already switched stable route.
        for (const close of [...(streams.get(operation) ?? [])]) close()
        await Promise.all(inFlight.get(operation) ?? [])
    }

    async function close() {
        closed = true
        for (const connections of [...streams.values()]) for (const close of [...connections]) close()
        const closing = [...routes.values()]
        routes.clear()
        for (const route of closing) {
            route.target = null
            route.server.closeAllConnections()
        }
        await Promise.all(closing.map(route => new Promise<void>(resolve => route.server.close(() => resolve()))))
    }

    return {control: {open, activate, drain}, close}
}
