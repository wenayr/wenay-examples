import express from 'express'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createMonitoringRuntime} from './runtime'
import {probeTargets} from './http-probe'
import {createEmbeddedProbeWorker} from './probe-worker'
const directory = process.env.SERVICE_DATA_DIR ?? path.resolve('monitoring-data')
const targets = probeTargets(process.env.MONITOR_TARGETS_JSON)
const minIntervalMs = Number(process.env.MONITOR_MIN_INTERVAL_MS ?? 15000)
if (!Number.isInteger(minIntervalMs) || minIntervalMs < 1000 || minIntervalMs > 86400000) throw new Error('MONITOR_MIN_INTERVAL_MS must be 1000–86400000')
const runtime = createMonitoringRuntime({presets: targets.map(({id, name}) => ({id, name})), minIntervalMs, directory: path.join(directory, 'assistant')})
let worker: ReturnType<typeof createEmbeddedProbeWorker> | undefined
runLeaderProcess({
    definition: runtime.definition,
    env: {
        ...process.env,
        SERVICE_PORT: process.env.SERVICE_PORT ?? '3816',
        SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1',
        SERVICE_DATA_DIR: directory
    },
    async mount({app, leader}) {
        await leader.corridor.system.configurePresets(randomUUID(), {presets: targets.map(({id, name}) => ({id, name}))})
        app.get('/health', function health(_request, response) {
            const release = process.env.APP_RELEASE ?? 'development'
            response.json({ok: true, application: 'monitoring', release})
        })
        app.get('/api/client', function descriptor(_request, response) {response.json(describeService(runtime.definition))})
        app.use(express.static(path.resolve('public')))
        const close = runtime.mount(leader.line.control.store)
        return async function stop() {
            await worker?.close()
            close()
        }
    }}).then(async function ready(host) {
        try {
            if (process.env.MONITOR_EMBEDDED_PROBE != '0') {
                worker = createEmbeddedProbeWorker({
                    leader: host.leader,
                    account: process.env.PROBE_ACCOUNT ?? 'probe-a',
                    password: process.env.PROBE_PASSWORD ?? 'probe-a-pass',
                    targets
                })
            }
        } catch (error) {await host.close()
        throw error}
        process.send?.({type: 'ready', url: host.url})
        process.once('disconnect', () => void host.close())
    }).catch(function failed(error) {console.error(error)
    process.exitCode = 1})
