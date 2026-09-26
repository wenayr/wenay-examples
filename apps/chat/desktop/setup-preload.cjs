const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('desktopSetup', Object.freeze({
    read: () => ipcRenderer.invoke('chat-desktop:read-endpoint'),
    configureOrigin: origin => ipcRenderer.invoke('chat-desktop:configure-origin', origin)
}))
