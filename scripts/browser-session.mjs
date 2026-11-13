import {mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'
import {APPS} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.argv[2]
const app = requested == 'organizer' ? 'pizzeria' : requested
if (!APPS.includes(app) || app == 'catalog') throw new Error('Укажите приложение каталога или organizer')

const root = path.join(repository, 'apps', app)
const load = createRequire(path.join(root, 'package.json'))
const {createProcessResource} = load('wenay-common2/server/process')
const {createServiceClient} = load('wenay-common2/service/client')
const temporary = await realpath(tmpdir())
const directory = await mkdtemp(path.join(temporary, 'wenay-browser-'))
const seedBookingRequested = process.argv.includes('--seed') && app == 'booking'
let script = 'backend/server.ts'
if (requested == 'organizer') script = 'organizer/server.ts'
else if (app == 'pizzeria') script = 'backend/main.ts'

// Приёмка открывает настоящий entrypoint, но никогда не пользовательский архив.
const host = createProcessResource({
    command: process.execPath,
    args: ['--import', 'tsx', script],
    cwd: root,
    ipc: true,
    env: {...process.env, SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        ...(seedBookingRequested ? {BOOKING_HOLD_MS: '900000'} : {}),
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')},
    startTimeoutMs: 20000,
    stopTimeoutMs: 5000,
    tailChars: 2000,
    ready(fact) {
        if (fact.type != 'message') return
        const value = fact.value
        if (value?.type == 'ready' && typeof value.url == 'string') return value.url
    },
    shutdown(child) {
        if (child.connected) child.send('shutdown', function sent(error) {if (error) child.kill('SIGTERM')})
        else child.kill('SIGTERM')
    }
})

let closing
function close() {
    closing ??= stop()
    return closing
}
async function stop() {
    await host.close()
    if (path.dirname(path.resolve(directory)) != temporary) throw new Error('Недопустимый каталог приёмки')
    await rm(directory, {recursive: true, force: true})
    process.stdin.pause()
}

process.once('SIGINT', close)
process.once('SIGTERM', close)
process.stdin.resume()
let inputLine = ''
process.stdin.on('data', function input(value) {
    inputLine += value.toString()
    if (!/[\r\n]/.test(inputLine)) return
    const lines = inputLine.split(/[\r\n]+/)
    inputLine = lines.pop() ?? ''
    if (lines.some(line => line.trim() == 'stop')) void close()
})
process.stdin.once('end', close)
try {
    const url = await host.ready
    if (process.argv.includes('--seed') && requested == 'organizer') await seedOrganizer(url)
    if (seedBookingRequested) await seedBooking(url)
    console.log('BROWSER_SESSION=' + url)
    console.log('BROWSER_DATA=' + directory)
    console.log('Введите stop для остановки и удаления только данных этой приёмки.')
    await host.done
} finally {
    await close()
    process.stdin.pause()
}

async function seedOrganizer(url) {
    const definition = await fetch(url + '/api/client').then(response => response.json())
    const client = createServiceClient({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
    try {
        await client.ready()
        const date = new Date().toLocaleDateString('sv-SE')
        const examples = [
            {title: 'Подготовка к смене', assignee: 'worker', startMinute: 540, durationMinutes: 120},
            {title: 'Приёмка поставки', assignee: 'manager', startMinute: 660, durationMinutes: 60},
            {title: 'Проверка печи', assignee: 'worker', startMinute: 840, durationMinutes: 90},
            {title: 'Планирование недели', assignee: 'owner', startMinute: 600, durationMinutes: 60}
        ]
        for (const [index, example] of examples.entries()) {
            const created = await client.commands.workSaveTask('browser-task-' + index, {
                id: '', revision: 0, title: example.title, assignee: example.assignee,
                description: 'Демонстрационные данные отдельного браузерного стенда', due: date,
                priority: 'normal', sourceId: '', checklist: []
            })
            await client.commands.workScheduleTask('browser-plan-' + index, {
                ...created, assignee: example.assignee, date,
                startMinute: example.startMinute, durationMinutes: example.durationMinutes
            })
        }
    } finally {
        client.close()
    }
}

async function seedBooking(url) {
    const {Temporal} = load('@js-temporal/polyfill')
    const zone = 'Europe/Moscow'
    const date = Temporal.Now.zonedDateTimeISO(zone).toPlainDate().add({days: 1})
    const orgId = 'northstar'
    const definition = await fetch(url + '/api/client').then(response => response.json())
    const client = createServiceClient({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
    try {
        await client.ready()
        await client.views.workspace.ready
        const studio = client.views.workspace.store.state.resources.find(resource => resource.id == 'studio')
        if (!studio) throw new Error('Начальный ресурс booking studio не найден')
        const weekly = Array.from({length: 7}, (_, index) => ({day: index + 1, start: '09:00', end: '18:00'}))
        const primary = await client.commands.resourceSave('browser-booking-resource-primary', {
            ...studio, name: 'Студия · Анна', zone, capacity: 2, weekly, exceptions: []
        })
        const secondary = await client.commands.resourceSave('browser-booking-resource-secondary', {
            orgId, id: '', revision: 0, name: 'Кабинет · Алексей', staff: 'owner', zone, capacity: 2, weekly, exceptions: []
        })
        const compatible = await client.commands.serviceSave('browser-booking-service-compatible', {
            orgId, id: '', revision: 0, resourceId: secondary.id, name: 'Консультация · Алексей',
            description: 'Совместима с консультацией Анны: 45 минут без депозита',
            duration: 45, before: 0, after: 15, capacity: 1, depositUnits: 0, active: true
        })
        const incompatible = await client.commands.serviceSave('browser-booking-service-incompatible', {
            orgId, id: '', revision: 0, resourceId: secondary.id, name: 'Расширенная встреча · 90 минут',
            description: 'Другие условия: 90 минут и тестовый депозит 25 единиц',
            duration: 90, before: 0, after: 15, capacity: 1, depositUnits: 25, active: true
        })
        function instant(clock) {
            return date.toZonedDateTime({timeZone: zone, plainTime: Temporal.PlainTime.from(clock)}).epochMilliseconds
        }
        async function hold(index, serviceId, clock, customer, note) {
            return client.commands.bookingHold('browser-booking-hold-' + index, {
                orgId, key: 'browser-booking-hold-' + index, serviceId, start: instant(clock),
                partySize: 1, customer, note, reminder: false
            })
        }
        const examples = [
            {serviceId: 'consultation', clock: '10:00', customer: 'customer', note: 'Первая встреча · общая вместимость 2'},
            {serviceId: 'consultation', clock: '10:15', customer: 'customer2', note: 'Пересечение разрешено: второй участник'},
            {serviceId: compatible.id, clock: '11:00', customer: 'customer', note: 'Можно перенести к Анне с теми же условиями'}
        ]
        for (const [index, example] of examples.entries()) {
            const held = await hold(index, example.serviceId, example.clock, example.customer, example.note)
            await client.commands.bookingConfirm('browser-booking-confirm-' + index, {
                orgId, id: held.id, revision: held.revision, key: 'browser-booking-confirm-' + index
            })
        }
        const cancelled = await hold('cancelled', 'consultation', '13:00', 'customer2', 'Отменённая запись: место снова свободно')
        await client.commands.bookingCancel('browser-booking-cancel', {
            orgId, id: cancelled.id, revision: cancelled.revision, key: 'browser-booking-cancel'
        })
        await hold('pending', incompatible.id, '15:00', 'customer2', 'Ожидает тестового депозита; удержание до 15 минут')
        console.log('BROWSER_BOOKING_DATE=' + date.toString())
        console.log('BROWSER_BOOKING_ZONE=' + zone)
        console.log('BROWSER_BOOKING_RESOURCES=' + primary.id + ',' + secondary.id)
    } finally {
        client.close()
    }
}
