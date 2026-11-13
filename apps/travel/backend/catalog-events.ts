import {randomUUID} from 'node:crypto'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {replayListen} from 'wenay-common2/replay'

type RegionalLine = ReturnType<typeof replayListen<[string]>>

export function createCatalogEvents({history = 64, maxClients = 512} = {}) {
    const epoch = randomUUID()
    const regions = new Map<string, RegionalLine>()
    const clients = new Map<ServerResponse, string>()

    function regionLine(destination: string) {
        let entry = regions.get(destination)
        if (!entry) {
            entry = replayListen<[string]>({history, fast: true})
            regions.set(destination, entry)
        }
        return entry
    }

    function revision(destination: string) {
        return epoch + ':' + destination + ':' + regionLine(destination)[1].head()
    }

    function send(response: ServerResponse, frame: string) {
        if (!response.destroyed && !response.writableEnded && !response.write(frame)) response.destroy()
    }

    const heartbeat = setInterval(() => {
        for (const response of clients.keys()) send(response, ': heartbeat\n\n')
    }, 20_000)
    heartbeat.unref()

    function subscribe(request: IncomingMessage, response: ServerResponse, destination: string, since: string | null) {
        if (clients.size >= maxClients) {
            response.writeHead(503, {'retry-after': '5'}).end()
            return
        }
        const [, line] = regionLine(destination)
        response.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
            'x-accel-buffering': 'no',
        })
        response.flushHeaders()
        clients.set(response, destination)
        function notify(type: 'catalog' | 'reset') {
            const id = revision(destination)
            const data = JSON.stringify({destination, revision: id})
            send(response, 'id: ' + id + '\nevent: ' + type + '\ndata: ' + data + '\n\n')
        }
        const off = line.line.on(() => notify('catalog'))
        response.once('close', () => {
            off()
            clients.delete(response)
        })
        send(response, 'retry: 1500\n\n')
        const cursor = request.headers['last-event-id'] ?? since
        const prefix = epoch + ':' + destination + ':'
        const text = typeof cursor == 'string' && cursor.startsWith(prefix) ? cursor.slice(prefix.length) : ''
        const seq = /^(0|[1-9]\d*)$/.test(text) ? Number(text) : -1
        if (seq == line.head()) return
        const oldest = line.journalWindow().oldestSeq ?? line.head()
        // All frames invalidate the same region. A single frame covers the whole retained tail.
        const resumable = Number.isSafeInteger(seq) && seq >= 0 && seq >= oldest - 1 && seq < line.head()
        notify(resumable ? 'catalog' : 'reset')
    }

    function close() {
        clearInterval(heartbeat)
        for (const response of clients.keys()) response.end()
        for (const [, events] of regions.values()) events.close()
        clients.clear()
    }
    return {
        revision, subscribe, changed: (destination: string) => regionLine(destination)[0](destination),
        activeDestinations: () => new Set(clients.values()), close,
    }
}
