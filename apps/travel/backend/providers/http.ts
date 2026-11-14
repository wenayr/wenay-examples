import type {IncomingMessage, ServerResponse} from 'node:http'
import {allowedOrigin, readJson} from '../assistant-http.ts'
import {readProviderQuery, providerParams} from './query.ts'
import type {createProviderRegistry} from './index.ts'

function json(response: ServerResponse, status: number, body: unknown) {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify(body))
}

export async function serveProviders({request, response, providers, url, today}: {
    request: IncomingMessage, response: ServerResponse, providers?: ReturnType<typeof createProviderRegistry>, url: URL, today: string
}) {
    if (!providers) return json(response, 503, {error: 'Поиск по источникам недоступен.'})
    if (url.pathname == '/api/travel/providers') {
        if (request.method != 'GET') return json(response, 405, {error: 'Используйте GET.'})
        return json(response, 200, providers.list())
    }
    if (request.method != 'GET' && request.method != 'POST') return json(response, 405, {error: 'Используйте GET или POST.'})
    if (!allowedOrigin(request)) return json(response, 403, {error: 'Источник запроса не разрешён.'})
    let input: unknown = providerParams(url.searchParams)
    if (request.method == 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return json(response, 415, {error: 'Используйте application/json.'})
        try {input = await readJson(request, 64 * 1024)} catch (error) {
            request.resume()
            return json(response, error instanceof RangeError ? 413 : 400, {error: 'Некорректное или слишком большое тело запроса.'})
        }
    }
    try {
        if (url.pathname == '/api/travel/deals' && input && typeof input == 'object') input = {...input, kind: 'deals'}
        const query = readProviderQuery(input, today)
        return json(response, 200, await providers.search(query))
    } catch (error) {
        if (error instanceof RangeError) return json(response, 400, {error: error.message})
        return json(response, 503, {error: 'Не удалось получить предложения. Повторите поиск.'})
    }
}
