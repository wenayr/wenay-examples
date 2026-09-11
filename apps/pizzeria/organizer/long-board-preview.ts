import express from 'express'
import path from 'node:path'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createOrganizerService} from './service'

// Disposable in-memory browser fixture; does not open a user's archive.
const service = createOrganizerService()
runLeaderProcess({definition: service.definition, env: {SERVICE_PORT: '0'},
    async mount({app, leader}) {
        const close = service.mount(leader.line.control.store)
        try {
            for (let i = 1; i <= 24; i++) await leader.corridor.execute('owner', 'workSaveTask', 'long-column-' + i,
                {id: '', revision: 0, title: 'Проверка смены ' + i, description: 'Длинная колонка: перемещение, прокрутка и отмена', assignee: 'worker', due: '', priority: 'normal', sourceId: '', checklist: []})
            app.get('/api/client', function descriptor(_req, res) {res.json(describeService(service.definition))})
            app.use(express.static(path.resolve('organizer-public')))
            return close
        } catch (error) {close(); throw error}
    },
}).catch(function failed(error) {console.error(error); process.exitCode = 1})
