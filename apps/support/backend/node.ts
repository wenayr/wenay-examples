import express from 'express'
import path from 'node:path'
import {runNodeProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createSupportRuntime} from './runtime'

const service = createSupportRuntime()
runNodeProcess({definition: service.definition, mount({app}) {
    app.get('/health', function health(_req, res) {res.json({ok: true, application: 'support-node'})})
    app.get('/api/client', function descriptor(_req, res) {res.json(describeService(service.definition))})
    app.use(express.static(path.resolve('public')))
}}).then(function started(host) {process.send?.({type: 'ready', url: host.url})})
    .catch(function failed(error) {console.error(error); process.exitCode = 1})
