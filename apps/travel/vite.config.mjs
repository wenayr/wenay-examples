import {defineConfig} from 'vite'

function supplyPlugin() {
    async function attach(server) {
        // Keep server-only source adapters out of the browser and load them natively;
        // they read data files relative to their module, also when Vite bundles this config.
        const moduleUrl = new URL('./backend/supply.ts', import.meta.url)
        const {createTravelSupply} = await import(/* @vite-ignore */ moduleUrl.href)
        const supply = createTravelSupply()
        server.middlewares.use(supply.middleware)
        server.httpServer?.once('close', supply.shutdown)
    }
    return {name: 'wenay-travel-supply', configureServer: attach, configurePreviewServer: attach}
}

export default defineConfig({plugins: [supplyPlugin()]})
