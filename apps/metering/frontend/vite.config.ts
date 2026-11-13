import {defineConfig} from 'vite'

const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3812'
export default defineConfig({build: {manifest: true}, publicDir: false,
    server: {port: 5191, proxy: {'/api': upstream, '/socket.io': {target: upstream, ws: true}}}})
