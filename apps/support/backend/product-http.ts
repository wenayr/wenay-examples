import express, {type Express} from 'express'
import {createHash} from 'node:crypto'
import {createHttpFacadeServer, createHttpFacadeOpenApi} from 'wenay-common2/server'
import {buildInputValidate, inputJsonSchema, type InferInput} from 'wenay-common2/service'
import type {createArticleIndex} from './article-index'
import type {UsageGate} from './metered-execution'
import {authenticatedArgs} from './http-auth'

export const SEARCH_INPUT = {orgId: 'string', query: 'string', limit: 'number', requestId: 'string'} as const
const validate = buildInputValidate(SEARCH_INPUT)

type SearchHttpDeps = {
    app: Express,
    account: (token: string) => string,
    search: ReturnType<typeof createArticleIndex>['search'],
    usage?: UsageGate
}

export function createSearchProductHttp(deps: SearchHttpDeps) {
    const object = {search: {async published(account: string, input: InferInput<typeof SEARCH_INPUT>) {
        validate(input)
        const asked = input.query.trim() && input.query.length <= 2000
        if (!/^[\w.-]{1,100}$/.test(input.requestId) || !asked) {
            throw new Error('Укажите запрос до 2000 символов и уникальный requestId')
        }
        // The first read validates current membership before requesting any quota.
        deps.search(account, input.orgId, input.query, input.limit)
        async function execute() {return deps.search(account, input.orgId, input.query, input.limit)}
        if (!deps.usage) return execute()
        const eventId = 'public-search-' + createHash('sha256').update(JSON.stringify([account, input.requestId])).digest('hex')
        return deps.usage.run({orgId: input.orgId, eventId, metric: 'search', reference: input.requestId, units: 1, signal: AbortSignal.timeout(8000)}, execute)
    }}}
    const basePath = '/api/product', limits = {maxArgs: 2, maxDepth: 6, maxArrayLen: 100, maxKeys: 100, maxStringLen: 32000}
    const http = createHttpFacadeServer({app: deps.app, object, method: 'post', basePath, limits,
        middleware: [express.json({limit: '16kb'}), authenticatedArgs(deps)]})
    const spec = createHttpFacadeOpenApi({object, methods: ['post'], basePath, limits, bearerAuth: true,
        info: {title: 'Published knowledge search', version: '1.0.0', description: 'Only currently published sources. Authentication and organization access use the support authority.'},
        argSchemas: {'/api/product/search/published': [inputJsonSchema(SEARCH_INPUT)]}})
    deps.app.get('/api/product/openapi.json', function openApi(_request, response) {
        response.setHeader('Cache-Control', 'no-store')
        response.json(spec.document())
    })
    return {facade: object, routes: http.routes, openApi: spec.document}
}
