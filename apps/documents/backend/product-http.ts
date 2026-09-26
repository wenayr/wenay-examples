import express, {type Express} from 'express'
import {AsyncLocalStorage} from 'node:async_hooks'
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
    resource: ReturnType<typeof createDocumentProcessing>['productResource']
}

export function createDocumentProductHttp(deps: ProductHttpDeps) {
    const requestScope = new AsyncLocalStorage<AbortSignal>()
    type Facade = ReturnType<typeof deps.resource.open>['facade']
    async function use<T>(account: string, operation: (facade: Facade) => Promise<T> | T) {
        const signal = requestScope.getStore() ?? AbortSignal.timeout(12000)
        const connection = deps.resource.open({
            principal: {account, roles: []},
            sessionId: 'product-' + crypto.randomUUID(),
            resourceId: 'productDocuments', signal
        })
        let offAbort = () => {}
        const interrupted = new Promise<never>(function waitForAbort(_resolve, reject) {
            function aborted() {reject(signal.reason ?? new Error('Запрос прерван'))}
            signal.addEventListener('abort', aborted, {once: true})
            offAbort = () => signal.removeEventListener('abort', aborted)
            if (signal.aborted) aborted()
        })
        try {
            signal.throwIfAborted()
            return await Promise.race([operation(connection.facade), interrupted])
        } finally {
            offAbort()
            connection.close()
        }
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
            return use(account, facade => facade.control.start(input))
        },
        async status(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.status>) {
            checks.status(input)
            return use(account, facade => facade.control.status(input))
        },
        async result(account: string, input: InferInput<typeof DOCUMENT_PRODUCT_INPUTS.result>) {
            checks.result(input)
            return use(account, facade => facade.control.result(input))
        }
    }}
    const basePath = '/api/product', limits = {maxArgs: 2, maxDepth: 8, maxArrayLen: 5000, maxKeys: 100, maxStringLen: 720000}
    const http = createHttpFacadeServer({
        app: deps.app,
        object,
        method: 'post',
        basePath,
        limits,
        middleware: [express.json({limit: '750kb'}), authenticatedArgs(deps), function requestLifetime(request, response, next) {
            const controller = new AbortController()
            const timer = setTimeout(function timedOut() {controller.abort(new Error('Запрос занял больше 12 секунд'))}, 12000)
            function disconnected() {
                if (!response.writableFinished) controller.abort(new Error('Клиент отключился'))
                finished()
            }
            function finished() {
                clearTimeout(timer)
                response.removeListener('close', disconnected)
            }
            response.once('close', disconnected)
            response.once('finish', finished)
            // Request IO lifetime is local metadata; it must not pass through the public argument codec.
            requestScope.run(controller.signal, next)
        }]
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
