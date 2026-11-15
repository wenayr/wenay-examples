import http from 'node:http'
import {Readable} from 'node:stream'
import {fileURLToPath} from 'node:url'
import worker from '../dist/server/index.js'
import {createPreviewAgencyStorage} from './preview-agency-storage.mjs'

function option(name, fallback) {
    const index = process.argv.indexOf('--' + name)
    return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(option('port', process.env.PORT ?? process.env.SERVICE_PORT ?? 3000))
const host = option('host', process.env.HOST ?? '127.0.0.1')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Некорректный порт preview')
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) http.setGlobalProxyFromEnv?.()
const bucket = createPreviewAgencyStorage(fileURLToPath(new URL('../.cache/agency-preview/', import.meta.url)))
const server = http.createServer(async function serve(request, response) {
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1:' + port)
        const headers = new Headers(request.headers)
        // Fixed local preview identity cannot be selected by a browser or reach the hosted Worker.
        headers.set('oai-authenticated-user-id', 'travel-managed-preview-owner')
        headers.delete('oai-authenticated-user-email')
        const method = request.method ?? 'GET'
        const init = {method, headers, signal: controller.signal}
        if (method != 'GET' && method != 'HEAD') {
            init.body = Readable.toWeb(request)
            init.duplex = 'half'
        }
        const result = await worker.fetch(new Request(url, init), {BUCKET: bucket})
        if (response.destroyed) return
        response.writeHead(result.status, Object.fromEntries(result.headers))
        if (result.body) Readable.fromWeb(result.body).pipe(response)
        else response.end()
    } catch {
        if (!response.destroyed && !response.headersSent) {
            response.writeHead(500, {'content-type': 'text/plain; charset=utf-8'})
            response.end('Не удалось выполнить запрос.')
        }
    }
})
server.listen(port, host, () => console.log('Travel Worker preview http://' + host + ':' + port))
function shutdown() { server.close(() => process.exit(0)) }
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
