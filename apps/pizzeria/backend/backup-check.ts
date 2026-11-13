import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import {createStore, syncStoreReplayBatch} from 'wenay-common2/observe'
import {createProcess, type LocalProcess} from './process-resource'
import type {serviceDefinition} from './service'
import type {ChatView} from '../organizer/chat-resource'

const repository = path.resolve(__dirname, '../../..')

function run(script: string, args: string[]) {
    return execFileSync(process.execPath, [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true, stdio: 'pipe'
    })
}

async function waitFor(label: string, predicate: () => boolean) {
    const deadline = Date.now() + 10000
    while (!predicate()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(function tick(resolve) {setTimeout(resolve, 20)})
    }
}

// A real process owns the composed archive; only its public facades create test data.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'pizzeria-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex'),
        AI_TRANSCRIBE_URL: '', AI_TRANSCRIBE_TOKEN: ''
    }
    let host: LocalProcess | undefined
    let url = ''
    const clients: ServiceClient<typeof serviceDefinition>[] = []
    const disposers: (() => Promise<void> | void)[] = []

    async function start(dataDir: string) {
        host = createProcess({script: 'main.ts', env: {...env, SERVICE_DATA_DIR: dataDir}})
        url = await host.ready
    }
    async function client(account: string) {
        const definition = await fetch(url + '/api/client', {signal: AbortSignal.timeout(5000)}).then(response => response.json())
        const session = createServiceClient<typeof serviceDefinition>({definition, url,
            auth: {credentials: {account, password: account + '-pass'}}})
        clients.push(session)
        await session.ready()
        return session
    }
    async function chat(session: ServiceClient<typeof serviceDefinition>) {
        const resource = session.resources.open('chat')
        disposers.push(resource.close)
        await waitFor('chat resource', () => !!resource.current())
        const remote = resource.current()!.remote
        const view = createStore<ChatView>({rooms: [], room: '', messages: [], older: '', typing: []})
        const sync = syncStoreReplayBatch(view, remote.view)
        disposers.push(sync)
        await sync.ready
        return {remote, view}
    }
    async function stop() {
        for (const dispose of disposers.splice(0).reverse()) await dispose()
        for (const session of clients.splice(0)) session.close()
        await host?.control.stop()
    }
    async function photo(id: string) {
        const response = await fetch(url + '/api/media/photos/' + id, {signal: AbortSignal.timeout(5000)})
        assert.equal(response.status, 200)
        return Buffer.from(await response.arrayBuffer())
    }

    try {
        await start(live)
        const alice = await client('alice')
        const owner = await client('owner')
        await Promise.all([alice.views.myOrders.ready, owner.views.work.ready])
        const orderInput = {items: ['margherita'], address: 'Улица восстановления, 1'}
        const order = await alice.commands.placeOrder('backup-order', orderInput)
        await waitFor('order and automatic task', function visible() {
            return !!alice.views.myOrders.store.state.orders[order.id] && !!owner.views.work.store.state.tasks['auto-kitchen-' + order.id]
        })
        const count = Object.keys(alice.views.myOrders.store.state.orders).length
        const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
        const upload = await fetch(url + '/api/media/photos', {
            method: 'POST', headers: {authorization: 'Bearer ' + owner.identity.token(), 'content-type': 'image/png'},
            body: new Uint8Array(photoBytes), signal: AbortSignal.timeout(5000)
        })
        assert.equal(upload.status, 200)
        const uploaded = await upload.json()
        assert(uploaded.ok)
        const photoId = uploaded.value.id as string
        assert.deepEqual(await photo(photoId), photoBytes)

        const conversation = await chat(owner)
        const roomInput = {requestId: 'backup-room', title: 'Разговор после восстановления', participants: ['chef'], task: ''}
        const room = await conversation.remote.control.create(roomInput)
        const postInput = {requestId: 'backup-message', room, text: 'Сохранить заказ и переписку', reply: ''}
        const message = await conversation.remote.control.post(postInput)
        const attachmentBytes = new Uint8Array([65, 66, 67])
        const attachment = await conversation.remote.control.upload({requestId: 'backup-file', room, name: 'fixture.txt', bytes: attachmentBytes})
        const aiInput = {requestId: 'backup-ai', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Проверить заказ; Проверить фото'}}
        const aiRun = await conversation.remote.ai.createRun(aiInput)
        const deadline = Date.now() + 10000
        let proposals = await conversation.remote.control.results(room)
        while (!proposals.length) {
            assert(Date.now() < deadline, 'Timeout: completed demo AI result')
            await new Promise(function tick(resolve) {setTimeout(resolve, 20)})
            proposals = await conversation.remote.control.results(room)
        }
        assert.equal(proposals[0].result.items.length, 2)
        await stop()

        assert.throws(() => run('backup.mjs', ['pizzeria', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['pizzeria', copy, '--i-stopped-it', '--from=' + live, '--data-version=pizzeria-5'])
        const manifest = JSON.parse(readFileSync(path.join(copy, 'manifest.json'), 'utf8'))
        const paths: string[] = manifest.files.map((file: {path: string}) => file.path)
        assert(paths.some(file => file.startsWith('photos/')), 'photo archive included')
        assert(paths.some(file => file.startsWith('chat/')), 'chat archive included')
        assert(paths.some(file => file.endsWith('runs.replay')), 'AI checkpoint included')
        assert(existsSync(path.join(copy, 'complete')))
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=pizzeria-6']), /Формат данных/)
        assert(!existsSync(restored), 'incompatible restore writes nothing')
        run('restore.mjs', [copy, restored, '--data-version=pizzeria-5'])

        const broken = path.join(directory, 'broken')
        run('backup.mjs', ['pizzeria', broken, '--i-stopped-it', '--from=' + live])
        const photoPath = paths.find(file => file.startsWith('photos/'))!
        writeFileSync(path.join(broken, 'data', photoPath), 'corrupted')
        const brokenRestore = path.join(directory, 'broken-restore')
        assert.throws(() => run('restore.mjs', [broken, brokenRestore]), /Хеш файла|Размер файла/)
        assert(!existsSync(brokenRestore), 'corrupt archive writes nothing')

        await start(restored)
        const again = await client('alice')
        const restoredOwner = await client('owner')
        await Promise.all([again.views.myOrders.ready, restoredOwner.views.work.ready])
        assert.equal(Object.keys(again.views.myOrders.store.state.orders).length, count)
        assert.equal(again.views.myOrders.store.state.orders[order.id].address, orderInput.address)
        assert(restoredOwner.views.work.store.state.tasks['auto-kitchen-' + order.id], 'automatic task restored')
        assert.equal((await again.commands.placeOrder('backup-order', orderInput)).id, order.id)
        assert.equal(Object.keys(again.views.myOrders.store.state.orders).length, count, 'order receipt prevents a duplicate')
        assert.deepEqual(await photo(photoId), photoBytes)

        const restoredChat = await chat(restoredOwner)
        assert.equal(await restoredChat.remote.control.create(roomInput), room)
        assert.equal(await restoredChat.remote.control.post(postInput), message)
        await restoredChat.remote.control.select(room, '')
        await waitFor('restored message replay', () => restoredChat.view.state.messages.some(item => item.id == message))
        assert.equal(restoredChat.view.state.messages.filter(item => item.id == message).length, 1)
        assert.deepEqual([...await restoredChat.remote.control.download(room, attachment)], [...attachmentBytes])
        assert.deepEqual(await restoredChat.remote.control.results(room), proposals)
        const repeatedRun = await restoredChat.remote.ai.createRun(aiInput)
        assert.equal(repeatedRun.id, aiRun.id)
        assert.equal(repeatedRun.state, 'completed', 'completed AI receipt restored without executing a new run')
        await assert.rejects(restoredChat.remote.ai.createRun({...aiInput, input: {room, text: 'Другой запрос'}}))
        const chef = await client('chef')
        const chefChat = await chat(chef)
        assert.deepEqual([...await chefChat.remote.control.download(room, attachment)], [...attachmentBytes], 'member access survives restore')
        await restoredChat.remote.control.membership({requestId: 'backup-revoke', room, participants: ['owner'], revision: 0})
        await assert.rejects(chefChat.remote.control.download(room, attachment), 'revoked member cannot download the restored attachment')
        console.log('PASS pizzeria cold backup: order/task/receipts, photo bytes, chat/message/attachment/ACL and completed demo AI;')
        console.log('  stop/copy/restore/restart, requestId deduplication, incompatible version and corrupt copy rejected before writing; no paid AI')
    } finally {
        await stop()
        assert.equal(path.dirname(realpathSync(directory)), temporary)
        assert(path.basename(directory).startsWith('pizzeria-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
