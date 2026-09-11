import {defineConfig} from 'vite'

const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3818'

export default defineConfig({
    server: {port: 5198, proxy: {'/api': upstream, '/socket.io': {target: upstream, ws: true}}}
})
