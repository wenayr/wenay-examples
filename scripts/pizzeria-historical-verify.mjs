import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const args = process.argv.slice(2)
assert.equal(args.length, 3, 'Usage: archive expected.json provenance.json (three absolute paths)')
assert(args.every(value => path.isAbsolute(value)), 'All fixture inputs must be absolute paths')
const [archive, expectedFile, provenanceFile] = args.map(value => realpathSync(value))
const expected = JSON.parse(readFileSync(expectedFile, 'utf8'))
const provenance = JSON.parse(readFileSync(provenanceFile, 'utf8'))
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const application = path.join(repository, 'apps/pizzeria')
const requireApp = createRequire(path.join(application, 'package.json'))
const {createServiceClient} = requireApp('wenay-common2/service/client')
const {createStore, syncStoreReplayBatch} = requireApp('wenay-common2/observe')
const {createProcess} = requireApp('./backend/process-resource.ts')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const historicalCommit = '234572908e2536f49192b78f9bfecbecff8d6961'
assert.equal(provenance.commit, historicalCommit)
assert.deepEqual(provenance.libraries, {common2: '2.21.1', react2: '3.5.1'})
assert.equal(provenance.schemaVersion, 5)
assert.equal(provenance.oldColdRestoreProof, 'passed')
const oldSource = file => execFileSync('git', ['show', historicalCommit + ':apps/pizzeria/' + file], {
    cwd: repository, windowsHide: true, timeout: 10000
})
const oldPackage = oldSource('package.json'), oldLock = oldSource('package-lock.json')
// A checkout may use LF or CRLF; accept only hashes derived from the genuine Git blob.
function checkoutHashes(bytes) {
    const lf = bytes.toString('utf8').replace(/\r\n/g, '\n')
    return [hash(Buffer.from(lf)), hash(Buffer.from(lf.replace(/\n/g, '\r\n')))]
}
assert(checkoutHashes(oldPackage).includes(provenance.packageSha256), 'historical package hash')
assert(checkoutHashes(oldLock).includes(provenance.lockSha256), 'historical lock hash')
const oldPkg = JSON.parse(oldPackage), oldLocked = JSON.parse(oldLock)
for (const [name, version] of [['wenay-common2', '2.21.1'], ['wenay-react2', '3.5.1']]) {
    assert.equal(oldPkg.dependencies[name], version)
    assert.equal(oldLocked.packages['node_modules/' + name].version, version)
}
const installed = name => JSON.parse(readFileSync(path.join(application, 'node_modules', name, 'package.json'), 'utf8')).version
assert.equal(installed('wenay-common2'), '3.1.1')
assert.equal(installed('wenay-react2'), '5.0.0')
const manifestFile = path.join(archive, 'manifest.json')
const manifestBytes = readFileSync(manifestFile)
assert.equal(hash(manifestBytes), provenance.manifestSha256)
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.format, 'wenay-cold-backup-1')
assert.equal(manifest.app, 'pizzeria')
assert.equal(manifest.dataVersion, 'pizzeria-5')
assert.deepEqual(manifest.libraries, provenance.libraries)
const unchanged = new Map()
function remember(file) {unchanged.set(file, hash(readFileSync(file)))}
for (const file of [manifestFile, path.join(archive, 'complete'), expectedFile, provenanceFile]) remember(file)
for (const file of manifest.files) {
    assert(typeof file.path == 'string' && file.path && !path.isAbsolute(file.path) && !file.path.includes('\\'))
    assert(!file.path.split('/').some(part => !part || part == '.' || part == '..' || part.includes(':')))
    const full = realpathSync(path.join(archive, 'data', file.path))
    assert(full.startsWith(archive + path.sep), 'archive record must stay within explicit fixture')
    const bytes = readFileSync(full)
    assert.equal(bytes.length, file.size)
    assert.equal(hash(bytes), file.sha256)
    remember(full)
}
const temporary = realpathSync(tmpdir())
const directory = mkdtempSync(path.join(temporary, 'pizzeria-historical-verify-'))
const restored = path.join(directory, 'restored')
const currentCopy = path.join(directory, 'current-copy')
const second = path.join(directory, 'second')
const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1',
    SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex'),
    AI_TRANSCRIBE_URL: '', AI_TRANSCRIBE_TOKEN: ''}
let host, url
const clients = [], disposers = []
function cold(script, argv) {
    return execFileSync(process.execPath, [path.join(repository, 'scripts', script), ...argv], {
        cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: 'pipe'
    })
}
async function waitFor(label, check) {
    const deadline = Date.now() + 15000
    while (!check()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}
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
    const session = createServiceClient({definition: descriptor, url, auth: {credentials: {account, password: account + '-pass'}}})
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
async function verify() {
    const alice = await client('alice'), owner = await client('owner')
    await Promise.all([alice.views.myOrders.ready, owner.views.work.ready])
    assert.equal(Object.keys(alice.views.myOrders.store.state.orders).length, expected.orderCount)
    assert.equal(alice.views.myOrders.store.state.orders[expected.order.id].address, expected.orderInput.address)
    assert(owner.views.work.store.state.tasks[expected.task], 'historical automatic task')
    assert.equal((await alice.commands.placeOrder(expected.orderRequestId, expected.orderInput)).id, expected.order.id)
    assert.equal(Object.keys(alice.views.myOrders.store.state.orders).length, expected.orderCount)
    const photo = await fetch(url + '/api/media/photos/' + expected.photoId, {signal: AbortSignal.timeout(5000)})
    assert.equal(photo.status, 200)
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), Buffer.from(expected.photoBase64, 'base64'))
    const conversation = await chat(owner)
    assert.equal(await conversation.remote.control.create(expected.roomInput), expected.room)
    assert.equal(await conversation.remote.control.post(expected.postInput), expected.message)
    await conversation.remote.control.select(expected.room, '')
    await waitFor('historical message replay', () => conversation.view.state.messages.some(item => item.id == expected.message))
    assert.equal(conversation.view.state.messages.filter(item => item.id == expected.message).length, 1)
    const restoredMessage = conversation.view.state.messages.find(item => item.id == expected.message)
    assert.equal(restoredMessage.conversationId, expected.room)
    assert.equal(restoredMessage.requestId, expected.postInput.requestId)
    assert.deepEqual(restoredMessage.blocks.map(({kind, version, text}) => ({kind, version, text})), [
        {kind: 'text', version: 1, text: expected.postInput.text.trim()}
    ])
    assert.deepEqual([...await conversation.remote.control.download(expected.room, expected.attachment)], expected.attachmentInput.bytes)
    assert.deepEqual(await conversation.remote.control.results(expected.room), expected.proposals)
    const run = await conversation.remote.ai.createRun(expected.aiInput)
    assert.equal(run.id, expected.runId)
    assert.equal(run.state, 'completed')
    await assert.rejects(conversation.remote.ai.createRun({...expected.aiInput, input: {room: expected.room, text: 'Changed historical request'}}))
    return conversation
}
try {
    cold('restore.mjs', [archive, restored, '--data-version=pizzeria-5'])
    await start(restored)
    await verify()
    await stop()
    cold('backup.mjs', ['pizzeria', currentCopy, '--i-stopped-it', '--from=' + restored, '--data-version=pizzeria-5'])
    const currentManifest = JSON.parse(readFileSync(path.join(currentCopy, 'manifest.json'), 'utf8'))
    assert.deepEqual(currentManifest.libraries, {common2: '3.1.1', react2: '5.0.0'})
    cold('restore.mjs', [currentCopy, second, '--data-version=pizzeria-5'])
    await start(second)
    const owner = await verify()
    const chef = await chat(await client('chef'))
    await chef.remote.control.select(expected.room, '')
    await waitFor('member restored history', () => chef.view.state.messages.some(item => item.id == expected.message))
    assert.deepEqual([...await chef.remote.control.download(expected.room, expected.attachment)], expected.attachmentInput.bytes)
    await owner.remote.control.membership({requestId: 'historical-current-revoke', room: expected.room, participants: ['owner'], revision: 0})
    await waitFor('revoked history emptied', () => chef.view.state.rooms.length == 0 && chef.view.state.messages.length == 0)
    await assert.rejects(chef.remote.control.download(expected.room, expected.attachment))
    await assert.rejects(chef.remote.control.post({...expected.postInput, requestId: 'historical-current-denied'}))
    await stop()
    console.log(JSON.stringify({status: 'current-historical-pass', at: new Date().toISOString(), oldCommit: historicalCommit,
        oldLibraries: provenance.libraries, currentLibraries: currentManifest.libraries, schema: '5 → 5',
        manifestSha256: provenance.manifestSha256, oldColdProof: 'passed', currentRestoreAndColdRestart: 'passed',
        receiptAndAttachmentRevoke: 'passed', businessSchemas1to4: 'not tested'}, null, 4))
} finally {
    try {await stop()} finally {
        assert.equal(path.dirname(realpathSync(directory)), temporary)
        assert(path.basename(directory).startsWith('pizzeria-historical-verify-'))
        rmSync(directory, {recursive: true, force: true})
        for (const [file, digest] of unchanged) assert.equal(hash(readFileSync(file)), digest, 'old fixture must remain unchanged: ' + file)
    }
}
