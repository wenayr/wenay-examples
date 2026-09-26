const {allowsNavigation} = require('./origin.cjs')

function createRemoteWindow(deps) {
    const {BrowserWindow, session, origin, generation} = deps
    const isolated = session.fromPartition('chat-desktop-remote-' + generation)
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:", "connect-src 'self' wss://" + new URL(origin).host,
        "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'self'"].join('; ')
    isolated.webRequest.onHeadersReceived({urls: [origin + '/*']}, (details, callback) => {
        if (details.resourceType != 'mainFrame') return callback({responseHeaders: details.responseHeaders})
        const headers = {...details.responseHeaders}
        const existing = []
        for (const name of Object.keys(headers)) {
            if (name.toLowerCase() != 'content-security-policy') continue
            existing.push(...headers[name])
            delete headers[name]
        }
        headers['Content-Security-Policy'] = [...existing, csp]
        callback({responseHeaders: headers})
    })
    const window = new BrowserWindow({title: 'Подключаемся к ' + origin + '…', width: 1100, height: 760, minWidth: 360, minHeight: 500,
        backgroundColor: '#f4f5f8', show: true, webPreferences: {
            session: isolated, contextIsolation: true, sandbox: true, nodeIntegration: false,
            nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false,
            webSecurity: true, allowRunningInsecureContent: false, devTools: false
        }})
    function navigate(event) {
        if (!allowsNavigation({origin, url: event.url})) event.preventDefault()
    }
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    window.setProgressBar(2)
    return {window, session: isolated, load: () => window.loadURL(origin)}
}

module.exports = {createRemoteWindow}
