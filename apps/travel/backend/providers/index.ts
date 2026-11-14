import type {
    ProviderAdapter, ProviderAvailability, ProviderDeps, ProviderOffer, ProviderQuery, ProviderRegistration, ProviderResult, ProviderSearch
} from '../../src/provider-contract.ts'
import {existingProviders} from './existing/definitions.ts'
import {aviationProviders} from './aviation/definitions.ts'
import {stayProviders} from './stays/definitions.ts'
import {operatorProviders} from './operators/definitions.ts'
import {regionalProviders} from './regional/definitions.ts'
import {readProviderQuery} from './query.ts'
import {createHash} from 'node:crypto'
import {contextualProviderIds, describeMarkets, marketChecks, type MarketQueryCheck} from '../markets/index.ts'
import {travelRestriction} from '../markets/policy.ts'

export const providerRegistrations = {
    ...existingProviders, ...aviationProviders, ...stayProviders, ...operatorProviders, ...regionalProviders
} satisfies Record<string, ProviderRegistration>

function safeUrl(value: string | null | undefined) {
    if (!value) return false
    try {
        const url = new URL(value)
        return url.protocol == 'https:' && !url.username && !url.password
    } catch { return false }
}

function validOffer(offer: ProviderOffer, id: string, now: number) {
    const validIdentity = offer.providerId == id && !!offer.id && !!offer.title && safeUrl(offer.sourceUrl)
    if (!validIdentity) return false
    const price = offer.price
    const validPrice = price && Number.isFinite(price.amount) && price.amount > 0 && /^[A-Z]{3}$/.test(price.currency)
    if (!validPrice || !['party', 'person', 'room-night'].includes(price.basis)) return false
    const observed = Date.parse(offer.checkedAt)
    if (!Number.isFinite(observed) || observed > now + 60_000) return false
    if (offer.expiresAt && !(Date.parse(offer.expiresAt) > now)) return false
    return ['live-offer', 'published-from', 'cached-indicative'].includes(offer.accuracy)
}

function provenDeal(offer: ProviderOffer) {
    const deal = offer.deal
    if (!deal || !safeUrl(deal.evidenceUrl) || !deal.description) return false
    if (offer.price.type == 'net') return false
    if (deal.kind == 'supplier-sale') return true
    return deal.kind == 'observed-saving' && Number.isFinite(deal.referenceAmount) && deal.referenceAmount! > offer.price.amount
}

function matchingOffers(offers: ProviderOffer[]): ProviderSearch['groups'] {
    const groups = new Map<string, ProviderOffer[]>()
    for (const offer of offers) {
        const known = offer.comparisonKey && offer.conditions && typeof offer.includes?.taxes == 'boolean' && offer.price.type == 'retail'
        if (!known || offer.accuracy != 'live-offer' || offer.price.basis != 'party') continue
        const key = JSON.stringify([offer.kind, offer.comparisonKey, offer.price.currency, offer.price.basis,
            offer.adults, offer.departure, offer.returnDate, offer.checkIn, offer.checkOut])
        const group = groups.get(key)
        if (group) group.push(offer)
        else groups.set(key, [offer])
    }
    return [...groups].filter(([, values]) => values.length > 1).map(([key, values]) => ({key, offers: values}))
}

export function createProviderRegistry(deps: ProviderDeps & {registrations?: Record<string, ProviderRegistration>}) {
    const registrations: Record<string, ProviderRegistration> = deps.registrations ?? providerRegistrations
    const loaded = new Map<string, Promise<ProviderAdapter>>()
    const last = new Map<string, NonNullable<ProviderAvailability['lastResult']>>()
    const cache = new Map<string, {until: number, result: ProviderSearch}>()
    const pending = new Map<string, Promise<ProviderSearch>>()
    const marketProofs = new Map<string, MarketQueryCheck>()

    function availability(id: string): ProviderAvailability {
        const definition = registrations[id].definition
        const disabled = (deps.env.TRAVEL_DISABLED_PROVIDERS ?? '').split(',').map(value => value.trim())
        const enabled = !disabled.includes(id)
        const missingEnv = definition.requiredEnv.filter(key => !deps.env[key]?.trim())
        const configured = missingEnv.length == 0
        const sandbox = definition.optionalEnv?.some(key => key.endsWith('_SANDBOX') && deps.env[key] == 'true') ?? false
        const activeEnvironment = sandbox ? 'sandbox' as const : 'production' as const
        let status: ProviderAvailability['status'] = configured ? 'ready' : 'requires-access'
        if (definition.access == 'retired') status = 'unavailable'
        const lastResult = last.get(id)
        if (configured && lastResult) status = lastResult.status
        if (configured && sandbox) status = 'sandbox'
        if (!enabled) status = 'unavailable'
        return {...definition, status, configured, enabled, missingEnv, activeEnvironment, ...(lastResult ? {lastResult} : {}),
            description: enabled ? definition.description : definition.description + ' Источник отключён серверной настройкой.'}
    }

    function list() {
        const items = Object.keys(registrations).map(availability)
        const summary = {total: items.length, public: items.filter(item => item.access == 'public').length,
            configured: items.filter(item => item.configured && item.access != 'retired').length,
            configuredProduction: items.filter(item => item.configured && item.enabled && item.activeEnvironment == 'production').length,
            configuredSandbox: items.filter(item => item.configured && item.activeEnvironment == 'sandbox').length,
            requiresAccess: items.filter(item => !item.configured).length,
            liveVerified: items.filter(item => item.lastResult?.status == 'live').length,
            liveWithPrices: items.filter(item => item.lastResult?.status == 'live' && item.lastResult.offerCount > 0).length,
            cachedWithPrices: items.filter(item => item.lastResult?.status == 'cached' && item.lastResult.offerCount > 0).length,
            onboardingPaused: items.filter(item => item.onboarding == 'paused' || item.onboarding == 'closed').length}
        return {items, summary}
    }

    async function adapter(id: string) {
        let loading = loaded.get(id)
        if (!loading) {
            loading = registrations[id].load()
            loaded.set(id, loading)
        }
        try { return await loading } catch (error) {
            loaded.delete(id)
            throw error
        }
    }

    async function run(id: string, query: ProviderQuery): Promise<ProviderResult> {
        const source = availability(id)
        if (!source.enabled) return {providerId: id, status: 'unavailable', offers: [], checkedAt: null,
            description: 'Источник отключён через TRAVEL_DISABLED_PROVIDERS.', sourceUrl: source.docsUrl}
        if (!source.configured) return {providerId: id, status: 'requires-access', offers: [], checkedAt: null,
            description: source.activation, sourceUrl: source.docsUrl}
        if (source.access == 'retired') return {providerId: id, status: 'unavailable', offers: [], checkedAt: null,
            description: source.activation, sourceUrl: source.docsUrl}
        let result: ProviderResult
        try {
            result = await (await adapter(id)).search(query, deps)
            const now = deps.now().getTime()
            const byId = new Map<string, ProviderOffer>()
            if (result.environment != 'sandbox' && result.status != 'sandbox') {
                for (const offer of result.offers) {
                    if (!validOffer(offer, id, now)) continue
                    if (offer.deal?.expiresAt && !(Date.parse(offer.deal.expiresAt) > now)) continue
                    if (query.kind == 'deals' && !provenDeal(offer)) continue
                    const bookingUrl = safeUrl(offer.bookingUrl) ? offer.bookingUrl : null
                    byId.set(offer.id, {...offer, bookingUrl})
                }
            }
            result = {...result, providerId: id, offers: [...byId.values()]}
            if (result.environment == 'sandbox' || result.status == 'sandbox') {
                result = {...result, status: 'sandbox', offers: [], description: 'Тестовая среда поставщика. ' + result.description}
            }
        } catch {
            result = {providerId: id, status: 'unavailable', offers: [], checkedAt: null, sourceUrl: source.docsUrl,
                description: 'Источник не подтвердил ответ. Проверьте доступ, допустимые параметры и повторите поиск.'}
        }
        const {offers, ...metadata} = result
        last.set(id, {...metadata, offerCount: offers.length})
        return result
    }

    async function collect(ids: string[], query: ProviderQuery): Promise<ProviderSearch> {
        const results: ProviderResult[] = new Array(ids.length)
        let next = 0
        async function worker() {
            while (next < ids.length) {
                const index = next++
                results[index] = await run(ids[index], query)
            }
        }
        await Promise.all(Array.from({length: Math.min(4, ids.length)}, worker))
        const offers = results.flatMap(result => result.offers).sort((a, b) =>
            a.price.currency.localeCompare(b.price.currency) || a.price.basis.localeCompare(b.price.basis) ||
            (a.price.type ?? 'unknown').localeCompare(b.price.type ?? 'unknown') || a.price.amount - b.price.amount)
        const result = {query, offers, results, groups: matchingOffers(offers), checkedAt: deps.now().toISOString()}
        for (const check of marketChecks(query, result)) {
            marketProofs.set([check.country, check.providerId, check.kind, check.scope].join(':'), check)
        }
        return result
    }

    async function search(input: ProviderQuery): Promise<ProviderSearch> {
        const query = readProviderQuery(input, deps.now().toISOString().slice(0, 10))
        if (query.providers?.some(id => !registrations[id])) throw new RangeError('Неизвестный источник.')
        const selected = query.providers ?? contextualProviderIds(query, Object.keys(registrations))
        const ids = selected.filter(id => registrations[id].definition.kinds.includes(query.kind))
        const restriction = travelRestriction(query)
        if (restriction) {
            return {query, offers: [], groups: [], checkedAt: deps.now().toISOString(), notices: [restriction],
                results: ids.map(providerId => ({providerId, status: 'unsupported-query', offers: [], checkedAt: null,
                    sourceUrl: restriction.evidence[0].url, description: restriction.description}))}
        }
        const config = ids.map(id => {
            const source = availability(id)
            const fields = [...source.requiredEnv, ...(source.optionalEnv ?? [])]
            const revision = createHash('sha256').update(JSON.stringify(fields.map(field => deps.env[field] ?? ''))).digest('hex')
            return [source.configured, source.activeEnvironment, source.enabled, revision]
        })
        const key = JSON.stringify([query, ids, config])
        const previous = cache.get(key)
        const now = deps.now().getTime()
        const current = previous && previous.until > now && previous.result.offers.every(offer => !offer.expiresAt || Date.parse(offer.expiresAt) > now)
        if (current && previous) {
            return {...previous.result, results: previous.result.results.map(result => result.status == 'live' ? {...result, status: 'cached'} : result)}
        }
        const underway = pending.get(key)
        if (underway) return underway
        if (pending.size >= 8) throw new RangeError('Идёт несколько поисков. Повторите запрос после завершения одного из них.')
        const work = collect(ids, query)
        pending.set(key, work)
        try {
            const result = await work
            if (cache.size >= 100) cache.delete(cache.keys().next().value!)
            const failed = result.results.some(source => source.status == 'unavailable')
            cache.set(key, {result, until: deps.now().getTime() + (failed ? 10_000 : 60_000)})
            return result
        } finally {pending.delete(key)}
    }
    function markets(country?: string) {
        return describeMarkets(list(), [...marketProofs.values()], country)
    }
    return {list, search, markets}
}
