const provider = 'expedia-rapid' as const
export const expediaReviewsMaxCacheAgeMs = 48 * 60 * 60 * 1000
export const expediaReviewsMaxResponseBytes = 2 * 1024 * 1024

type tRecord = Record<string, unknown>

function record(value: unknown): tRecord | null {
    return value != null && typeof value == 'object' && !Array.isArray(value) ? value as tRecord : null
}

function requiredText(value: unknown, maximum: number) {
    return typeof value == 'string' && value.trim().length > 0 && value.length <= maximum ? value : null
}

function validDate(value: unknown) {
    if (typeof value != 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
    return Number.isFinite(Date.parse(value)) ? value : null
}

function travelDate(value: unknown) {
    if (typeof value != 'string' || !/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(value)) return undefined
    if (value.length == 7) return value
    return new Date(value).toISOString().slice(0, 10) == value ? value : undefined
}

export function isExpediaReviewSourceUrl(value: string, propertyId: string) {
    try {
        const url = new URL(value)
        const validOrigin = url.protocol == 'https:' && ['expedia.com', 'www.expedia.com'].includes(url.hostname)
        const validCredentials = !url.username && !url.password && !url.port
        return validOrigin && validCredentials && url.pathname.endsWith('.h' + propertyId + '.Hotel-Information')
    } catch {
        return false
    }
}

async function hexDigest(algorithm: 'SHA-256' | 'SHA-512', text: string) {
    const bytes = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function readBoundedJson(response: Response, signal: AbortSignal) {
    const declaredLength = Number(response.headers.get('content-length'))
    if (declaredLength > expediaReviewsMaxResponseBytes) {
        await response.body?.cancel()
        throw new RangeError('Ответ отзывов Expedia Rapid превышает допустимые 2 МБ.')
    }
    if (!response.body) throw new Error('Пустой ответ отзывов Expedia Rapid.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', {fatal: true})
    const chunks: string[] = []
    let received = 0
    try {
        while (true) {
            signal.throwIfAborted()
            const {done, value} = await reader.read()
            if (done) break
            received += value.byteLength
            if (received > expediaReviewsMaxResponseBytes) {
                throw new RangeError('Ответ отзывов Expedia Rapid превышает допустимые 2 МБ.')
            }
            chunks.push(decoder.decode(value, {stream: true}))
        }
        return JSON.parse(chunks.join('') + decoder.decode()) as unknown
    } catch (error) {
        await reader.cancel().catch(() => undefined)
        throw error
    } finally {
        reader.releaseLock()
    }
}

async function parseReview(value: unknown, propertyId: string, sourceUrl: string) {
    const row = record(value)
    if (!row) return null
    const text = requiredText(row.text, 100_000)
    const author = requiredText(row.reviewer_name, 500)
    const publishedAt = validDate(row.date_submitted)
    const rating = typeof row.rating == 'string' || typeof row.rating == 'number' ? Number(row.rating) : NaN
    const validRating = Number.isFinite(rating) && rating >= 1 && rating <= 5
    if (text == null || author == null) return null
    if (publishedAt == null || !validRating) return null
    // Rapid does not supply a review ID. Its source text and identity form a stable local reference, never a guest count.
    const id = await hexDigest('SHA-256', JSON.stringify([propertyId, author, publishedAt, text]))
    const verifiedStay = typeof row.verification_source == 'string'
        && row.verification_source.toLowerCase() == 'expedia group verified review' ? true : null
    return {
        id: provider + ':' + id,
        author,
        publishedAt,
        travelDate: travelDate(row.stay_date_full) ?? travelDate(row.stay_date),
        rating,
        maxRating: 5 as const,
        title: requiredText(row.title, 1000) ?? undefined,
        text,
        sourceUrl,
        verifiedStay,
    }
}

export function createExpediaReviews(deps: {key?: string, secret?: string, fetcher?: typeof fetch, now?: () => Date}) {
    const fetcher = deps.fetcher ?? fetch
    const now = deps.now ?? (() => new Date())
    const configured = !!deps.key && !!deps.secret

    async function read(input: {propertyId: string, sourceUrl: string, signal?: AbortSignal, language?: string}) {
        if (!configured) throw new Error('Для Expedia Rapid требуется настроить ключ и секрет поставщика.')
        if (!/^[1-9]\d{0,14}$/.test(input.propertyId)) throw new RangeError('Некорректный идентификатор отеля Expedia.')
        if (!isExpediaReviewSourceUrl(input.sourceUrl, input.propertyId)) throw new RangeError('Не подтверждена страница этого отеля Expedia.')
        const language = input.language ?? 'ru-RU'
        if (!/^[a-z]{2}-[A-Z]{2}$/.test(language)) throw new RangeError('Некорректный язык отзывов.')
        const timestamp = String(Math.floor(now().getTime() / 1000))
        const signature = await hexDigest('SHA-512', deps.key! + deps.secret! + timestamp)
        const url = new URL('https://api.ean.com/v3/properties/' + input.propertyId + '/guest-reviews')
        url.searchParams.set('language', language)
        const deadline = AbortSignal.timeout(12_000)
        const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline
        const response = await fetcher(url, {
            method: 'GET', redirect: 'error', signal,
            headers: {
                Accept: 'application/json',
                Authorization: 'EAN APIKey=' + deps.key + ',Signature=' + signature + ',timestamp=' + timestamp,
                'User-Agent': 'WenayTravel/0.1',
            },
        })
        if (!response.ok) throw new Error('Expedia Rapid не подтвердил отзывы: HTTP ' + response.status)
        const payload = response.status == 204 ? {verified: {recent: []}} : await readBoundedJson(response, signal)
        const verified = record(record(payload)?.verified)
        if (!Array.isArray(verified?.recent)) throw new Error('Некорректный ответ отзывов Expedia Rapid.')
        const recent = verified.recent.slice(0, 100)
        const parsed = await Promise.all(recent.map(row => parseReview(row, input.propertyId, input.sourceUrl)))
        return {
            provider,
            propertyId: input.propertyId,
            summary: null,
            reviews: parsed.filter(review => review != null),
            sourceUrl: input.sourceUrl,
            retrievedAt: now().toISOString(),
            partial: true as const,
            order: 'source-recent' as const,
        }
    }

    return {read, source: {provider, configured, maxCacheAgeMs: expediaReviewsMaxCacheAgeMs}}
}

export type ExpediaReviews = ReturnType<typeof createExpediaReviews>
