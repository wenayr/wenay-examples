import express from 'express'
import type {createContentRuntime} from './runtime'

// Anonymous reads are HTTP projections of the same published-only authority facade.
export function publicRouter(deps: {runtime?: ReturnType<typeof createContentRuntime>, upstream?: string}) {
    const router = express.Router()
    router.use(function headers(_request, response, next) {response.set({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}); next()})
    if (deps.upstream) {
        const upstream = new URL(deps.upstream)
        if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password) throw new Error('Invalid authority origin')
        router.use(async function authorityRead(request, response) {
            if (request.method != 'GET') {response.sendStatus(405); return}
            try {
                const url = new URL('/api/content/public' + request.path, upstream)
                const result = await fetch(url, {signal: AbortSignal.timeout(3000), redirect: 'error'})
                response.status(result.status).type(result.headers.get('content-type') ?? 'application/json').send(Buffer.from(await result.arrayBuffer()))
            } catch {response.status(503).json({error: 'Публикации временно недоступны'})}
        })
        return router
    }
    const runtime = deps.runtime!
    router.get('/:orgId/images/:id', async function image(request, response) {
        try {const result = await runtime.publicImage(request.params.orgId, request.params.id); response.type(result.mime).send(Buffer.from(result.bytes))}
        catch {response.status(404).json({error: 'Изображение недоступно'})}
    })
    router.get('/:orgId', function list(request, response) {try {response.json({pages: runtime.publicList(request.params.orgId)})} catch {response.status(404).json({error: 'Публикации недоступны'})}})
    router.get('/:orgId/:slug', function read(request, response) {try {response.json(runtime.publicRead(request.params))} catch {response.status(404).json({error: 'Публикация недоступна'})}})
    return router
}
