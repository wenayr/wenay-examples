const path = require('node:path')
const {readFile} = require('node:fs/promises')
const {configuredOrigin} = require('./origin.cjs')

const setupOrigin = 'wenay-chat-setup://setup'
const setupUrl = setupOrigin + '/index.html'
const assets = {'/index.html': 'text/html', '/setup.js': 'text/javascript', '/setup.css': 'text/css'}
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"

function trustedSetupSender(deps) {
    const {event, window, actual} = deps
    if (!actual() || window.isDestroyed()) return false
    const frame = event.senderFrame
    return event.sender == window.webContents && !!frame && !frame.detached && frame == window.webContents.mainFrame
        && frame.origin == setupOrigin && frame.url == setupUrl
}

function createSetupWindow(deps) {
    const isolated = deps.session.fromPartition('chat-desktop-setup-' + deps.generation)
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    isolated.protocol.handle('wenay-chat-setup', async request => {
        const url = new URL(request.url)
        const type = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null
        const exact = request.url == setupOrigin + url.pathname
        if (request.method != 'GET' || !exact || !type) return new Response('', {status: 404})
        const body = await readFile(path.join(__dirname, 'setup', url.pathname.slice(1)))
        return new Response(body, {headers: {'content-type': type + '; charset=utf-8', 'content-security-policy': csp}})
    })
    const window = new deps.BrowserWindow({title: 'Подключиться к Chat', width: 620, height: 520,
        minWidth: 360, minHeight: 500, show: false, webPreferences: {
            session: isolated, preload: path.join(__dirname, 'setup-preload.cjs'), contextIsolation: true,
            sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
            webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, devTools: false
        }})
    let busy = false
    function trusted(event) {return trustedSetupSender({event, window, actual: deps.actual})}
    window.webContents.ipc.handle('chat-desktop:read-endpoint', event => {
        if (!trusted(event)) throw new Error('Setup unavailable')
        return {origin: deps.origin ?? '', message: deps.message ?? ''}
    })
    window.webContents.ipc.handle('chat-desktop:configure-origin', async (event, value) => {
        if (!trusted(event) || busy) return {ok: false, message: 'Окно подключения недоступно'}
        busy = true
        try {
            if (typeof value != 'string' || value.length > 2048) throw new Error('Некорректный адрес сервера')
            const origin = configuredOrigin(value.trim())
            const actual = () => trusted(event)
            await deps.settings.write({origin, actual})
            if (!actual()) return {ok: false, message: 'Окно подключения закрыто'}
            deps.connect(origin)
            return {ok: true}
        } catch {
            return {ok: false, message: 'Не удалось сохранить адрес. Нужен HTTPS origin без пути, /, логина и пароля.'}
        } finally {busy = false}
    })
    function navigate(event) {if (event.url != setupUrl) event.preventDefault()}
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    window.once('ready-to-show', () => window.show())
    window.once('closed', () => isolated.protocol.unhandle('wenay-chat-setup'))
    return {window, load: () => window.loadURL(setupUrl)}
}

module.exports = {createSetupWindow, trustedSetupSender}
