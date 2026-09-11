import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createBookingRuntime} from './runtime'

const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('booking-data')
const service = createBookingRuntime({directory: path.join(directory, 'jobs'), holdMs: process.env.BOOKING_HOLD_MS ? Number(process.env.BOOKING_HOLD_MS) : undefined})
runLeaderProcess({definition: service.definition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3814', SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1', SERVICE_DATA_DIR: directory},
    mount({app, leader}) {
        app.get('/health', function health(_request, response) {response.json({ok: true, application: 'booking', release: process.env.APP_RELEASE ?? 'development'})})
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(service.definition))})
        app.use(express.static(path.resolve('public')))
        return service.mount({store: leader.line.control.store, system: leader.corridor.system})
    }
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function disconnected() {void host.close()})
}).catch(function failed(error) {console.error(error); process.exitCode = 1})
