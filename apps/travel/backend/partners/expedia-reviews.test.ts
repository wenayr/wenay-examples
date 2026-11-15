import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {test} from 'node:test'
import {createExpediaReviews, expediaReviewsMaxCacheAgeMs, expediaReviewsMaxResponseBytes, isExpediaReviewSourceUrl} from './expedia-reviews.ts'

const propertyId = '12345'
const sourceUrl = 'https://www.expedia.com/City-Hotels-Example.h12345.Hotel-Information'
const now = () => new Date('2030-01-01T10:00:00.000Z')

// Structural fixture follows the official Rapid schema. These strings are not customer reviews or public demo content.
const review = {
    verification_source: 'Expedia Group verified review',
    title: 'Тест структуры ответа',
    date_submitted: '2029-12-20T14:00:00Z',
    rating: '2',
    reviewer_name: 'Fixture author',
    stay_date: '2029-12',
    text: 'Техническая фикстура отрицательной оценки; не отзыв гостя.',
}

test('Rapid signs only an allowlisted endpoint and preserves source identity, negative rating and source order', async () => {
    let calls = 0
    const service = createExpediaReviews({key: 'test-key', secret: 'test-secret', now, fetcher: async (input, init) => {
        calls++
        assert.equal(String(input), 'https://api.ean.com/v3/properties/12345/guest-reviews?language=ru-RU')
        assert.equal(init?.redirect, 'error')
        const timestamp = String(Math.floor(now().getTime() / 1000))
        const signature = createHash('sha512').update('test-keytest-secret' + timestamp).digest('hex')
        assert.equal(new Headers(init?.headers).get('Authorization'), 'EAN APIKey=test-key,Signature=' + signature + ',timestamp=' + timestamp)
        return Response.json({verified: {recent: [review, {...review, reviewer_name: 'Second', rating: '5', verification_source: 'unknown'}]}})
    }})
    const result = await service.read({propertyId, sourceUrl})
    assert.equal(calls, 1)
    assert.equal(result.summary, null)
    assert.equal(result.partial, true)
    assert.equal(result.order, 'source-recent')
    assert.equal(result.retrievedAt, now().toISOString())
    assert.deepEqual(result.reviews.map(item => [item.author, item.rating, item.verifiedStay]), [['Fixture author', 2, true], ['Second', 5, null]])
    assert.equal(result.reviews[0].sourceUrl, sourceUrl)
    assert.equal(result.reviews[0].text, review.text)
    assert.equal(result.reviews[0].travelDate, '2029-12')
    assert.match(result.reviews[0].id, /^expedia-rapid:[a-f0-9]{64}$/)
    assert.equal(service.source.maxCacheAgeMs, 48 * 60 * 60 * 1000)
    assert.equal(expediaReviewsMaxCacheAgeMs, service.source.maxCacheAgeMs)
})

test('Rapid rejects missing credentials, mismatched public property and URL injection before network IO', async () => {
    let calls = 0
    const fetcher = async () => {
        calls++
        return Response.json({verified: {recent: []}})
    }
    const absent = createExpediaReviews({fetcher, now})
    assert.equal(absent.source.configured, false)
    await assert.rejects(absent.read({propertyId, sourceUrl}), /требуется настроить/)
    const service = createExpediaReviews({key: 'key', secret: 'secret', fetcher, now})
    await assert.rejects(service.read({propertyId: '../12345', sourceUrl}), RangeError)
    await assert.rejects(service.read({propertyId: '12346', sourceUrl}), RangeError)
    await assert.rejects(service.read({propertyId, sourceUrl: sourceUrl.replace('expedia.com', 'expedia.com.attacker.test')}), RangeError)
    await assert.rejects(service.read({propertyId, sourceUrl, language: 'ru-RU&key=leak'}), RangeError)
    assert.equal(isExpediaReviewSourceUrl(sourceUrl.replace('https:', 'http:'), propertyId), false)
    assert.equal(isExpediaReviewSourceUrl(sourceUrl.replace('www.expedia.com', 'user@www.expedia.com'), propertyId), false)
    assert.equal(calls, 0)
})

test('Rapid bounds rows, does not turn bad payloads into empty reviews and propagates caller cancellation', async () => {
    const bounded = createExpediaReviews({key: 'key', secret: 'secret', now, fetcher: async () => {
        const recent = Array.from({length: 101}, (_, index) => ({...review, reviewer_name: 'Fixture ' + index}))
        return Response.json({verified: {recent}})
    }})
    assert.equal((await bounded.read({propertyId, sourceUrl})).reviews.length, 100)
    const invalid = createExpediaReviews({key: 'key', secret: 'secret', now, fetcher: async () => Response.json({error: 'denied'})})
    await assert.rejects(invalid.read({propertyId, sourceUrl}), /Некорректный ответ/)
    const denied = createExpediaReviews({key: 'key', secret: 'secret', now, fetcher: async () => new Response('', {status: 403})})
    await assert.rejects(denied.read({propertyId, sourceUrl}), /HTTP 403/)
    const cancelled = createExpediaReviews({key: 'key', secret: 'secret', now, fetcher: async (_input, init) => {
        init?.signal?.throwIfAborted()
        return Response.json({verified: {recent: []}})
    }})
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(cancelled.read({propertyId, sourceUrl, signal: controller.signal}), {name: 'AbortError'})
})

test('Rapid cancels oversized feeds before parsing, both for declared length and a missing or false header', async () => {
    for (const length of [String(expediaReviewsMaxResponseBytes + 1), null, '1']) {
        let cancelled = false
        let pulls = 0
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                pulls++
                controller.enqueue(new Uint8Array(expediaReviewsMaxResponseBytes / 2 + 1))
            },
            cancel() { cancelled = true },
        }, {highWaterMark: 0})
        const headers = length == null ? undefined : {'Content-Length': length}
        const service = createExpediaReviews({key: 'key', secret: 'secret', now, fetcher: async () => new Response(stream, {headers})})
        await assert.rejects(service.read({propertyId, sourceUrl}), /превышает допустимые 2 МБ/)
        assert.equal(cancelled, true)
        assert.equal(pulls, length == String(expediaReviewsMaxResponseBytes + 1) ? 0 : 2)
    }
})
