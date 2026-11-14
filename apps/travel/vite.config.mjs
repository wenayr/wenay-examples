import {defineConfig} from 'vite'
import http from 'node:http'

function supplyPlugin() {
    async function attach(server) {
        // Keep server-only source adapters out of the browser and load them natively;
        // they read data files relative to their module, also when Vite bundles this config.
        const moduleUrl = new URL('./backend/supply.ts', import.meta.url)
        const {createTravelSupply} = await import(/* @vite-ignore */ moduleUrl.href)
        const usesProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
        const restoreProxy = usesProxy && http.setGlobalProxyFromEnv?.()
        const supply = createTravelSupply()
        server.middlewares.use(supply.middleware)
        server.httpServer?.once('close', () => {
            void supply.shutdown()
            if (restoreProxy) restoreProxy()
        })
    }
    return {name: 'wenay-travel-supply', configureServer: attach, configurePreviewServer: attach}
}

export default defineConfig({plugins: [supplyPlugin()]})
