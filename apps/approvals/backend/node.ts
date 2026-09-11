import express from 'express'
import path from 'node:path'
import {runNodeProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createApprovalRuntime} from './runtime'
const service = createApprovalRuntime()
function mount({app}: {app: express.Express}) {
    app.get('/health', function health(_request, response) {
        response.json({ok: true, application: 'approvals-node'})
    })
    app.get('/api/client', function descriptor(_request, response) {
        response.json(describeService(service.definition))
    })
    app.use(express.static(path.resolve('public')))
}

runNodeProcess({definition: service.definition, mount}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
}).catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
