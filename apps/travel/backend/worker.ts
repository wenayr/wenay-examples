import {createPackages} from './packages.ts'
import {createPackageHttp, packageHttpPaths, packageJson} from './package-http.ts'
import {packageDestinations} from '../src/package-contract.ts'
import {placeDestinations} from './places/registry.mjs'
import {agencyIdentity, createAgencies, type AgencyBucket} from './agency.ts'
import {createAgencyHttp} from './agency-http.ts'
import {createHotelReviewsHttp} from './hotel-reviews-http.ts'
import {createExpediaReviews} from './partners/expedia-reviews.ts'

export interface WorkerAsset {body: string, type: string}
export interface TravelWorkerEnv {
    BUCKET?: AgencyBucket
    EXPEDIA_RAPID_KEY?: string
    EXPEDIA_RAPID_SECRET?: string
    RAPID_API_KEY?: string
    RAPID_API_SECRET?: string
}

export function createTravelWorker(deps: {assets?: Record<string, WorkerAsset>, packages?: ReturnType<typeof createPackages>} = {}) {
    const destinations = placeDestinations.filter(place => packageDestinations.some(id => id == place.id))
    const packages = deps.packages ?? createPackages()
    function createServices(env: TravelWorkerEnv) {
        const reviews = createExpediaReviews({key: env.EXPEDIA_RAPID_KEY ?? env.RAPID_API_KEY, secret: env.EXPEDIA_RAPID_SECRET ?? env.RAPID_API_SECRET})
        const agencies = createAgencies({bucket: env.BUCKET, reviewProviderAvailable: reviews.source.configured})
        async function resolveSettings(input: Request) {
            const slug = new URL(input.url).searchParams.get('agency')
            if (slug != null) return agencies.view.settingsForSlug(slug)
            const owner = agencyIdentity(input)
            return owner ? (await agencies.view.get(owner)).agency : null
        }
        return {
            agency: createAgencyHttp({agencies}),
            reviews: createHotelReviewsHttp({provider: reviews.source.configured ? reviews : null, resolveSettings}),
            packages: createPackageHttp({packages, destinations, resolveSettings}),
        }
    }
    const services = new WeakMap<AgencyBucket, {key?: string, secret?: string, services: ReturnType<typeof createServices>}>()
    function servicesFor(env: TravelWorkerEnv) {
        if (!env.BUCKET) return createServices(env)
        const cached = services.get(env.BUCKET)
        const key = env.EXPEDIA_RAPID_KEY ?? env.RAPID_API_KEY
        const secret = env.EXPEDIA_RAPID_SECRET ?? env.RAPID_API_SECRET
        if (cached && cached.key == key && cached.secret == secret) return cached.services
        const entry = createServices(env)
        services.set(env.BUCKET, {key, secret, services: entry})
        return entry
    }
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
    async function fetch(request: Request, env: TravelWorkerEnv = {}) {
        const url = new URL(request.url)
        const service = servicesFor(env)
        const agencyResponse = await service.agency.handle(request)
        if (agencyResponse) return agencyResponse
        const reviewResponse = await service.reviews.handle(request)
        if (reviewResponse) return reviewResponse
        if (url.pathname == '/api/travel/health') return packageJson(200, {
            status: 'ok', runtime: 'worker-esm', source: 'TEZ TOUR Eesti',
            destinations: destinations.map(place => place.id), operations: packageHttpPaths,
            cacheTtlSeconds: 120, refresh: 'refresh=1', persistence: 'bounded-memory-cache',
            agencyStorage: env.BUCKET ? 'r2-json' : 'unavailable',
        })
        const response = await service.packages.handle(request)
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
