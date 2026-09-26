import express, {type Express} from 'express'
import {createHttpFacadeServer, createHttpFacadeOpenApi} from 'wenay-common2/server'
import {inputJsonSchema, type InferInput} from 'wenay-common2/service'
import type {createArticleIndex} from './article-index'
import type {UsageGate} from './metered-execution'
import {authenticatedArgs} from './http-auth'
import {createPublishedSearch, SEARCH_INPUT} from './product-search'

export {SEARCH_INPUT} from './product-search'

type SearchHttpDeps = {
    app: Express,
    account: (token: string) => string,
    search?: ReturnType<typeof createArticleIndex>['search'],
    published?: ReturnType<typeof createPublishedSearch>['published'],
    usage?: UsageGate
}

export function createSearchProductHttp(deps: SearchHttpDeps) {
    if (!deps.published && !deps.search) throw new Error('Поиск не подключён')
    const published = deps.published ?? createPublishedSearch({search: deps.search!, usage: deps.usage}).published
    const object = {search: {published(account: string, input: InferInput<typeof SEARCH_INPUT>) {return published(account, input)}}}
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
