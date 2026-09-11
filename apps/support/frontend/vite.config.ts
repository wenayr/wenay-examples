import {defineConfig} from 'vite'

const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3810'

export default defineConfig({
    publicDir: false,
    server: {port: 5180, proxy: {'/api': upstream, '/auth': upstream, '/socket.io': {target: upstream, ws: true}}}
})
