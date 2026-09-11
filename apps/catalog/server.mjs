import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const root = new URL('./', import.meta.url)
const shots = ['support', 'documents', 'metering', 'crm', 'booking', 'forms', 'monitoring', 'content', 'approvals']

/** @type {[string, [string, string]][]} */
const files = [
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/catalog.js', ['catalog.js', 'text/javascript; charset=utf-8']],
    ['/products.js', ['products.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]
for (const name of shots) files.push(['/screenshots/' + name + '.png', ['../../doc/screenshots/' + name + '.png', 'image/png']])
const routes = new Map(files)
const port = Number(process.env.CATALOG_PORT ?? 3800)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CATALOG_PORT должен быть 1-65535')
const server = createServer(async function serve(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'")
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
        response.writeHead(405).end()
        return
    }
    const route = routes.get((request.url ?? '').split('?')[0])
    if (!route) {
        response.writeHead(404).end('Not found')
        return
    }
    try {
        const bytes = await readFile(new URL(route[0], root))
        response.writeHead(200, {'content-type': route[1], 'cache-control': 'no-store'})
        response.end(request.method == 'HEAD' ? undefined : bytes)
    } catch {
        response.writeHead(404).end('Not found')
    }
})
server.listen(port, '127.0.0.1', function ready() {
    console.log('Витрина примеров: http://127.0.0.1:' + port + '/ · ' + fileURLToPath(root))
})
process.once('SIGINT', () => server.close())
process.once('SIGTERM', () => server.close())
