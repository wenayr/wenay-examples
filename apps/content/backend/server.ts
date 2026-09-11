import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createContentRuntime} from './runtime'
import {publicRouter} from './public-http'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('content-data')
const runtime = createContentRuntime({directory: path.join(directory, 'resources')})
runLeaderProcess({definition: runtime.definition, env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3817', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        app.get('/health', function health(_request, response) {response.json({ok: true, application: 'content', release: process.env.APP_RELEASE ?? 'development'})})
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
        app.use('/api/content/public', publicRouter({runtime})); app.use(express.static(path.resolve('public')))
        return runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
    }}).then(function ready(host) {process.send?.({type: 'ready', url: host.url}); process.once('disconnect', function disconnected() {void host.close()})})
    .catch(function failed(error) {console.error(error); process.exitCode = 1})
