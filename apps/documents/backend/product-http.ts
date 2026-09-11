import express, {type Express} from 'express'
import {createHttpFacadeServer, createHttpFacadeOpenApi} from 'wenay-common2/server'
import {buildInputValidate, inputJsonSchema, type InferInput} from 'wenay-common2/service'
import type {createDocumentProcessing} from './processing-resource'
import {authenticatedArgs} from './http-auth'

const reference = {orgId: 'string', id: 'string'} as const
export const DOCUMENT_PRODUCT_INPUTS = {
    upload: {orgId: 'string', name: 'string', base64: 'string'},
    start: {...reference, revision: 'number', processor: {enum: ['node', 'python', 'model']}, requestId: 'string'},
    status: reference,
    result: {...reference, revision: 'number'}
} as const
const checks = {
    upload: buildInputValidate(DOCUMENT_PRODUCT_INPUTS.upload),
    start: buildInputValidate(DOCUMENT_PRODUCT_INPUTS.start),
    status: buildInputValidate(DOCUMENT_PRODUCT_INPUTS.status),
    result: buildInputValidate(DOCUMENT_PRODUCT_INPUTS.result)
}

type ProductHttpDeps = {
    app: Express,
    account: (token: string) => string,
    resource: ReturnType<typeof createDocumentProcessing>['resource']
}

export function createDocumentProductHttp(deps: ProductHttpDeps) {
    type Facade = ReturnType<typeof deps.resource.open>['facade']
    async function use<T>(account: string, operation: (facade: Facade) => Promise<T> | T) {
        const connection = deps.resource.open({
            principal: {account, roles: []},
            sessionId: 'product-' + crypto.randomUUID(),
            resourceId: 'processor',
            signal: AbortSignal.timeout(12000)
        })
        try {return await operation(connection.facade)} finally {connection.close()}
    }
    const object = {documents: {
        async upload(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.upload>) {
            checks.upload(input)
            if (!input.base64 || input.base64.length > 699052 || input.base64.length % 4) throw new Error('Нужен Base64 файл не больше 512 КиБ')
            const bytes = Buffer.from(input.base64, 'base64')
            if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') != input.base64) throw new Error('Некорректный Base64 файл')
            return use(account, facade => facade.control.upload({orgId: input.orgId, name: input.name, bytes}))
        },
        async start(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.start>) {
            checks.start(input)
            if (!/^[\w.-]{1,100}$/.test(input.requestId)) throw new Error('Укажите устойчивый requestId')
            return use(account, function start(facade) {
                const run = facade.ai.createRun({
                    requestId: input.requestId,
                    kind: 'extract',
                    resourceIds: [input.id],
                    input: {
                        orgId: input.orgId,
                        documentId: input.id,
                        revision: input.revision,
                        processor: input.processor
                    }
                })
                return {runId: run.id, documentId: input.id, state: run.state}
            })
        },
        async status(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.status>) {
            checks.status(input)
            return use(account, facade => facade.control.status(input))
        },
        async result(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.result>) {
            checks.result(input)
            return use(account, async function result(facade) {
                const value = await facade.control.detail(input)
                return {
                    id: value.id,
                    revision: value.revision,
                    sourceVersion: value.sourceVersion,
                    status: value.status,
                    table: value.table,
                    provenance: value.provenance
                }
            })
        }
    }}
    const basePath = '/api/product', limits = {maxArgs: 2, maxDepth: 8, maxArrayLen: 5000, maxKeys: 100, maxStringLen: 720000}
    const http = createHttpFacadeServer({
        app: deps.app,
        object,
        method: 'post',
        basePath,
        limits,
        middleware: [express.json({limit: '750kb'}), authenticatedArgs(deps)]
    })
    const spec = createHttpFacadeOpenApi({object, methods: ['post'], basePath, limits, bearerAuth: true,
        info: {title: 'Document extraction', version: '1.0.0', description: 'Upload and process your authorized documents; review and administration are separate service roles.'},
        argSchemas: Object.fromEntries(Object.entries(DOCUMENT_PRODUCT_INPUTS).map(function route([method, input]) {
            return [basePath + '/documents/' + method, [inputJsonSchema(input)]]
        }))
    })
    deps.app.get(basePath + '/openapi.json', function openApi(_request, response) {
        response.setHeader('Cache-Control', 'no-store')
        response.json(spec.document())
    })
    return {facade: object, routes: http.routes, openApi: spec.document}
}
