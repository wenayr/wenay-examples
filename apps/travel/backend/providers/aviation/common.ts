import type {ProviderDeps, ProviderQuery, ProviderResult} from '../../../src/provider-contract.ts'

export function record(value: unknown): Record<string, unknown> {
    return typeof value == 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function list(value: unknown) {
    return Array.isArray(value) ? value.map(record) : []
}

export function many(value: unknown) {
    if (Array.isArray(value)) return value.map(record)
    return Object.keys(record(value)).length ? [record(value)] : []
}

export function text(value: unknown) { return typeof value == 'string' ? value : '' }

export function amount(value: unknown) {
    if (typeof value != 'string' && typeof value != 'number') return null
    const number = Number(value)
    return Number.isFinite(number) && number > 0 && number < 100_000_000 ? number : null
}

export function httpsUrl(value: unknown) {
    try {
        const url = new URL(text(value))
        return url.protocol == 'https:' && !url.username && !url.password ? url.href : null
    } catch { return null }
}

export function validFlightQuery(query: ProviderQuery) {
    const route = /^[A-Z]{3}$/.test(query.origin ?? '') && /^[A-Z]{3}$/.test(query.destination ?? '') && query.origin != query.destination
    const date = /^\d{4}-\d{2}-\d{2}$/.test(query.departure ?? '')
    const adults = Number.isInteger(query.adults) && query.adults > 0 && query.adults <= 9
    if (query.kind != 'flights') return false
    return route && date && adults
}

export class ProviderHttpError extends Error {
    status: number
    constructor(status: number) {
        super('Источник ответил HTTP ' + status)
        this.status = status
    }
}

export async function json(deps: ProviderDeps, url: string, init: RequestInit = {}) {
    const response = await deps.fetch(url, {...init, headers: {Accept: 'application/json', ...init.headers},
        redirect: 'error', signal: AbortSignal.timeout(12_000)})
    if (!response.ok) throw new ProviderHttpError(response.status)
    return response.json() as Promise<unknown>
}

export function failed(providerId: string, error: unknown): ProviderResult {
    const access = error instanceof ProviderHttpError && [401, 403].includes(error.status)
    const limited = error instanceof ProviderHttpError && error.status == 429
    let description = 'Источник не подтвердил ответ. Повторите поиск позже.'
    if (access) description = 'Источник не подтвердил доступ. Проверьте серверные ключи и разрешения договора.'
    if (limited) description = 'Источник ограничил частоту запросов. Повторите поиск позже.'
    return {providerId, status: access ? 'requires-access' : 'unavailable', offers: [], checkedAt: null, description}
}

export function unavailable(providerId: string, description: string, status: ProviderResult['status'] = 'unsupported-query'): ProviderResult {
    return {providerId, status, offers: [], checkedAt: null, description}
}

export function createCredentialsToken(config: {url: string, idEnv: string, secretEnv: string}) {
    let cached: {credentials: string, token: string, until: number} | null = null
    async function token(deps: ProviderDeps) {
        const id = deps.env[config.idEnv], secret = deps.env[config.secretEnv]
        if (!id || !secret) return null
        const credentials = id + '\n' + secret
        if (cached?.credentials == credentials && cached.until > deps.now().getTime()) return cached.token
        const payload = record(await json(deps, config.url, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({grant_type: 'client_credentials', client_id: id, client_secret: secret}).toString()}))
        const accessToken = text(payload.access_token)
        const seconds = Number(payload.expires_in)
        if (!accessToken || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Не получен токен источника')
        cached = {credentials, token: accessToken, until: deps.now().getTime() + Math.max(0, seconds - 30) * 1000}
        return accessToken
    }
    return {token}
}
