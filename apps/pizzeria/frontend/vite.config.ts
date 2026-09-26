import {defineConfig} from 'vite'
export default defineConfig({
    build: {manifest: true},
    publicDir: 'assets',
    server: {proxy: {'/api': 'http://localhost:3500', '/socket.io': {target: 'http://localhost:3500', ws: true}}}
})
