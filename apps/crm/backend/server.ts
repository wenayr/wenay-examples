import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createCrmRuntime} from './runtime'
import {createMeteredExecution, meteringTargets} from './metered-execution'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('crm-data')
const targets = meteringTargets(process.env.METERING_CONNECTIONS_JSON)
const usage = targets ? createMeteredExecution({targets}) : undefined
const service = createCrmRuntime({directory: path.join(directory, 'jobs'), usage})
runLeaderProcess({definition: service.definition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3813', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        app.get('/health', function health(_request, response) {response.json({
            ok: true,
            application: 'crm',
            release: process.env.APP_RELEASE ?? 'development'
        })})
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
        const close = service.mount({store: leader.line.control.store, execute: leader.corridor.system})
        return function stop() {
            close()
            usage?.close()
        }
    }
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function disconnected() {void host.close()})
}).catch(function failed(error) {usage?.close()
console.error(error)
process.exitCode = 1})
