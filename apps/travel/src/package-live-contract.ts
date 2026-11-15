const routes = ['packages', 'package-hotel-search', 'package-calendar', 'package-trends', 'package-matrix', 'package-compare'] as const
export const packageLiveRoutes = routes
export type tPackageLiveRoute = typeof routes[number]

export const packageLiveLimits = {resources: 48, descriptorBytes: 12_000, queryBytes: 3_000, urlBytes: 8_000} as const
export interface PackageLiveDemand {
    version: 1
    common: Record<string, string>
    resources: {path: tPackageLiveRoute, query: Record<string, string>}[]
}
export interface PackageLiveChange {key: string, version: string, retryAt?: string | null}
export interface PackageLiveCapability {
    transport: 'sse'
    profile: 'demand' | 'request-only' | 'economy'
    pollIntervalMs: number
    heartbeatMs: number
}

export function canonicalDirectoryResource(input: string) {
    const url = new URL(input, 'https://travel.invalid/')
    const params = new URLSearchParams()
    // The read handlers use .get(), so duplicate fields must preserve their first value.
    for (const [key, value] of url.searchParams) if (key != 'refresh' && !params.has(key)) params.set(key, value)
    params.sort()
    const query = params.toString()
    return url.pathname + (query ? '?' + query : '')
}

export function packageLiveRoute(input: string): tPackageLiveRoute | null {
    const path = new URL(input, 'https://travel.invalid/').pathname
    const route = path.slice('/api/travel/'.length)
    if (!path.startsWith('/api/travel/')) return null
    return routes.find(item => item == route) ?? null
}

export function packageLiveDemand(keys: readonly string[]): PackageLiveDemand {
    const entries = [...new Set(keys)].map(canonicalDirectoryResource).sort().map(function describe(key) {
        const url = new URL(key, 'https://travel.invalid/')
        const path = packageLiveRoute(key)
        if (!path) throw new RangeError('Этот ресурс нельзя подписать на обновления цен.')
        if (url.search.length > packageLiveLimits.queryBytes) throw new RangeError('Слишком длинный запрос обновления цен.')
        return {path, query: Object.fromEntries(url.searchParams)}
    })
    if (!entries.length || entries.length > packageLiveLimits.resources) throw new RangeError('Превышен лимит активных ресурсов цен.')
    const common = {...entries[0].query}
    for (const key of Object.keys(common)) {
        if (entries.some(entry => entry.query[key] != common[key])) delete common[key]
    }
    const resources = entries.map(function difference(entry) {
        const query = {...entry.query}
        for (const key of Object.keys(common)) delete query[key]
        return {path: entry.path, query}
    })
    const demand = {version: 1, common, resources} satisfies PackageLiveDemand
    if (encodeURIComponent(JSON.stringify(demand)).length > packageLiveLimits.descriptorBytes) {
        throw new RangeError('Слишком много данных в подписке на цены.')
    }
    return demand
}

function queryRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value != 'object' || Array.isArray(value)) return false
    return Object.entries(value).every(([key, item]) => key.length <= 80 && typeof item == 'string' && item.length <= 1_000)
}

export function packageLiveResources(value: unknown) {
    if (encodeURIComponent(JSON.stringify(value)).length > packageLiveLimits.descriptorBytes) {
        throw new RangeError('Слишком много данных в подписке на цены.')
    }
    if (!value || typeof value != 'object' || Array.isArray(value)) throw new RangeError('Ожидается описание подписки на цены.')
    const input = value as Partial<PackageLiveDemand>
    const validResources = Array.isArray(input.resources) && input.resources.length > 0 && input.resources.length <= packageLiveLimits.resources
    if (input.version != 1 || !queryRecord(input.common) || !validResources) throw new RangeError('Проверьте описание подписки на цены.')
    const keys = input.resources!.map(function resource(entry) {
        const validPath = entry && routes.some(path => path == entry.path)
        if (!validPath || !queryRecord(entry.query)) throw new RangeError('Недоступный ресурс в подписке на цены.')
        const params = new URLSearchParams({...input.common, ...entry.query})
        params.delete('refresh')
        if (params.toString().length > packageLiveLimits.queryBytes) throw new RangeError('Слишком длинный запрос обновления цен.')
        return canonicalDirectoryResource('/api/travel/' + entry.path + '?' + params)
    })
    if (new Set(keys).size != keys.length) throw new RangeError('Ресурсы подписки не должны повторяться.')
    return keys
}
