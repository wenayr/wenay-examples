import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createChatService} from './service'
import {mountChatLogin} from './public-login'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('chat-data')
const service = createChatService({directory: path.join(directory, 'conversation')})
runLeaderProcess({definition: service.definition, rest: false,
    env: {...process.env, SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_PORT: process.env.SERVICE_PORT ?? '3819',
        SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        mountChatLogin({app, leader, definition: service.definition})
        app.get('/health', function health(_request, response) {response.json({ok: true, application: 'chat'})})
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
        return service.mount(leader.line.control.store)
    }
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function disconnected() {void host.close()})
}).catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
