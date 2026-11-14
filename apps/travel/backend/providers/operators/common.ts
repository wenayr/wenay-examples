import type {ProviderDeps, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'
export {amount, object, text} from '../stays/common.ts'

export function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

export function normalized(value: string) {
    return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const destinationAliases = {
    eg: 'egypt', египет: 'egypt', egiptus: 'egypt', hrg: 'hurghada', хургада: 'hurghada',
    ssh: 'sharm el sheikh', sharm: 'sharm el sheikh', 'шарм эль шейх': 'sharm el sheikh',
    'marsa alam': 'marsa alam', rmf: 'marsa alam', 'марса алам': 'marsa alam',
    tr: 'turkiye', turkey: 'turkiye', турция: 'turkiye', turgi: 'turkiye',
    gr: 'greece', kreeka: 'greece', греция: 'greece', cy: 'cyprus', kupros: 'cyprus', кипр: 'cyprus',
    ae: 'uae', 'united arab emirates': 'uae', оаэ: 'uae',
} as const satisfies Record<string, string>

function destinationTerm(value: string) {
    const term = normalized(value)
    return destinationAliases[term as keyof typeof destinationAliases] ?? term
}

export function matchesDestination(requested: string | undefined, names: string[]) {
    if (!requested) return true
    const term = destinationTerm(requested)
    return names.some(name => {
        const candidate = destinationTerm(name)
        return candidate == term || candidate.startsWith(term + ' ')
    })
}

export function day(value: unknown) {
    if (typeof value != 'string') return null
    const date = value.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
    const stamp = Date.parse(date + 'T00:00:00Z')
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) == date ? date : null
}

export function queryIssue(query: ProviderQuery) {
    if (query.kind != 'packages' && query.kind != 'deals') return 'Публичная витрина содержит пакетные туры.'
    if (query.currency && query.currency != 'EUR') return 'Публичная витрина публикует тарифы в EUR.'
    if (query.rooms !== undefined) return 'Витрина не подтверждает запрошенное распределение по номерам. Уберите число номеров для просмотра ориентиров.'
    if (query.checkedBag) return 'Витрина не подтверждает багаж на каждого пассажира. Условия нужно проверить у оператора.'
    if (query.adultAges?.length) return 'Публичная витрина не подтверждает возрастные условия для этого состава.'
    if (query.nights !== undefined && (!Number.isInteger(query.nights) || query.nights < 1)) return 'Укажите целое положительное число ночей.'
    if (query.departure && !day(query.departure)) return 'Проверьте дату начала поездки.'
    if (query.returnDate && !day(query.returnDate)) return 'Проверьте дату возвращения.'
    return null
}

export function result(id: string, status: ProviderResult['status'], description: string, sourceUrl: string): ProviderResult {
    return {providerId: id, status, offers: [], checkedAt: null, description, sourceUrl}
}

interface PageSnapshot {html: string, checkedAt: string, until: number}
const pageCaches = new WeakMap<typeof fetch, Map<string, PageSnapshot>>()
const pageRequests = new WeakMap<typeof fetch, Map<string, Promise<PageSnapshot>>>()

export async function page(deps: ProviderDeps, url: string) {
    const cache = pageCaches.get(deps.fetch) ?? new Map<string, PageSnapshot>()
    const pending = pageRequests.get(deps.fetch) ?? new Map<string, Promise<PageSnapshot>>()
    pageCaches.set(deps.fetch, cache)
    pageRequests.set(deps.fetch, pending)
    const previous = cache.get(url)
    if (previous && previous.until > deps.now().getTime()) return {...previous, cached: true}
    const underway = pending.get(url)
    if (underway) return {...await underway, cached: true}
    async function read() {
        const response = await deps.fetch(url, {headers: {Accept: 'text/html'}, signal: AbortSignal.timeout(18_000), redirect: 'error'})
        if (!response.ok) throw new Error('Публичная страница временно недоступна.')
        const html = await response.text()
        if (html.length > 5_000_000) throw new Error('Слишком большой ответ источника.')
        return {html, checkedAt: deps.now().toISOString(), until: deps.now().getTime() + 60_000}
    }
    const work = read()
    pending.set(url, work)
    try {
        const snapshot = await work
        if (cache.size >= 8) cache.delete(cache.keys().next().value!)
        cache.set(url, snapshot)
        return {...snapshot, cached: false}
    } finally {pending.delete(url)}
}

export function scriptData(html: string, id: string): unknown {
    const pattern = new RegExp('<script\\b[^>]*\\bid=["\\\']' + id + '["\\\'][^>]*>([\\s\\S]*?)<\\/script>', 'i')
    const match = html.match(pattern)
    if (!match) throw new Error('Источник изменил формат опубликованных данных.')
    return JSON.parse(match[1])
}
