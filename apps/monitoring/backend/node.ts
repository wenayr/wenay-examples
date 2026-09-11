import express from 'express'
import path from 'node:path'
import {runNodeProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createMonitoringRuntime} from './runtime'
const runtime = createMonitoringRuntime()
runNodeProcess({definition: runtime.definition, mount({app}) {
    app.get('/health', function health(_request, response) {response.json({ok: true, application: 'monitoring-node'})})
    app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
    app.use(express.static(path.resolve('public')))
}}).then(function ready(host) {process.send?.({type: 'ready', url: host.url})}).catch(function failed(error) {console.error(error); process.exitCode = 1})
