import {defineConfig} from 'vite'

const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3811'

export default defineConfig({
    publicDir: false,
    server: {port: 5190, proxy: {'/api': upstream, '/socket.io': {target: upstream, ws: true}}}
})
