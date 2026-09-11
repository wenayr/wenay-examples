import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createOrganizerService} from './service'
import {httpAssistantProvider} from './assistant-resource'

const service = createOrganizerService({directory: path.join(process.env.SERVICE_DATA_DIR ?? path.resolve('organizer-data'), 'chat'),
    provider: process.env.AI_TRANSCRIBE_URL ? httpAssistantProvider({url: process.env.AI_TRANSCRIBE_URL, token: process.env.AI_TRANSCRIBE_TOKEN}) : undefined})
const organizerDefinition = service.definition

runLeaderProcess({definition: organizerDefinition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3600', SERVICE_DATA_DIR: process.env.SERVICE_DATA_DIR ?? path.resolve('organizer-data')},
    mount({app, leader}) {
        app.get('/health', (_req, res) => res.json({ok: true}))
        app.get('/api/client', function descriptor(_req, res) {res.json(describeService(organizerDefinition))})
        app.use(express.static(path.resolve('organizer-public')))
        return service.mount(leader.line.control.store)
    },
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function parentGone() {
        void host.close().catch(function failed(error) {
            console.error(error)
            process.exitCode = 1
        })
    })
}).catch(function failed(error) {console.error(error)
process.exitCode = 1})
