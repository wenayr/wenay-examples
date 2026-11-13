import {defineConfig} from 'vite'
export default defineConfig({build: {manifest: true},
    server: {port: 5197, proxy: {'/api': 'http://127.0.0.1:3817', '/socket.io': {target: 'http://127.0.0.1:3817', ws: true}}}})
