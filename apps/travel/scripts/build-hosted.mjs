import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {build} from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const client = path.join(root, 'dist/client')
const server = path.join(root, 'dist/server')
const cache = path.join(root, '.cache')
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}
await build({root, configFile: false, base: '/', build: {outDir: client, emptyOutDir: true}})
const assets = {}
let assetBytes = 0
async function collect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const filename = path.join(directory, entry.name)
        if (entry.isDirectory()) await collect(filename)
        else {
            const bytes = await readFile(filename)
            const route = '/' + path.relative(client, filename).replaceAll(path.sep, '/')
            assets[route] = {body: bytes.toString('base64'), type: types[path.extname(filename)] ?? 'application/octet-stream'}
            assetBytes += bytes.length
        }
    }
}
await collect(client)
await mkdir(cache, {recursive: true})
const entry = path.join(cache, 'hosted-worker.mjs')
await writeFile(entry, "import {createTravelWorker} from '../backend/worker.ts'\nexport default createTravelWorker({requireSharedStorage:true,assets:"
    + JSON.stringify(assets) + '})\n')
await build({root, configFile: false, publicDir: false, build: {
    outDir: server, emptyOutDir: true, target: 'es2022', minify: false,
    lib: {entry, formats: ['es'], fileName: () => 'index.js'},
    rolldownOptions: {output: {codeSplitting: false}},
}})
const worker = await readFile(path.join(server, 'index.js'))
const metadata = {
    workerBytes: worker.length, staticAssets: Object.keys(assets).length, staticBytes: assetBytes, runtime: 'worker-esm',
    agencyStorage: 'R2 JSON via BUCKET', identity: 'Sites authenticated user header',
    quoteStorage: 'R2 JSON request observations with bounded process memory',
    updates: 'demand SSE invalidations with shared snapshot polling', jobs: 'ExecutionContext.waitUntil with bounded source jobs',
}
await writeFile(path.join(root, 'dist/hosted-build.json'), JSON.stringify(metadata, null, 2) + '\n')
console.log(JSON.stringify(metadata))
