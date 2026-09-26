const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const {tmpdir} = require('node:os')
const {configuredOrigin, allowsNavigation} = require('./origin.cjs')
const {createEndpointSettings} = require('./settings.cjs')
const {trustedSetupSender} = require('./setup-window.cjs')
const {loadWindow} = require('./load-window.cjs')

async function check() {
    let expire, cancelled = 0
    const clock = {setTimeout(callback, milliseconds) {
        assert.equal(milliseconds, 15000)
        expire = callback
        return 1
    }, clearTimeout(timer) {
        assert.equal(timer, 1)
        cancelled++
    }}
    const hanging = loadWindow({...clock, load: () => new Promise(() => {}), timeoutMs: 15000, actual: () => true})
    expire()
    await assert.rejects(hanging, {name: 'ConnectionTimeoutError'})
    assert.equal(cancelled, 1)
    let resolve
    const late = loadWindow({...clock, load: () => new Promise(done => {resolve = done}), timeoutMs: 15000, actual: () => false})
    await Promise.resolve()
    resolve()
    await assert.rejects(late, /сменилось/)
    assert.equal(cancelled, 2)
    await loadWindow({...clock, load: async () => {}, timeoutMs: 15000, actual: () => true})
    assert.equal(cancelled, 3)
    const origin = 'https://chat.example.test'
    assert.equal(configuredOrigin(origin), origin)
    for (const value of ['http://chat.example.test', origin + '/', origin + '/chat', origin + '?token=a', origin + '#a',
        'https://user:pass@chat.example.test', 'https://chat.example.test,other.test', 'https://*.example.test', 'x'.repeat(2049)]) {
        assert.throws(() => configuredOrigin(value))
    }
    assert.equal(allowsNavigation({origin, url: origin + '/chat'}), true)
    assert.equal(allowsNavigation({origin, url: 'https://other.test'}), false)
    const frame = {origin: 'wenay-chat-setup://setup', url: 'wenay-chat-setup://setup/index.html', detached: false}
    const contents = {mainFrame: frame}
    const window = {webContents: contents, isDestroyed: () => false}
    const event = {sender: contents, senderFrame: frame}
    const trusted = input => trustedSetupSender({window, actual: () => true, ...input})
    assert.equal(trusted({event}), true)
    assert.equal(trusted({event: {...event, sender: {}}}), false)
    assert.equal(trusted({event: {...event, senderFrame: {...frame}}}), false)
    assert.equal(trusted({event: {...event, senderFrame: null}}), false)
    assert.equal(trusted({event, actual: () => false}), false)
    frame.origin = 'null'
    assert.equal(trusted({event}), false)
    frame.origin = 'https://chat.example.test'
    assert.equal(trusted({event}), false)
    frame.origin = 'wenay-chat-setup://setup'
    frame.detached = true
    assert.equal(trusted({event}), false)
    const temporary = await fs.realpath(tmpdir())
    const directory = await fs.mkdtemp(path.join(temporary, 'wenay-chat-settings-check-'))
    try {
        const settings = createEndpointSettings({directory})
        assert.equal(settings.read(), null)
        await settings.write({origin, actual: () => true})
        assert.equal(settings.read(), origin)
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'endpoint.json'), 'utf8')), {version: 1, origin})
        let guards = 0
        await assert.rejects(settings.write({origin: 'https://new.example.test', actual: () => ++guards == 1}))
        assert.equal(settings.read(), origin)
        assert.deepEqual(await fs.readdir(directory), ['endpoint.json'])
        await fs.writeFile(path.join(directory, 'endpoint.json'), 'x'.repeat(8193))
        assert.equal(settings.read(), null)
        await fs.writeFile(path.join(directory, 'endpoint.json'), JSON.stringify({version: 1, origin, token: 'unwanted'}))
        assert.equal(settings.read(), null)
        const blocked = path.join(directory, 'blocked')
        await fs.writeFile(blocked, 'file')
        await assert.rejects(createEndpointSettings({directory: blocked}).write({origin, actual: () => true}))
    } finally {
        const resolved = await fs.realpath(directory)
        if (path.dirname(resolved) != temporary || !path.basename(resolved).startsWith('wenay-chat-settings-check-')) {
            throw new Error('Refusing to remove an unexpected source-check directory')
        }
        await fs.rm(resolved, {recursive: true, force: true})
    }
    console.log('PASS desktop source: deadline/stale-load guards, origin/navigation, IPC negatives, settings late-close/IO failure')
}

check().catch(error => {
    console.error(error)
    process.exitCode = 1
})
