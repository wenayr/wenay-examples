import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createApprovalRuntime} from './runtime'
const service = createApprovalRuntime()
runLeaderProcess({definition: service.definition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3818', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: process.env.SERVICE_DATA_DIR ?? path.resolve('approvals-data')},
    mount({app}) {
        app.get('/health', function health(_request, response) {response.json({ok: true, application: 'approvals', release: process.env.APP_RELEASE ?? 'development'})})
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
    }
}).then(function started(host) {process.send?.({type: 'ready', url: host.url}); process.once('disconnect', function disconnected() {void host.close()})})
    .catch(function failed(error) {console.error(error); process.exitCode = 1})
