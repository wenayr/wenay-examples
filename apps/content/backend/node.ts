import express from 'express'
import path from 'node:path'
import {runNodeProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createContentRuntime} from './runtime'
import {publicRouter} from './public-http'

const runtime = createContentRuntime()
runNodeProcess({definition: runtime.definition, mount({app}) {
    app.get('/health', function health(_request, response) {response.json({ok: true, application: 'content-node'})})
    app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
    if (!process.env.SERVICE_UPSTREAM) throw new Error('Authority upstream required')
    app.use('/api/content/public', publicRouter({upstream: process.env.SERVICE_UPSTREAM}))
    app.use(express.static(path.resolve('public')))
}}).then(function ready(host) {process.send?.({type: 'ready', url: host.url})}).catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
