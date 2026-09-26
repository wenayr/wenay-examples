import {defineConfig} from 'vite'

const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3819'

export default defineConfig({
    publicDir: false,
    server: {host: '127.0.0.1', port: 5175, proxy: {'/api': upstream, '/socket.io': {target: upstream, ws: true}}}
})
