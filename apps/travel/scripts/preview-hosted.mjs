import http from 'node:http'
import {Readable} from 'node:stream'
import worker from '../dist/server/index.js'

function option(name, fallback) {
    const index = process.argv.indexOf('--' + name)
    return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(option('port', process.env.PORT ?? process.env.SERVICE_PORT ?? 3000))
const host = option('host', process.env.HOST ?? '127.0.0.1')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Некорректный порт preview')
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) http.setGlobalProxyFromEnv?.()
const server = http.createServer(async function serve(request, response) {
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1:' + port)
        const result = await worker.fetch(new Request(url, {method: request.method, signal: controller.signal}))
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
