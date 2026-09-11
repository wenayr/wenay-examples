import express from 'express'
import path from 'node:path'
import {runNodeProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createFormsRuntime} from './runtime'
import {createFormsBrowserPolicy} from './browser-policy'

const service = createFormsRuntime({directory: path.join(process.env.SERVICE_DATA_DIR ?? path.resolve('forms-node-data'), 'exports')})
runNodeProcess({definition: service.definition, mount({app}) {
    app.get('/health', function health(_request, response) {response.json({ok: true, application: 'forms-node'})})
    app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
    app.use(createFormsBrowserPolicy({ancestors: process.env.FORM_FRAME_ANCESTORS}))
    app.use(express.static(path.resolve('public')))
}}).then(function started(host) {process.send?.({type: 'ready', url: host.url})})
    .catch(function failed(error) {console.error(error); process.exitCode = 1})
