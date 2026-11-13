import {defineConfig} from 'vite'
const upstream = process.env.SERVICE_UPSTREAM ?? 'http://127.0.0.1:3816'
export default defineConfig({build: {manifest: true}, publicDir: false,
    server: {port: 5196, proxy: {'/api': upstream, '/socket.io': {target: upstream, ws: true}}}})
