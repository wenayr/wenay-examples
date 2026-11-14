import type {IncomingMessage, ServerResponse} from 'node:http'
import type {createTravelAssistant} from './assistant.ts'

const maxBody = 16 * 1024

function failure(response: ServerResponse, mcp: boolean, status: number, message: string, code = -32600) {
    if (response.destroyed || response.writableEnded) return
    const body = mcp ? {jsonrpc: '2.0', id: null, error: {code, message}} : {error: message}
    response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
    response.end(JSON.stringify(body))
}

export function allowedOrigin(request: IncomingMessage) {
    if (!request.headers.origin) return true
    try {
        const origin = new URL(request.headers.origin)
        return ['http:', 'https:'].includes(origin.protocol) && origin.host == request.headers.host
    } catch { return false }
}

export async function readJson(request: IncomingMessage, limit = maxBody) {
    if (Number(request.headers['content-length']) > limit) throw new RangeError()
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request.iterator({destroyOnReturn: false})) {
        size += chunk.length
        if (size > limit) throw new RangeError()
        chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export async function serveAssistant({request, response, assistant, mcp}: {
    request: IncomingMessage, response: ServerResponse, assistant?: ReturnType<typeof createTravelAssistant>, mcp: boolean
}) {
    if (request.method != 'POST') {
        response.setHeader('Allow', 'POST')
        return failure(response, mcp, 405, 'Используйте POST.')
    }
    if (!allowedOrigin(request)) return failure(response, mcp, 403, 'Источник запроса не разрешён.')
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        return failure(response, mcp, 415, 'Используйте application/json.')
    }
    if (!assistant) return failure(response, mcp, 503, 'Сервис временно недоступен.', -32603)
    let body: unknown
    try { body = await readJson(request) } catch (error) {
        request.resume()
        if (error instanceof RangeError) return failure(response, mcp, 413, 'Сообщение слишком большое.')
        return failure(response, mcp, 400, 'Некорректный JSON.', -32700)
    }
    const controller = new AbortController()
    const cancel = () => controller.abort()
    response.once('close', cancel)
    try {
        if (mcp) return await assistant.mcp(request, response, body)
        const reply = await assistant.chat(body, controller.signal)
        if (response.destroyed) return
        response.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'})
        response.end(JSON.stringify(reply))
    } catch (error) {
        if (error instanceof RangeError) return failure(response, mcp, 400, error.message)
        return failure(response, mcp, 503, 'Сервис временно недоступен. Повторите запрос позже.', -32603)
    } finally {
        response.off('close', cancel)
    }
}
