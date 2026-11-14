import type {ProviderAdapter, ProviderDeps, ProviderOffer, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'

export function object(value: unknown): Record<string, unknown> {
    return value && typeof value == 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function rows(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value)) throw new Error('Неверный формат ' + name)
    return value
}

export function text(value: unknown) {
    return typeof value == 'string' ? value : ''
}

export function amount(value: unknown) {
    if (typeof value != 'number' && typeof value != 'string') return null
    if (typeof value == 'string' && !/^\d+(\.\d+)?$/.test(value)) return null
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
}

export function refs(query: ProviderQuery, id: string) {
    return query.providerRefs?.[id] ?? {}
}

export function roomAdults(query: ProviderQuery) {
    const rooms = query.rooms ?? 1
    const perRoom = Math.floor(query.adults / rooms)
    return Array.from({length: rooms}, (_, index) => perRoom + Number(index < query.adults % rooms))
}

export function hotelInput(query: ProviderQuery) {
    if (query.kind != 'hotels') return 'Источник обслуживает поиск отелей.'
    const dates = [query.checkIn, query.checkOut]
    if (dates.some(date => !date || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return 'Нужны даты заезда и выезда.'
    if (query.checkOut! <= query.checkIn!) return 'Выезд должен быть позже заезда.'
    const rooms = query.rooms ?? 1
    if (!Number.isInteger(rooms) || rooms < 1 || rooms > query.adults) return 'В каждом номере должен быть хотя бы один взрослый.'
    return null
}

export function hasGeo(query: ProviderQuery) {
    return Number.isFinite(query.latitude) && Number.isFinite(query.longitude)
}

export class ProviderAccessError extends Error {}
export class ProviderQueryError extends Error {}

export async function requestJson(deps: ProviderDeps, url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await deps.fetch(url, {...init, redirect: 'error', signal: AbortSignal.timeout(15_000)})
    if (response.status == 401 || response.status == 403) throw new ProviderAccessError('Поставщик не подтвердил доступ.')
    if (!response.ok) throw new Error('Источник временно недоступен.')
    return response.json()
}

export function jsonPost(body: unknown, headers: Record<string, string> = {}) {
    return {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', ...headers}, body: JSON.stringify(body)}
}

export function basic(user: string, password: string) {
    return 'Basic ' + Buffer.from(user + ':' + password).toString('base64')
}

export function hotelOffer(id: string, query: ProviderQuery, deps: ProviderDeps, data: {
    rateId: string, hotelId: string, name: string, total: unknown, currency: unknown, sourceUrl: string,
    bookingUrl?: string | null, board?: string | null, refundable?: boolean | null, taxes?: boolean | null,
    conditions?: string, accuracy?: ProviderOffer['accuracy'], basis?: ProviderOffer['price']['basis'],
    latitude?: number, longitude?: number, expiresAt?: string | null, priceType?: 'retail' | 'net' | 'unknown',
}): ProviderOffer | null {
    const total = amount(data.total)
    const currency = text(data.currency)
    const validIdentity = !!data.hotelId && !!data.rateId
    if (total === null || !/^[A-Z]{3}$/.test(currency) || !validIdentity) return null
    return {id: id + ':' + data.hotelId + ':' + data.rateId, providerId: id, kind: 'hotels',
        title: data.name || id + ' · ' + data.hotelId, price: {amount: total, currency, basis: data.basis ?? 'party', type: data.priceType ?? 'unknown'},
        accuracy: data.accuracy ?? 'live-offer', sourceUrl: data.sourceUrl, bookingUrl: data.bookingUrl ?? null,
        checkedAt: deps.now().toISOString(), expiresAt: data.expiresAt ?? null, checkIn: query.checkIn, checkOut: query.checkOut,
        adults: query.adults, hotel: {id: data.hotelId, name: data.name || data.hotelId, latitude: data.latitude, longitude: data.longitude},
        includes: {checkedBags: null, taxes: data.taxes ?? null, board: data.board ?? null, refundable: data.refundable ?? null},
        conditions: data.conditions ?? 'Наличие и окончательная стоимость подтверждаются перед бронированием.', comparisonKey: null}
}

export function stayAdapter(spec: {id: string, website: string, requiredEnv: readonly string[]},
    execute: (query: ProviderQuery, deps: ProviderDeps) => Promise<ProviderOffer[]>) {
    async function search(query: ProviderQuery, deps: ProviderDeps): Promise<ProviderResult> {
        const missing = spec.requiredEnv.filter(name => !deps.env[name])
        if (missing.length) return {providerId: spec.id, status: 'requires-access', offers: [], checkedAt: null,
            sourceUrl: spec.website, description: 'Нужны серверные настройки ' + missing.join(', ') + '.'}
        const problem = hotelInput(query)
        if (problem) return {providerId: spec.id, status: 'unsupported-query', offers: [], checkedAt: null, description: problem}
        try {
            const offers = await execute(query, deps)
            const sandbox = deps.env[spec.id.toUpperCase().replaceAll('-', '_') + '_SANDBOX'] == 'true'
            const confirmed = sandbox ? offers.map(offer => ({...offer, accuracy: 'cached-indicative' as const,
                conditions: 'Тестовая среда поставщика. ' + offer.conditions})) : offers
            return {providerId: spec.id, status: sandbox ? 'sandbox' : 'live',
                environment: sandbox ? 'sandbox' : 'production', offers: confirmed, checkedAt: deps.now().toISOString(),
                sourceUrl: spec.website, description: sandbox ? 'Ответ тестовой среды поставщика.' : 'Получен ответ по выбранным датам и гостям.'}
        } catch (error) {
            if (error instanceof ProviderQueryError) return {providerId: spec.id, status: 'unsupported-query', offers: [], checkedAt: null,
                sourceUrl: spec.website, description: error.message}
            const access = error instanceof ProviderAccessError
            return {providerId: spec.id, status: access ? 'requires-access' : 'unavailable', offers: [], checkedAt: null,
                sourceUrl: spec.website, description: access ? 'Поставщик не подтвердил доступ. Проверьте активацию аккаунта и серверные ключи.' :
                    'Источник не смог подтвердить данные. Повторите поиск позже.'}
        }
    }
    return {search} satisfies ProviderAdapter
}
