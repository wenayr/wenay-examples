import {createDefaultInventory, createPackages} from './packages.ts'
import {createPackageHttp, packageHttpPaths, packageJson} from './package-http.ts'
import {packageDestinations} from '../src/package-contract.ts'
import {placeDestinations} from './places/registry.mjs'
import {agencyIdentity, createAgencies, type AgencyBucket} from './agency.ts'
import {createAgencyHttp} from './agency-http.ts'
import {createHotelReviewsHttp} from './hotel-reviews-http.ts'
import {createExpediaReviews} from './partners/expedia-reviews.ts'
import {resolveProviderBufferConfig} from './provider-buffer-config.ts'

export interface WorkerAsset {body: string, type: string}
export interface TravelWorkerEnv {
    BUCKET?: AgencyBucket
    EXPEDIA_RAPID_KEY?: string
    EXPEDIA_RAPID_SECRET?: string
    RAPID_API_KEY?: string
    RAPID_API_SECRET?: string
    TRAVEL_UPDATE_PROFILE?: string
}
export interface TravelExecutionContext {waitUntil: (work: Promise<unknown>) => void}

function createWorkerJobs() {
    const owners = new Map<TravelExecutionContext, number>()
    const pending = new Set<Promise<unknown>>()
    function register(job: Promise<unknown>) {
        const bounded = job.catch(() => {})
        pending.add(bounded)
        for (const owner of owners.keys()) owner.waitUntil(bounded)
        void bounded.finally(() => pending.delete(bounded))
    }
    function own(context?: TravelExecutionContext) {
        if (context) {
            owners.set(context, (owners.get(context) ?? 0) + 1)
            for (const job of pending) context.waitUntil(job)
        }
        let closed = false
        return function release() {
            if (closed) return
            closed = true
            if (context) {
                const remaining = (owners.get(context) ?? 1) - 1
                if (remaining) owners.set(context, remaining)
                else owners.delete(context)
            }
        }
    }
    return {register, own, pending: () => pending.size}
}

export function createTravelWorker(deps: {
    assets?: Record<string, WorkerAsset>
    packages?: ReturnType<typeof createPackages>
    requireSharedStorage?: boolean
} = {}) {
    const destinations = placeDestinations.filter(place => packageDestinations.some(id => id == place.id))
    function createServices(env: TravelWorkerEnv) {
        const jobs = createWorkerJobs()
        const bufferConfig = resolveProviderBufferConfig(env.TRAVEL_UPDATE_PROFILE)
        const inventory = deps.packages ? null : createDefaultInventory({bucket: env.BUCKET, config: bufferConfig, waitUntil: jobs.register})
        const packages = deps.packages ?? createPackages(inventory!)
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
            packages: createPackageHttp({packages, destinations, resolveSettings, bufferConfig}),
            buffer: inventory?.health,
            indexes: packages.source.indexes,
            jobs,
        }
    }
    type ServiceEntry = {key?: string, secret?: string, profile?: string, services: ReturnType<typeof createServices>}
    const services = new WeakMap<AgencyBucket, ServiceEntry>()
    let localServices: ServiceEntry | null = null
    function servicesFor(env: TravelWorkerEnv) {
        const key = env.EXPEDIA_RAPID_KEY ?? env.RAPID_API_KEY
        const secret = env.EXPEDIA_RAPID_SECRET ?? env.RAPID_API_SECRET
        const cached = env.BUCKET ? services.get(env.BUCKET) : localServices
        const sameCredentials = cached?.key == key && cached?.secret == secret
        if (cached && sameCredentials && cached.profile == env.TRAVEL_UPDATE_PROFILE) return cached.services
        const entry = createServices(env)
        const stored = {key, secret, profile: env.TRAVEL_UPDATE_PROFILE, services: entry}
        if (env.BUCKET) services.set(env.BUCKET, stored)
        else localServices = stored
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
    async function fetch(request: Request, env: TravelWorkerEnv = {}, context?: TravelExecutionContext) {
        const url = new URL(request.url)
        if (deps.requireSharedStorage && !env.BUCKET && url.pathname.startsWith('/api/travel/')) {
            return packageJson(503, {status: 'degraded', persistence: 'unavailable', expected: 'r2-shared',
                error: 'Общий буфер цен временно недоступен. Повторная проверка отложена.'}, {'retry-after': '10'})
        }
        const service = servicesFor(env)
        const release = service.jobs.own(context)
        let streaming = false
        try {
            const agencyResponse = await service.agency.handle(request)
            if (agencyResponse) return agencyResponse
            const reviewResponse = await service.reviews.handle(request)
            if (reviewResponse) return reviewResponse
            if (url.pathname == '/api/travel/health') return packageJson(200, {
                status: 'ok', runtime: 'worker-esm', source: 'TEZ TOUR Eesti',
                destinations: destinations.map(place => place.id), operations: packageHttpPaths,
                refresh: 'refresh=1', persistence: env.BUCKET ? 'r2-shared-request-observations' : 'process-memory',
                agencyStorage: env.BUCKET ? 'r2-json' : 'unavailable',
                buffer: service.buffer?.snapshot() ?? {mode: 'injected-provider'},
                updates: service.packages.health.snapshot(), boundedJobs: service.jobs.pending(),
                indexes: service.indexes(),
            })
            const response = await service.packages.handle(request, release)
            if (response) {
                streaming = response.headers.get('content-type')?.startsWith('text/event-stream') ?? false
                return response
            }
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
        } finally {
            if (!streaming) release()
        }
    }
    return {fetch}
}
