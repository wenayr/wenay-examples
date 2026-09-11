import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createMeteringRuntime} from './runtime'
import {createHttpTestProvider} from './webhook-resource'
import {mountProviderEvents} from './provider-http'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('metering-data')
const providerUrl = process.env.METERING_PROVIDER_URL
const providerSecret = process.env.METERING_PROVIDER_SECRET
let provider = undefined
if (providerUrl && providerSecret) {
    provider = createHttpTestProvider({url: providerUrl, secret: providerSecret})
}
const origins = (process.env.METERING_WEBHOOK_ORIGINS ?? '').split(',')
const allowedOrigins = origins.map(value => value.trim()).filter(Boolean)
const service = createMeteringRuntime({provider, allowedOrigins})
runLeaderProcess({definition: service.definition,
    env: {
        ...process.env,
        SERVICE_PORT: process.env.SERVICE_PORT ?? '3812',
        SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1',
        SERVICE_DATA_DIR: directory
    },
    mount({app, leader}) {
        app.get('/health', function health(_request, response) {
            response.json({
                ok: true,
                application: 'metering',
                billing: 'test-units-only',
                release: process.env.APP_RELEASE ?? 'development'
            })
        })
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        mountProviderEvents({app, receive: service.provider.receive})
        app.use(express.static(path.resolve('public')))
        return service.mount({store: leader.line.control.store, system: leader.corridor.system})
    }
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function disconnected() {void host.close()})
}).catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
