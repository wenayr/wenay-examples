import {defineConfig} from 'vite'
export default defineConfig({server: {port: 5195, proxy: {'/api': 'http://127.0.0.1:3815', '/socket.io': {target: 'http://127.0.0.1:3815', ws: true}}}})
