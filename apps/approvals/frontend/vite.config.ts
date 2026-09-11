import {defineConfig} from 'vite'
export default defineConfig({server:{port:5198,proxy:{'/api':'http://127.0.0.1:3818','/socket.io':{target:'http://127.0.0.1:3818',ws:true}}}})

