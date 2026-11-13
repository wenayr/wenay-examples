import {fileURLToPath} from 'node:url'
import {preview} from 'vite'

const port = Number(process.env.SERVICE_PORT ?? '3820')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Некорректный SERVICE_PORT')
const server = await preview({
    root: fileURLToPath(new URL('.', import.meta.url)),
    preview: {host: '127.0.0.1', port, strictPort: true},
})
server.printUrls()
