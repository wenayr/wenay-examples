const assert = require('node:assert/strict')
const fs = require('node:fs')
const io = require('node:fs/promises')
const path = require('node:path')
const {tmpdir} = require('node:os')
const {app, BrowserWindow, session, protocol} = require('electron')
const {createEndpointSettings} = require('./settings.cjs')
const {createSetupWindow} = require('./setup-window.cjs')
const {createRemoteWindow} = require('./remote-window.cjs')
const {loadWindow} = require('./load-window.cjs')

// Run only with a separately installed Electron binary. This file is not the production entrypoint.
const temporary = fs.realpathSync(tmpdir())
const directory = fs.mkdtempSync(path.join(temporary, 'wenay-chat-electron-probe-'))
for (const name of ['profile', 'session', 'logs', 'crashes']) fs.mkdirSync(path.join(directory, name))
app.setPath('userData', path.join(directory, 'profile'))
app.setPath('sessionData', path.join(directory, 'session'))
app.setPath('logs', path.join(directory, 'logs'))
app.setPath('crashDumps', path.join(directory, 'crashes'))
app.enableSandbox()
// The probe owns shutdown/cleanup; production last-window close policy is not imported or changed.
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{scheme: 'wenay-chat-setup', privileges: {standard: true, secure: true}}])
let generation = 0, releaseWrite, currentPhase = 'startup'
const windows = [], partitions = new Set(), requests = [], errors = []
const held = new Set()

async function phase(name, run) {
    currentPhase = name
    console.log('PROBE_PHASE=' + name)
    let timer
    try {
        const value = await Promise.race([Promise.resolve().then(run), new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Probe phase timeout: ' + name)), 5000)
        })])
        console.log('PROBE_PHASE_DONE=' + name)
        return value
    } finally {clearTimeout(timer)}
}

function HiddenWindow(options) {
    requests.push(options.webPreferences)
    const window = new BrowserWindow({...options, show: false})
    // The fixture owns this native window; production receives no hidden/testing option.
    window.show = () => {}
    windows.push(window)
    window.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message))
    return window
}
const ownSession = {fromPartition(name) {
    const isolated = session.fromPartition(name)
    isolated.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
        callback({cancel: !details.url.startsWith('wenay-chat-setup://setup/') && details.url != 'about:blank'})
    })
    partitions.add(isolated)
    return isolated
}}

async function cleanup() {
    generation++
    releaseWrite?.()
    for (const release of held) release()
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    for (const isolated of partitions) {
        await isolated.closeAllConnections()
        await isolated.clearStorageData()
        await isolated.clearCache()
    }
    const resolved = await io.realpath(directory)
    if (path.dirname(resolved) != temporary || !path.basename(resolved).startsWith('wenay-chat-electron-probe-')) {
        throw new Error('Refusing to remove an unexpected probe directory')
    }
    // Chromium may lock its own profile until process exit on Windows. Caller removes this exact temp after exit.
    console.log('PROBE_DATA=' + resolved)
    console.log('CLEANUP_REQUIRED_AFTER_EXIT: remove only this checked own probe directory, then verify absent')
}

async function check() {
    const settings = createEndpointSettings({directory: path.join(directory, 'settings')})
    let connects = 0, barrier = false, enteredWrite, completedWrite
    const entered = new Promise(resolve => {enteredWrite = resolve})
    const written = new Promise(resolve => {completedWrite = resolve})
    function setup(message = '') {
        const scope = ++generation
        const owned = createSetupWindow({BrowserWindow: HiddenWindow, session: ownSession, generation: scope,
            settings: {...settings, async write(input) {
                if (barrier) {
                    enteredWrite()
                    await new Promise(resolve => {releaseWrite = resolve})
                }
                try {return await settings.write(input)}
                finally {if (barrier) completedWrite()}
            }}, origin: settings.read(), message, actual: () => scope == generation,
            connect() {connects++}})
        return owned
    }
    const local = setup()
    await phase('setup-load', () => loadWindow({load: local.load, timeoutMs: 5000, actual: () => !local.window.isDestroyed()}))
    assert.equal(local.window.isVisible(), false)
    const frame = local.window.webContents.mainFrame
    assert.equal(frame.origin, 'wenay-chat-setup://setup')
    assert.equal(frame.url, 'wenay-chat-setup://setup/index.html')
    const read = await phase('setup-read', () => local.window.webContents.executeJavaScript('window.desktopSetup.read()'))
    assert.deepEqual(read, {origin: '', message: ''})
    assert.equal(await local.window.webContents.executeJavaScript('typeof require'), 'undefined')
    for (const origin of ['http://chat.example.test', 'https://user:pass@chat.example.test', 'https://chat.example.test/path']) {
        const reply = await phase('invalid-configure', () =>
            local.window.webContents.executeJavaScript('window.desktopSetup.configureOrigin(' + JSON.stringify(origin) + ')'))
        assert.equal(reply.ok, false)
        assert.equal(settings.read(), null)
    }
    const foreign = new HiddenWindow({webPreferences: {session: ownSession.fromPartition('probe-foreign'),
        preload: path.join(__dirname, 'setup-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false}})
    await phase('foreign-load', () => foreign.loadURL('about:blank'))
    await phase('foreign-denied', () => assert.rejects(foreign.webContents.executeJavaScript('window.desktopSetup.read()')))
    assert.equal(settings.read(), null)
    barrier = true
    const pending = local.window.webContents.executeJavaScript('window.desktopSetup.configureOrigin("https://chat.example.test")')
    // Handle destruction rejection immediately, not after the native renderer disappears.
    const completion = pending.then(value => value, () => null)
    await phase('write-barrier-enter', () =>
        Promise.race([entered, completion.then(() => {throw new Error('Configure ended before the IO barrier')})]))
    generation++
    local.window.destroy()
    releaseWrite()
    // Renderer promises need not settle after destroy. Observe its rejection, but assert the real main-side IO boundary.
    await phase('stale-native-write-finished', () => written)
    assert.equal(settings.read(), null)
    assert.equal(connects, 0)
    for (const mode of ['cancel', 'hold']) {
        const scope = ++generation
        const remote = createRemoteWindow({BrowserWindow: HiddenWindow, session: ownSession,
            origin: 'https://chat.example.test', generation: scope})
        const prefs = requests.at(-1)
        assert.equal(prefs.preload, undefined)
        assert.equal(prefs.nodeIntegration, false)
        assert.equal(prefs.contextIsolation, true)
        assert.equal(prefs.sandbox, true)
        let intercepted = false
        remote.session.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (_details, callback) => {
            intercepted = true
            if (mode == 'cancel') return callback({cancel: true})
            const release = () => {
                held.delete(release)
                callback({cancel: true})
            }
            held.add(release)
        })
        const began = Date.now()
        await phase('remote-' + mode + '-load', () => assert.rejects(loadWindow({load: remote.load, timeoutMs: 1000,
            actual: () => scope == generation && !remote.window.isDestroyed()}),
        mode == 'hold' ? {name: 'ConnectionTimeoutError'} : undefined))
        assert(intercepted, 'fixture interception must run before any possible network request')
        assert(Date.now() - began < 3000)
        remote.window.webContents.stop()
        for (const release of held) release()
        // Inspect the owned remote renderer after stopping the interrupted navigation; no server page is fabricated.
        remote.session.webRequest.onBeforeRequest({urls: ['<all_urls>']}, (details, callback) => {
            callback({cancel: details.url != 'about:blank'})
        })
        await phase('remote-' + mode + '-blank-load', () => remote.window.loadURL('about:blank'))
        assert.equal(await phase('remote-' + mode + '-bridge-absence', () =>
            remote.window.webContents.executeJavaScript('typeof window.desktopSetup')), 'undefined')
        assert.equal(await phase('remote-' + mode + '-node-absence', () =>
            remote.window.webContents.executeJavaScript('typeof require')), 'undefined')
        remote.window.destroy()
        await phase('remote-' + mode + '-cleanup', async () => {
            await remote.session.closeAllConnections()
            await remote.session.clearStorageData()
            await remote.session.clearCache()
        })
        barrier = false
        const editable = setup('Fixture: connection interrupted')
        await phase('editable-' + mode + '-load', () =>
            loadWindow({load: editable.load, timeoutMs: 5000, actual: () => !editable.window.isDestroyed()}))
        assert.deepEqual(await phase('editable-' + mode + '-read', () => editable.window.webContents.executeJavaScript('window.desktopSetup.read()')),
            {origin: '', message: 'Fixture: connection interrupted'})
        assert.equal(await editable.window.webContents.executeJavaScript('document.querySelector("#origin").disabled'), false)
        editable.window.destroy()
    }
    assert.deepEqual(errors, [])
    console.log('ELECTRON_VERSION=' + process.versions.electron)
    console.log('PASS Electron technical probe: actual setup origin/preload IPC, invalid/foreign/stale scope, intercepted load failure/deadline')
    console.log('LIMIT: hidden factory/helper composition; no visible UX, main menu transition, HTTPS Chat login or installed artifact acceptance')
}

const watchdog = setTimeout(() => {
    console.error('Electron technical probe timed out during ' + currentPhase)
    cleanup().finally(() => app.exit(1))
}, 30000)
app.whenReady().then(check).then(async () => {
    await cleanup()
    clearTimeout(watchdog)
    app.exit(0)
}).catch(async error => {
    console.error(error)
    try {await cleanup()} catch (cleanupError) {console.error(cleanupError)}
    clearTimeout(watchdog)
    app.exit(1)
})
