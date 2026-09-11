import {defineConfig} from 'vite'
const upstream = process.env.SERVICE_UPSTREAM ?? 'http://localhost:3600'
export default defineConfig({publicDir:false,server:{port:5174,proxy:{'/api':upstream,'/socket.io':{target:upstream,ws:true}}}})
