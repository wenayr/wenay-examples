import {createAsyncQueue} from 'wenay-common2/client'
import type {HotelReviewProperty, HotelReviews} from '../src/hotel-reviews-contract.ts'
import {validReviewProperty} from '../src/hotel-reviews-contract.ts'
import type {createExpediaReviews} from './partners/expedia-reviews.ts'
import {packageJson} from './package-http.ts'
import {hotelReviewReferences} from './partners/hotel-review-references.ts'

type tReviewProvider = Pick<ReturnType<typeof createExpediaReviews>, 'read'>
type tReviewSettings = {showReviews: boolean, reviewProperties?: HotelReviewProperty[]}
type tObservation = Awaited<ReturnType<tReviewProvider['read']>>
const endpoint = '/api/travel/hotel-reviews'
const freshMs = 30 * 60_000
const maximumAgeMs = 48 * 60 * 60_000

function result(hotelId: string, status: HotelReviews['status'], message: string, url: string | null = null): HotelReviews {
    return {
        hotelId, status, summary: null, reviews: [], externalReferences: hotelReviewReferences(hotelId), message,
        source: {provider: 'expedia-rapid', name: 'Expedia', url, retrievedAt: null,
            attribution: 'Источник отзывов: Expedia Rapid', order: 'source-recent', partial: true, stale: false},
    }
}

export function createHotelReviewsHttp(deps: {
    provider?: tReviewProvider | null
    resolveSettings: (request: Request) => Promise<tReviewSettings | null>
    now?: () => Date
}) {
    const queue = createAsyncQueue(2)
    const cache = new Map<string, {observation: tObservation, receivedAt: number}>()
    const pending = new Map<string, Promise<tObservation>>()
    const failures = new Map<string, number>()
    const now = deps.now ?? (() => new Date())

    async function observation(mapping: HotelReviewProperty) {
        const key = mapping.propertyId + ':' + mapping.sourceUrl
        const time = now().getTime()
        const previous = cache.get(key)
        if (previous && previous.receivedAt + freshMs > time) return {data: previous.observation, stale: false}
        if (previous && previous.receivedAt + maximumAgeMs <= time) cache.delete(key)
        function fallback() {
            if (previous && previous.receivedAt + maximumAgeMs > time) return {data: previous.observation, stale: true}
            return null
        }
        if ((failures.get(key) ?? 0) > time) return fallback()
        const existing = pending.get(key)
        if (!existing && pending.size >= 6) return fallback()
        const task = existing ?? queue.add(async function readSource() {
            if (!deps.provider) throw new Error('Review source unavailable')
            return deps.provider.read({propertyId: mapping.propertyId, sourceUrl: mapping.sourceUrl, signal: AbortSignal.timeout(10_000)})
        })
        pending.set(key, task)
        try {
            const data = await task
            if (data.propertyId != mapping.propertyId || data.sourceUrl != mapping.sourceUrl) throw new Error('Review property identity mismatch')
            if (cache.size >= 12 && !cache.has(key)) cache.delete(cache.keys().next().value!)
            cache.set(key, {observation: data, receivedAt: now().getTime()})
            failures.delete(key)
            return {data, stale: false}
        } catch {
            if (failures.size >= 100) failures.delete(failures.keys().next().value!)
            failures.set(key, now().getTime() + 30_000)
            return fallback()
        } finally {
            if (pending.get(key) == task) pending.delete(key)
        }
    }

    async function handle(request: Request): Promise<Response | null> {
        const url = new URL(request.url)
        if (url.pathname != endpoint) return null
        if (request.method != 'GET') return packageJson(405, {error: 'Используйте GET.'}, {Allow: 'GET'})
        const id = url.searchParams.get('hotelId') ?? ''
        if (!/^tez:[1-9]\d{0,14}$/.test(id)) return packageJson(400, {error: 'Укажите точный идентификатор отеля.'})
        try {
            request.signal.throwIfAborted()
            const settings = await deps.resolveSettings(request)
            if (settings?.showReviews == false) {
                const body = result(id, 'disabled', 'Отзывы отключены в настройках агентства.')
                body.externalReferences = []
                return packageJson(200, body)
            }
            if (!deps.provider) return packageJson(200, result(id, 'not-configured',
                'Для подлинных отзывов владелец сервиса подключает Expedia Rapid по договору. Отзывы и оценки не создаются автоматически.'))
            const mapping = settings?.reviewProperties?.find(property => property.hotelId == id && validReviewProperty(property))
            if (!mapping) return packageJson(200, result(id, 'not-mapped',
                'Администратор ещё не сопоставил этот отель с его страницей в Expedia. Чужие отзывы по похожему названию не подставляются.'))
            const checked = await observation(mapping)
            request.signal.throwIfAborted()
            if (!checked) return packageJson(200, result(id, 'unavailable', 'Источник сейчас не подтвердил отзывы. Попробуйте позже.', mapping.sourceUrl))
            const {data, stale} = checked
            const body = result(id, data.reviews.length ? 'ready' : 'empty', '', mapping.sourceUrl)
            body.reviews = data.reviews
            body.summary = data.summary
            body.source = {...body.source, attribution: 'Отзывы предоставлены Expedia', retrievedAt: data.retrievedAt, partial: data.partial, stale}
            body.message = stale ? 'Показана ранее полученная подборка: источник временно недоступен.'
                : 'Последние отзывы в порядке источника. Эта подборка может не включать все отзывы об отеле.'
            return packageJson(200, body)
        } catch {
            if (request.signal.aborted) return packageJson(499, {error: 'Запрос отменён.'})
            return packageJson(503, {error: 'Не удалось загрузить настройки отзывов.'})
        }
    }
    return {handle}
}
