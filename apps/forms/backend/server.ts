import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createFormsRuntime} from './runtime'
import {createFormsArchive} from './archive'
import {createFormsBrowserPolicy} from './browser-policy'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('forms-data')
const service = createFormsRuntime({directory: path.join(directory, 'exports')})
const archive = createFormsArchive({directory})
runLeaderProcess({definition: service.definition, durable: archive.durable,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3815', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        app.use(createFormsBrowserPolicy({ancestors: process.env.FORM_FRAME_ANCESTORS}))
        app.get('/health', function health(_request, response) {
            const release = process.env.APP_RELEASE ?? 'development'
            response.json({ok: true, application: 'forms', release})
        })
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
        const closeRuntime = service.mount({store: leader.line.control.store, corridor: leader.corridor}), closeArchive = archive.mount(leader)
        return async function close() {
            await closeRuntime()
            closeArchive()
        }
    }
}).then(function started(host) {process.send?.({type: 'ready', url: host.url})
process.once('disconnect', function disconnected() {void host.close()})})
    .catch(function failed(error) {
        console.error(error)
        process.exitCode = 1
    })
