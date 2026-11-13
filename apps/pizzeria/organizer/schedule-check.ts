import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createProcess, type LocalProcess} from '../backend/process-resource'
import {serviceDefinition} from '../backend/service'
import {organizerDefinition} from './service'

async function waitFor(label: string, predicate: () => boolean) {
    const deadline = Date.now() + 10000
    while (!predicate()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(function tick(resolve) {setTimeout(resolve, 20)})
    }
}

export async function checkTaskSchedules() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'organizer-schedule-'))
    const env = {
        SERVICE_DATA_DIR: directory, SERVICE_HOST: '127.0.0.1', SERVICE_PORT: '0',
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex'),
        AI_TRANSCRIBE_URL: '', AI_TRANSCRIBE_TOKEN: ''
    }
    const clients: ServiceClient<typeof organizerDefinition>[] = []
    let host: LocalProcess | undefined
    let url = ''
    async function start() {
        host = createProcess({script: '../organizer/server.ts', env})
        url = await host.ready
    }
    async function client(account: string) {
        const session = createServiceClient<typeof organizerDefinition>({definition: describeService(organizerDefinition), url,
            auth: {credentials: {account, password: account + '-pass'}}})
        clients.push(session)
        await session.ready()
        await session.views.work.ready
        return session
    }
    async function stop() {
        for (const session of clients.splice(0)) session.close()
        await host?.control.stop()
    }
    const draft = {id: '', revision: 0, title: 'Проверить смену', description: 'Ручная работа', assignee: 'worker',
        due: '2026-10-05', priority: 'normal' as const, sourceId: '', checklist: [{title: 'Проверка', done: false}]}
    const interval = {date: '2026-09-28', startMinute: 540, durationMinutes: 90}
    try {
        await start()
        const manager = await client('manager')
        const worker = await client('worker')
        const owner = await client('owner')
        const created = await manager.commands.workSaveTask('schedule-create', draft)
        const input = {id: created.id, revision: created.revision, assignee: 'worker', ...interval}
        const taskOf = () => manager.views.work.store.snapshot().tasks[created.id]
        await waitFor('created task', () => !!taskOf())
        const before = taskOf()
        const columns = manager.views.work.store.snapshot().columns
        await assert.rejects(owner.commands.workScheduleTask('schedule-missing-staff', {...input, assignee: 'missing'}), /сотрудником/)
        await assert.rejects(manager.commands.workScheduleTask('schedule-empty-staff', {...input, assignee: ''}), /нужен сотрудник/)
        await assert.rejects(worker.commands.workScheduleTask('schedule-foreign-assignment', {...input, assignee: 'manager'}), /менеджер/)
        const invalid = [
            {date: '2026-02-30'}, {date: '28.09.2026'}, {startMinute: -15}, {startMinute: 1440},
            {startMinute: 540.5}, {startMinute: 541}, {durationMinutes: 0}, {durationMinutes: 14},
            {durationMinutes: 30.5}, {durationMinutes: 721}, {startMinute: 1425, durationMinutes: 30}
        ]
        for (const [index, value] of invalid.entries()) {
            await assert.rejects(worker.commands.workScheduleTask('schedule-invalid-' + index, {...input, ...value}), /дату|Интервал/)
        }
        assert.deepEqual(taskOf(), before, 'invalid commands leave the whole task unchanged')
        const scheduled = await worker.commands.workScheduleTask('schedule-once', input)
        assert.deepEqual(await worker.commands.workScheduleTask('schedule-once', input), scheduled)
        await waitFor('interval replay', () => taskOf()?.revision == scheduled.revision)
        assert.deepEqual(taskOf().schedule, interval)
        assert.deepEqual({...taskOf(), revision: before.revision, schedule: undefined}, {...before, schedule: undefined})
        assert.deepEqual(manager.views.work.store.snapshot().columns, columns, 'scheduling does not reorder columns')
        await assert.rejects(manager.commands.workScheduleTask('schedule-stale', {...input, startMinute: 600}), /уже изменена/)
        const edited = await manager.commands.workSaveTask('schedule-edit-title', {
            ...draft, id: created.id, revision: scheduled.revision, title: 'Новая формулировка'
        })
        await waitFor('edit replay', () => taskOf()?.revision == edited.revision)
        assert.deepEqual(taskOf().schedule, interval, 'ordinary editor preserves the planned interval')
        await assert.rejects(manager.commands.workSaveTask('schedule-unassign-without-clear', {
            ...draft, id: created.id, revision: edited.revision, assignee: ''
        }), /Сначала снимите задачу с графика/)
        assert.equal(taskOf().revision, edited.revision)
        assert.deepEqual(taskOf().schedule, interval)

        await owner.commands.workSavePerson('schedule-person', {
            account: 'nina', name: 'Нина', position: '', note: '', roles: ['member'], password: 'nina-pass'
        })
        const nina = await client('nina')
        await assert.rejects(nina.commands.workScheduleTask('schedule-foreign-task', {
            ...input, revision: edited.revision, assignee: 'nina'
        }), /доступа/)
        const assigned = await manager.commands.workScheduleTask('schedule-reassign', {
            ...input, revision: edited.revision, assignee: 'nina', date: '2026-09-29', startMinute: 1425, durationMinutes: 15
        })
        await waitFor('new assignee replay', () => nina.views.work.store.state.tasks[created.id]?.revision == assigned.revision)
        assert.equal(nina.views.work.store.state.tasks[created.id].due, draft.due)
        await assert.rejects(worker.commands.workScheduleTask('schedule-old-assignee', {...input, revision: assigned.revision}), /доступа/)
        const overlap = await manager.commands.workSaveTask('schedule-overlap-create', {...draft, title: 'Другая работа', assignee: 'nina'})
        await manager.commands.workScheduleTask('schedule-overlap-allowed', {
            id: overlap.id, revision: overlap.revision, assignee: 'nina', date: '2026-09-29', startMinute: 1425, durationMinutes: 15
        })
        const cleared = await nina.commands.workScheduleTask('schedule-clear', {
            id: created.id, revision: assigned.revision, assignee: 'nina', date: '', startMinute: 0, durationMinutes: 15
        })
        await waitFor('clear replay', () => taskOf()?.revision == cleared.revision)
        assert.equal(taskOf().schedule, undefined)
        assert.equal(taskOf().assignee, 'nina')
        const finalInput = {...input, revision: cleared.revision, assignee: 'nina', date: '2026-09-30'}
        const final = await manager.commands.workScheduleTask('schedule-durable', finalInput)
        await stop()
        await start()
        const restored = await client('manager')
        assert.deepEqual(restored.views.work.store.state.tasks[created.id].schedule, {...interval, date: '2026-09-30'})
        assert.equal(restored.views.work.store.state.tasks[created.id].assignee, 'nina')
        assert.equal(restored.views.work.store.state.tasks[created.id].due, draft.due)
        assert.deepEqual(await restored.commands.workScheduleTask('schedule-durable', finalInput), final, 'receipt survives authority restart')
        assert.equal(restored.views.work.store.state.tasks[created.id].revision, final.revision, 'restart retry does not apply twice')
        const done = await restored.commands.workCheckTask('schedule-check', {id: created.id, revision: final.revision, index: 0, done: true})
        const completed = await restored.commands.workMoveTask('schedule-done', {id: created.id, revision: done.revision, status: 'done', beforeId: ''})
        await assert.rejects(restored.commands.workScheduleTask('schedule-completed', {...finalInput, revision: completed.revision}), /Верните/)
        const unassigned = await restored.commands.workScheduleTask('schedule-manager-clear', {
            id: overlap.id, revision: 2, assignee: '', date: '', startMinute: 0, durationMinutes: 15
        })
        await waitFor('unassigned replay', () => restored.views.work.store.state.tasks[overlap.id]?.revision == unassigned.revision)
        assert.equal(restored.views.work.store.state.tasks[overlap.id].assignee, '')
        assert.equal(restored.views.work.store.state.tasks[overlap.id].schedule, undefined)
    } finally {
        await stop()
        assert.equal(path.dirname(realpathSync(directory)), temporary)
        assert(path.basename(directory).startsWith('organizer-schedule-'))
        rmSync(directory, {recursive: true, force: true})
    }
    const leader = createServiceLeader({definition: serviceDefinition, selfUrl: () => 'http://localhost'})
    try {
        const order = await leader.corridor.execute('alice', 'placeOrder', 'schedule-auto-order', {items: ['margherita'], address: 'Тестовый адрес'})
        const automatic = leader.line.control.store.state.organizer.tasks['auto-kitchen-' + order.id]
        const input = {id: automatic.id, revision: automatic.revision, assignee: 'chef', ...interval}
        await assert.rejects(leader.corridor.execute('owner', 'workScheduleTask', 'schedule-auto', input), /Автоматическая/)
        await assert.rejects(leader.corridor.execute('alice', 'workScheduleTask', 'schedule-customer', input), /forbidden/)
        const created = await leader.corridor.execute('owner', 'workSaveTask', 'schedule-role-create', {...draft, assignee: 'chef'})
        await leader.corridor.execute('owner', 'setRoles', 'schedule-role-revoke', {account: 'chef', roles: ['customer']})
        await assert.rejects(leader.corridor.execute('owner', 'workScheduleTask', 'schedule-role-changed', {
            id: created.id, revision: created.revision, assignee: 'chef', ...interval
        }), /сотрудником/)
        await assert.rejects(leader.corridor.execute('chef', 'workScheduleTask', 'schedule-role-forbidden', {
            id: created.id, revision: created.revision, assignee: 'chef', ...interval
        }), /forbidden/)
    } finally {leader.control.close()}
    console.log('PASS task schedule: public RPC/replay, ACL/current roles, valid intervals, atomic assignment, stale revision,')
    console.log('  preserved due/checklist/status/order, ordinary edit, clear, overlap allowed, durable restart and idempotent receipt; automatic/done denied')
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    checkTaskSchedules().catch(function failed(error) {
        console.error(error)
        process.exitCode = 1
    })
}
