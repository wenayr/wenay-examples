import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {createPizzeriaService} from './service'
import {describeService} from 'wenay-common2/service/client'
import {createDishMedia} from './dish-media'
import {randomUUID, timingSafeEqual} from 'node:crypto'
import {httpAssistantProvider} from '../organizer/assistant-resource'

const dataDir = process.env.SERVICE_DATA_DIR ?? path.resolve('data')
const service = createPizzeriaService({directory: path.join(dataDir, 'chat'),
    provider: process.env.AI_TRANSCRIBE_URL ? httpAssistantProvider({url: process.env.AI_TRANSCRIBE_URL, token: process.env.AI_TRANSCRIBE_TOKEN}) : undefined})
const serviceDefinition = service.definition

runLeaderProcess({
    definition: serviceDefinition,
    env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3500', SERVICE_DATA_DIR: dataDir},
    mount({app,leader}) {
        const closeBoard = service.mount(leader.line.control.store)
        // Only this network's controller has the private node corridor secret.
        app.post('/internal/nodes/drain', function controllerGate(req, res, next) {
            const supplied = Buffer.from((req.get('authorization') ?? '').replace(/^Bearer\s+/i, ''))
            const expected = Buffer.from(leader.secrets.nodeToken)
            if (supplied.length != expected.length || !timingSafeEqual(supplied, expected)) {res.sendStatus(403); return}
            next()
        }, express.json({limit: '4kb'}), function drainNodes(req, res) {
            const ids: unknown = req.body?.ids
            if (!Array.isArray(ids) || ids.length > 16 || ids.some(id => typeof id != 'string' || id == 'leader')) {res.sendStatus(400); return}
            for (const id of ids) leader.control.drain(id)
            res.json({ok: true})
        })
        createDishMedia({directory:path.join(dataDir,'photos'),authorize:function requireMenuEditor(token) {
            const principal = leader.access.principalOf(leader.identity.principal(token))
            if (!leader.access.rights(principal).commands.includes('setMenuItem')) throw new Error('Нет доступа к блюдам')
        }}).mount(app)
        app.get('/health', (_req, res) => res.json({ok: true}))
        app.get('/api/client', function clientDefinition(_req, res) {res.json(describeService(serviceDefinition))})
        app.use(express.static(path.resolve('public')))
        function refreshTimedTasks() {
            const state=leader.line.control.store.snapshot()
            const needed=Object.values(state.orders).some(order=>!state.organizer.tasks['auto-kitchen-'+order.id]) ||
                Object.values(state.batches).some(batch=>batch.quantity>0&&batch.expiresAt<=Date.now()&&!state.organizer.tasks['auto-expired-'+batch.id])
            if (needed) void leader.corridor.system.workRefresh('work-clock-'+randomUUID(),{}).catch(function failed(error) {console.error('Work refresh:',error.message)})
        }
        const initial=setTimeout(refreshTimedTasks,0)
        const timer=setInterval(refreshTimedTasks,30000)
        timer.unref()
        return function closeTimers() {clearTimeout(initial);clearInterval(timer);closeBoard()}
    },
}).then(function started(host) {
    process.send?.({type: 'ready', url: host.url})
    process.once('disconnect', function parentGone() {
        void host.close().catch(function failed(error) {console.error(error); process.exitCode = 1})
    })
}).catch(function failed(error) { console.error(error); process.exitCode = 1 })
