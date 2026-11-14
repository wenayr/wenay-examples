import {createPackages} from './packages.ts'
import {createPackageHttp, packageHttpPaths, packageJson} from './package-http.ts'
import {packageDestinations} from '../src/package-contract.ts'
import {placeDestinations} from './places/registry.mjs'

export interface WorkerAsset {body: string, type: string}

export function createTravelWorker(deps: {assets?: Record<string, WorkerAsset>, packages?: ReturnType<typeof createPackages>} = {}) {
    const destinations = placeDestinations.filter(place => packageDestinations.some(id => id == place.id))
    const http = createPackageHttp({packages: deps.packages ?? createPackages(), destinations})
    const decoded = new Map<string, Uint8Array<ArrayBuffer>>()
    let decodedBytes = 0
    function asset(path: string) {
        const entry = deps.assets?.[path]
        if (!entry) return null
        let body = decoded.get(path)
        if (!body) {
            body = Uint8Array.from(atob(entry.body), character => character.charCodeAt(0))
            if (decodedBytes + body.byteLength <= 4 * 1024 * 1024) {
                decoded.set(path, body)
                decodedBytes += body.byteLength
            }
        }
        return {body, type: entry.type}
    }
    async function fetch(request: Request) {
        const url = new URL(request.url)
        if (url.pathname == '/api/travel/health') return packageJson(200, {
            status: 'ok', runtime: 'worker-esm', source: 'TEZ TOUR Eesti',
            destinations: destinations.map(place => place.id), operations: packageHttpPaths,
            cacheTtlSeconds: 120, refresh: 'refresh=1', persistence: 'bounded-memory-cache',
        })
        const response = await http.handle(request)
        if (response) return response
        if (url.pathname.startsWith('/api/')) return packageJson(501, {
            error: 'Эта серверная операция пока не подключена на данном сайте. Доступны поиск туров, карта, отели и матрица цен.',
            operations: packageHttpPaths,
        })
        if (request.method != 'GET' && request.method != 'HEAD') return packageJson(405, {error: 'Используйте GET.'}, {Allow: 'GET, HEAD'})
        const path = url.pathname == '/' ? '/index.html' : url.pathname
        const entry = asset(path) ?? (!path.includes('.') ? asset('/index.html') : null)
        if (!entry) return packageJson(404, {error: 'Страница не найдена.'})
        return new Response(request.method == 'HEAD' ? null : entry.body, {headers: {
            'content-type': entry.type, 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        }})
    }
    return {fetch}
}
