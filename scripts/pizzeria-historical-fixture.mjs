import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
assert.equal(args.length, 1, 'Usage: pizzeria-historical-fixture.mjs <absolute historical repository>')
assert(path.isAbsolute(args[0]), 'Historical repository must be an absolute path')
const repository = realpathSync(args[0])
const application = path.join(repository, 'apps/pizzeria')
const requireApp = createRequire(path.join(application, 'package.json'))
const {createServiceClient} = requireApp('wenay-common2/service/client')
const {createStore, syncStoreReplayBatch} = requireApp('wenay-common2/observe')
const {createProcess} = requireApp('./backend/process-resource.ts')
const historicalCommit = '234572908e2536f49192b78f9bfecbecff8d6961'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const packageBytes = readFileSync(path.join(application, 'package.json'))
const lockBytes = readFileSync(path.join(application, 'package-lock.json'))
const pkg = JSON.parse(packageBytes)
const lock = JSON.parse(lockBytes)
const installed = name => JSON.parse(readFileSync(path.join(application, 'node_modules', name, 'package.json'), 'utf8')).version
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8', windowsHide: true}).trim()
assert.equal(commit, historicalCommit)
assert.equal(pkg.dependencies['wenay-common2'], '2.21.1')
assert.equal(pkg.dependencies['wenay-react2'], '3.5.1')
assert.equal(installed('wenay-common2'), '2.21.1')
assert.equal(installed('wenay-react2'), '3.5.1')
for (const name of ['wenay-common2', 'wenay-react2']) {
    assert.equal(lock.packages['node_modules/' + name].version, pkg.dependencies[name])
}
const trackedDelta = execFileSync('git', ['diff', 'HEAD', '--', 'apps/pizzeria', 'scripts/backup.mjs', 'scripts/restore.mjs'], {
    cwd: repository, encoding: 'utf8', windowsHide: true
})
assert.equal(trackedDelta, '', 'historical production source/package/lock must remain unchanged')

async function waitFor(label, predicate) {
    const deadline = Date.now() + 15000
    while (!predicate()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

function cold(script, args) {
    return execFileSync(process.execPath, [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: 'pipe'
    })
}

const temporary = realpathSync(tmpdir())
const directory = mkdtempSync(path.join(temporary, 'pizzeria-historical-'))
const live = path.join(directory, 'live')
const archive = path.join(directory, 'archive')
const restored = path.join(directory, 'old-restored')
const env = {
    SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
    SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex'),
    AI_TRANSCRIBE_URL: '', AI_TRANSCRIBE_TOKEN: ''
}
const clients = []
const disposers = []
let host, url, successful = false

async function start(dataDir) {
    host = createProcess({script: 'main.ts', env: {...env, SERVICE_DATA_DIR: dataDir}})
    url = await host.ready
}
async function stop() {
    try {
        for (const dispose of disposers.splice(0).reverse()) await dispose()
    } finally {
        for (const client of clients.splice(0)) client.close()
        const closing = host
        host = undefined
        await closing?.control.stop()
    }
}
async function client(account) {
    const descriptor = await fetch(url + '/api/client', {signal: AbortSignal.timeout(5000)}).then(response => response.json())
    // Use the historical tested public REST login shape, then native token client.
    const response = await fetch(url + '/api/pizzeria/login', {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({args: [{account, password: account + '-pass'}]}), signal: AbortSignal.timeout(5000)
    })
    assert.equal(response.status, 200)
    const answer = await response.json()
    assert(answer.ok, 'historical login: ' + account)
    const session = createServiceClient({definition: descriptor, url, auth: {token: answer.value.token}})
    clients.push(session)
    await session.ready()
    return session
}
async function chat(session) {
    const resource = session.resources.open('chat')
    disposers.push(() => resource.close())
    await waitFor('chat resource', () => !!resource.current())
    const remote = resource.current().remote
    const view = createStore({rooms: [], room: '', messages: [], older: '', typing: []})
    const sync = syncStoreReplayBatch(view, remote.view)
    disposers.push(sync)
    await sync.ready
    return {remote, view}
}
async function photo(id) {
    const response = await fetch(url + '/api/media/photos/' + id, {signal: AbortSignal.timeout(5000)})
    assert.equal(response.status, 200)
    return Buffer.from(await response.arrayBuffer())
}

try {
    await start(live)
    const alice = await client('alice'), owner = await client('owner')
    await Promise.all([alice.views.myOrders.ready, owner.views.work.ready])
    const orderInput = {items: ['margherita'], address: 'Historical synthetic fixture, 1'}
    const order = await alice.commands.placeOrder('historical-order', orderInput)
    const task = 'auto-kitchen-' + order.id
    await waitFor('order and task', () => !!alice.views.myOrders.store.state.orders[order.id] && !!owner.views.work.store.state.tasks[task])
    const orderCount = Object.keys(alice.views.myOrders.store.state.orders).length
    const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
    const upload = await fetch(url + '/api/media/photos', {
        method: 'POST', headers: {authorization: 'Bearer ' + owner.identity.token(), 'content-type': 'image/png'},
        body: new Uint8Array(photoBytes), signal: AbortSignal.timeout(5000)
    })
    assert.equal(upload.status, 200)
    const uploaded = await upload.json()
    assert(uploaded.ok)
    const photoId = uploaded.value.id
    assert.deepEqual(await photo(photoId), photoBytes)
    const conversation = await chat(owner)
    const roomInput = {requestId: 'historical-room', title: 'Historical synthetic room', participants: ['chef'], task: ''}
    const room = await conversation.remote.control.create(roomInput)
    const postInput = {requestId: 'historical-message', room, text: 'Keep the historical order', reply: ''}
    const message = await conversation.remote.control.post(postInput)
    const attachmentBytes = new Uint8Array([65, 66, 67])
    const attachmentInput = {requestId: 'historical-file', room, name: 'fixture.txt', bytes: attachmentBytes}
    const attachment = await conversation.remote.control.upload(attachmentInput)
    const aiInput = {requestId: 'historical-ai', kind: 'demo-tasks', resourceIds: [room], input: {room, text: 'Check order; Check photo'}}
    const run = await conversation.remote.ai.createRun(aiInput)
    let proposals = []
    const deadline = Date.now() + 15000
    while (!proposals.length) {
        assert(Date.now() < deadline, 'Timeout: completed demo AI')
        proposals = await conversation.remote.control.results(room)
        if (!proposals.length) await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(proposals[0].result.items.length, 2)
    await stop()
    cold('backup.mjs', ['pizzeria', archive, '--i-stopped-it', '--from=' + live, '--data-version=pizzeria-5'])
    const manifestBytes = readFileSync(path.join(archive, 'manifest.json'))
    const manifest = JSON.parse(manifestBytes)
    assert.equal(manifest.libraries.common2, '2.21.1')
    assert.equal(manifest.libraries.react2, '3.5.1')
    for (const prefix of ['photos/', 'chat/']) assert(manifest.files.some(file => file.path.startsWith(prefix)))
    assert(manifest.files.some(file => file.path.endsWith('runs.replay')))
    cold('restore.mjs', [archive, restored, '--data-version=pizzeria-5'])
    await start(restored)
    const again = await client('alice'), restoredOwner = await client('owner')
    await Promise.all([again.views.myOrders.ready, restoredOwner.views.work.ready])
    assert.equal(Object.keys(again.views.myOrders.store.state.orders).length, orderCount)
    assert.equal(again.views.myOrders.store.state.orders[order.id].address, orderInput.address)
    assert(restoredOwner.views.work.store.state.tasks[task])
    assert.equal((await again.commands.placeOrder('historical-order', orderInput)).id, order.id)
    assert.deepEqual(await photo(photoId), photoBytes)
    const restoredChat = await chat(restoredOwner)
    assert.equal(await restoredChat.remote.control.create(roomInput), room)
    assert.equal(await restoredChat.remote.control.post(postInput), message)
    await restoredChat.remote.control.select(room, '')
    await waitFor('message replay', () => restoredChat.view.state.messages.some(item => item.id == message))
    assert.equal(restoredChat.view.state.messages.filter(item => item.id == message).length, 1)
    assert.deepEqual([...await restoredChat.remote.control.download(room, attachment)], [...attachmentBytes])
    assert.deepEqual(await restoredChat.remote.control.results(room), proposals)
    const repeated = await restoredChat.remote.ai.createRun(aiInput)
    assert.equal(repeated.id, run.id)
    assert.equal(repeated.state, 'completed')
    await assert.rejects(restoredChat.remote.ai.createRun({...aiInput, input: {room, text: 'Changed input'}}))
    const chef = await chat(await client('chef'))
    assert.deepEqual([...await chef.remote.control.download(room, attachment)], [...attachmentBytes])
    await stop()
    for (const file of manifest.files) {
        const bytes = readFileSync(path.join(archive, 'data', file.path))
        assert.equal(bytes.length, file.size)
        assert.equal(hash(bytes), file.sha256)
    }
    const expected = {order, orderInput, orderRequestId: 'historical-order', orderCount, task, photoId,
        photoBase64: photoBytes.toString('base64'), room, roomInput, message, postInput, attachment,
        attachmentInput: {...attachmentInput, bytes: [...attachmentBytes]}, aiInput, runId: run.id, proposals}
    const provenance = {createdAt: new Date().toISOString(), commit, node: process.version,
        libraries: {common2: installed('wenay-common2'), react2: installed('wenay-react2')},
        packageSha256: hash(packageBytes), lockSha256: hash(lockBytes), manifestSha256: hash(manifestBytes),
        schemaVersion: 5, oldColdRestoreProof: 'passed', currentRestoreProof: 'pending'}
    writeFileSync(path.join(directory, 'expected.json'), JSON.stringify(expected, null, 4) + '\n')
    writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify(provenance, null, 4) + '\n')
    successful = true
    console.log(JSON.stringify({status: 'old-fixture-pass', directory, archive, provenance}, null, 4))
} finally {
    await stop()
    assert.equal(path.dirname(realpathSync(directory)), temporary)
    assert(path.basename(directory).startsWith('pizzeria-historical-'))
    if (successful) {
        for (const own of [live, restored]) rmSync(own, {recursive: true, force: true})
    } else rmSync(directory, {recursive: true, force: true})
}
