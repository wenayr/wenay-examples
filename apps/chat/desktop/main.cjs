const {app, BrowserWindow, dialog, Menu, session, protocol} = require('electron')
const path = require('node:path')
const {createRemoteWindow} = require('./remote-window.cjs')
const {createEndpointSettings} = require('./settings.cjs')
const {createSetupWindow} = require('./setup-window.cjs')
const {loadWindow} = require('./load-window.cjs')

app.enableSandbox()
app.setName('Wenay Chat')
protocol.registerSchemesAsPrivileged([{scheme: 'wenay-chat-setup', privileges: {standard: true, secure: true}}])
let current, generation = 0, transitioning = false, quitting = false, settings


async function transition(origin, message = '') {
    if (quitting || transitioning) return
    transitioning = true
    const scope = ++generation
    const old = current
    current = null
    old?.window.destroy()
    try {
        if (old?.session) {
            // Destroying the renderer stops sockets first; tokens are never read or transferred.
            await old.session.closeAllConnections()
            await old.session.clearStorageData()
            await old.session.clearCache()
        }
        if (quitting || scope != generation) return
        let next
        if (origin) next = createRemoteWindow({BrowserWindow, session, origin, generation: scope})
        else next = createSetupWindow({BrowserWindow, session, settings, generation: scope,
            origin: settings.read(), message, actual: () => !quitting && scope == generation,
            connect: value => {void transition(value)}})
        current = next
        next.window.once('closed', () => {
            if (current != next) return
            current = null
            generation++
        })
        transitioning = false
        try {
            await loadWindow({load: next.load, timeoutMs: 15000,
                actual: () => current == next && !quitting && scope == generation})
            if (origin) {
                next.window.setProgressBar(-1)
                next.window.setTitle('Wenay Chat')
            }
        }
        catch (error) {
            if (current != next || quitting || scope != generation) return
            next.window.webContents.stop()
            const message = error.name == 'ConnectionTimeoutError' ? 'Сервер не ответил за 15 секунд. Проверьте адрес и сеть.'
                : 'Не удалось открыть сервер. Проверьте адрес, сеть и действительность HTTPS сертификата.'
            if (origin) await transition(null, message)
            else throw new Error('Local setup unavailable')
        }
    } catch {
        if (quitting || scope != generation) return
        dialog.showErrorBox('Wenay Chat', 'Не удалось очистить сессию или открыть локальную форму. Закройте приложение и повторите запуск.')
        app.quit()
    } finally {if (scope == generation) transitioning = false}
}

app.on('window-all-closed', () => {if (!transitioning) app.quit()})
app.on('before-quit', () => {quitting = true; generation++})
app.whenReady().then(async () => {
    settings = createEndpointSettings({directory: path.join(app.getPath('userData'), 'chat-settings')})
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: 'Сервер', submenu: [{label: 'Сменить сервер / выйти', click: () => {void transition(null)}}, {role: 'quit'}]},
        {label: 'Правка', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}]},
        {label: 'Окно', submenu: [{role: 'reload'}, {role: 'minimize'}, {role: 'close'}]}
    ]))
    await transition(settings.read())
}).catch(() => {
    dialog.showErrorBox('Wenay Chat', 'Не удалось запустить локальное приложение Chat.')
    app.quit()
})
