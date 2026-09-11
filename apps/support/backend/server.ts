import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createSupportRuntime} from './runtime'
import {createOidc} from './oidc'
import {randomUUID} from 'node:crypto'
import {createMeteredExecution, meteringTargets} from './metered-execution'
import {contentTargets} from './content-resource'
import {createSearchProductHttp} from './product-http'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('support-data')
const targets = meteringTargets(process.env.METERING_CONNECTIONS_JSON)
const usage = targets ? createMeteredExecution({targets}) : undefined
const service = createSupportRuntime({
    directory: path.join(directory, 'assistant'),
    demo: process.env.SERVICE_DEMO != '0',
    usage,
    content: {targets: contentTargets(process.env.CONTENT_CONNECTIONS_JSON)}
})
runLeaderProcess({definition: service.definition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3810', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        const oidc = createOidc({config: process.env.OIDC_ISSUER ? {
            issuer: process.env.OIDC_ISSUER, clientId: process.env.OIDC_CLIENT_ID ?? '', clientSecret: process.env.OIDC_CLIENT_SECRET,
            origin: process.env.OIDC_ORIGIN ?? process.env.SERVICE_PUBLIC_URL ?? '',
            endpointOrigins: process.env.OIDC_ENDPOINT_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
            allowLoopbackHttp: process.env.OIDC_ALLOW_LOOPBACK_HTTP == '1'
        } : undefined,
        async provision(identity) {return (await leader.corridor.system.identityProvision('oidc-' + randomUUID(), identity)).account},
        login: leader.identity.login})
        oidc.mount(app)
        app.get('/health', function health(_req, res) {
            const release = process.env.APP_RELEASE ?? 'development'
            res.json({ok: true, application: 'support', release, ai: 'test-executor'})
        })
        app.get('/api/client', function descriptor(_req, res) {res.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
        const closeService = service.mount(leader.line.control.store)
        createSearchProductHttp({app, search: service.search, usage, account: token => leader.access.principalOf(leader.identity.principal(token)).account})
        return function close() {
            oidc.close()
            closeService()
            usage?.close()
        }
    }
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function disconnected() {void host.close()})
}).catch(function failed(error) {usage?.close()
console.error(error)
process.exitCode = 1})
