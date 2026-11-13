// Run the same visitor's HTTP session against a fresh reader; build the index in another process.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {once} from 'node:events'
import {closeSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {createServer} from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import {fileURLToPath} from 'node:url'
import {encodePlaceSnapshot, placeDestinations, type PlaceDestination} from '../backend/places/index.mjs'
import type {SupplyCatalogPage, SupplyHotel} from '../src/supply-contract.ts'

const app = fileURLToPath(new URL('../', import.meta.url))
const script = fileURLToPath(import.meta.url)
const mib = (bytes: number) => +(bytes / 1048576).toFixed(1)
const duration = (start: number) => +(performance.now() - start).toFixed(2)

function generateSnapshot(directory: string, count: number) {
    const fetchedAt = new Date().toISOString()
    let bytes = 0
    function makeRecord(i: number, number: number, region: PlaceDestination) {
        const [west, south, east, north] = region.bbox
        const columns = Math.max(1, Math.ceil(Math.sqrt(number)))
        const row = Math.floor(i / columns)
        const column = i % columns
        const propertyId = 'way/' + (1000000 + placeDestinations.indexOf(region) * count + i)
        const kind = i % 3 == 0 ? 'Marina Hotel' : 'Palm Resort'
        return {
            id: 'osm:' + propertyId, name: kind + ' ' + i, sourceId: 'osm', sourceName: 'OpenStreetMap',
            destinationId: region.id, category: 'размещение', locality: region.name, website: null,
            latitude: +(south + (north - south) * (row + 0.5) / columns).toFixed(6),
            longitude: +(west + (east - west) * (column + 0.5) / columns).toFixed(6),
            registrationId: null, wikidataId: null, sourceUrl: 'https://www.openstreetmap.org/' + propertyId,
            photo: null, price: null,
        } as const
    }
    for (const [regionIndex, region] of placeDestinations.entries()) {
        const first = Math.floor(regionIndex * count / placeDestinations.length)
        const n = Math.floor((regionIndex + 1) * count / placeDestinations.length) - first
        for (const sourceId of region.sourceIds) {
            // Explicit empty sources keep real bundled hotels out of the synthetic fixture.
            const records = sourceId == 'osm' ? Array.from({length: n}, (_, i) => makeRecord(i, n, region)) : []
            const encoded = encodePlaceSnapshot({sourceId, fetchedAt, records})
            const digest = createHash('sha256').update(encoded).digest('hex')
            const name = region.id + '-' + sourceId + '.' + Date.parse(fetchedAt) + '-' + digest + '.json'
            writeFileSync(join(directory, name), encoded)
            bytes += Buffer.byteLength(encoded)
        }
    }
    return bytes
}

// rchar includes cached reads and all files read by this isolated process during the handler.
// read_bytes counts storage-layer reads reported by Linux; on tmpfs and warm files it can be zero.
function createReadMeter() {
    let fd = -1
    try { fd = openSync('/proc/self/io', 'r') } catch {}
    const buffer = Buffer.alloc(1024)
    function sample() {
        if (fd < 0) return null
        const bytes = readSync(fd, buffer, 0, buffer.length, 0)
        const fields = Object.fromEntries(buffer.toString('ascii', 0, bytes).trim().split('\n').map(line => line.split(': ')))
        return {readCallBytes: Number(fields.rchar), storageBytes: Number(fields.read_bytes), sampleBytes: bytes}
    }
    function since(previous: ReturnType<typeof sample>) {
        const current = sample()
        if (!previous || !current) return undefined
        return {
            processReadCallBytes: current.readCallBytes - previous.readCallBytes - previous.sampleBytes,
            processStorageReadBytes: current.storageBytes - previous.storageBytes,
        }
    }
    function close() { if (fd >= 0) closeSync(fd) }
    return {sample, since, close}
}

async function runReader() {
    const {createTravelSupply} = await import('../backend/supply.ts')
    const startBytes = process.memoryUsage().rss
    const resultOrder = createHash('sha256')
    const io = createReadMeter()
    const beforeOpen = io.sample()
    const construction = performance.now()
    const supply = createTravelSupply()
    const setupMs = duration(construction)
    const openIo = io.since(beforeOpen)
    let lastRead: ReturnType<typeof io.since>
    const server = createServer(async (request, response) => {
        const before = io.sample()
        await supply.middleware(request, response, () => response.writeHead(404).end())
        lastRead = io.since(before)
    })
    try {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/travel/'
        const region = {destination: 'hurghada', limit: '12'}
        const viewport = {...region, west: '33.79', south: '27.18', east: '33.85', north: '27.24', source: 'osm'}
        const steps: Record<string, unknown>[] = []
        async function get<T>(label: string, path: string, params: Record<string, string>) {
            const before = supply.diagnostics()
            const start = performance.now()
            const response = await fetch(base + path + '?' + new URLSearchParams(params), {signal: AbortSignal.timeout(30_000)})
            const raw = await response.text()
            assert.equal(response.status, 200, raw)
            const body = JSON.parse(raw) as T
            const after = supply.diagnostics()
            const payloadRows = after.payloadReads - before.payloadReads
            const page = body as SupplyCatalogPage
            const returned = Array.isArray(page.items) ? page.items.length : Number(Boolean((body as {hotel: unknown}).hotel))
            if (Array.isArray(page.items)) resultOrder.update(JSON.stringify(page.items.map(h => h.id)))
            assert.equal(payloadRows, returned, label + ': returned payloads are the only hydrated hotel rows')
            steps.push({step: label, ms: duration(start), responseBytes: Buffer.byteLength(raw), returned, matches: page.total,
                payloadRows, payloadBytes: after.payloadBytes - before.payloadBytes, dedupCandidates: after.candidateRows - before.candidateRows,
                ...lastRead, rssMiB: mib(process.memoryUsage().rss)})
            return body
        }
        const startup = supply.diagnostics()
        assert.equal(startup.payloadReads, 0, 'no hotel payloads should be hydrated at startup')
        assert.equal(startup.writes, 0, 'opening the prepared index should not rewrite hotels')
        const first = await get<SupplyCatalogPage>('destination-page', 'catalog', region)
        assert.equal(first.items.length, 12)
        const window = await get<SupplyCatalogPage>('visible-map+source', 'catalog', viewport)
        assert(window.total > 12)
        assert(window.items.every(row => row.longitude >= 33.79 && row.longitude <= 33.85 && row.latitude >= 27.18 && row.latitude <= 27.24))
        assert(window.items.every(row => row.sourceId == viewport.source))
        const page2 = await get<SupplyCatalogPage>('map-page-two', 'catalog', {...viewport, offset: '12'})
        assert(page2.items.every(hotel => !window.items.some(firstPageHotel => firstPageHotel.id == hotel.id)))
        const query = await get<SupplyCatalogPage>('map+source+name', 'catalog', {...viewport, q: 'hotel'})
        assert(query.items.length > 0)
        const selected = query.items[0]
        const nameOnly = await get<SupplyCatalogPage>('name-within-destination', 'catalog', {...region, q: selected.name})
        assert(nameOnly.items.some(hotel => hotel.id == selected.id))
        const detail = {destination: region.destination, hotelId: selected.id}
        const {hotel} = await get<{hotel: SupplyHotel}>('open-card', 'hotel', detail)
        assert.equal(hotel.id, selected.id)
        const repeat = await get<SupplyCatalogPage>('return-to-map', 'catalog', {...viewport, q: 'hotel'})
        assert.deepEqual(repeat.items, query.items)

        // Stage the importer output before observing the cost of publishing its atomic rename.
        const filename = process.env.TRAVEL_PHOTO_MANIFEST!
        const photos = JSON.parse(readFileSync(filename, 'utf8')) as Record<string, unknown>
        const next = filename + '.tmp'
        photos[selected.id] = {url: 'https://example.org/hotel.webp', sourceUrl: 'https://example.org/hotel',
            credit: 'Benchmark', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'}
        writeFileSync(next, JSON.stringify(photos))
        const signal = new AbortController()
        const deadline = AbortSignal.any([signal.signal, AbortSignal.timeout(15_000)])
        const eventQuery = new URLSearchParams({destination: region.destination, since: repeat.revision!})
        const subscription = await fetch(base + 'events?' + eventQuery, {signal: deadline})
        assert.equal(subscription.status, 200)
        const reader = subscription.body!.getReader()
        const writesBefore = supply.diagnostics().writes
        const startUpdate = performance.now()
        const beforeUpdate = io.sample()
        try {
            renameSync(next, filename)
            let frames = ''
            const decoder = new TextDecoder()
            while (!frames.includes('event: catalog\n')) {
                const part = await reader.read()
                assert(!part.done)
                frames += decoder.decode(part.value, {stream: true})
            }
        } finally {
            signal.abort()
            reader.releaseLock()
        }
        const notificationMs = duration(startUpdate)
        const updateIo = io.since(beforeUpdate)
        const after = await get<{hotel: SupplyHotel}>('updated-card', 'hotel', detail)
        assert.equal(after.hotel.photo?.credit, 'Benchmark')
        const diagnostics = supply.diagnostics()
        const changedHotelWrites = diagnostics.writes - writesBefore
        assert.equal(changedHotelWrites, 1, 'only the selected property should change')
        const payloadRegions = Object.keys(diagnostics.byRegion)
        assert.deepEqual(payloadRegions, [region.destination])
        return {readerPid: process.pid, setupMs, openIo, startupPayloadRows: startup.payloadReads,
            startupHotelWrites: startup.writes, rssBeforeSupplyMiB: mib(startBytes), steps, payloadRegions,
            resultIdOrderSha256: resultOrder.digest('hex'), changedHotelWrites, updateIo, externalPhotoWriteToEventMs: notificationMs}
    } finally {
        io.close()
        await supply.shutdown()
        server.closeAllConnections()
        await new Promise<void>(done => server.close(() => done()))
    }
}

function run(dataset: string) {
    const temporary = mkdtempSync(join(tmpdir(), 'wenay-focused-http-'))
    try {
        const synthetic = dataset != 'real'
        let snapshotBytes = 0
        if (synthetic) {
            const count = Number(dataset)
            if (!Number.isSafeInteger(count) || count < 20_000) throw new RangeError('Укажите real или хотя бы 20000 записей')
            snapshotBytes = generateSnapshot(temporary, count)
        }
        const manifest = join(temporary, 'photos.json')
        const bundledPhotos = join(app, 'backend/property-photo-manifest.json')
        writeFileSync(manifest, synthetic ? '{}' : readFileSync(bundledPhotos))
        const index = join(temporary, 'catalog.sqlite')
        const env = {...process.env, TRAVEL_SNAPSHOT_DIR: temporary, TRAVEL_CATALOG_INDEX_PATH: index,
            TRAVEL_PHOTO_MANIFEST: manifest, TRAVEL_REFRESH_MODE: 'manual'}
        function child(command: string, args: string[]) {
            const result = spawnSync(command, args, {env, cwd: app, encoding: 'utf8', timeout: 600_000})
            if (result.error) throw result.error
            if (result.status != 0) throw new Error(result.stderr + result.stdout)
            return result.stdout.trim()
        }
        const prepStart = performance.now()
        child('npm', ['run', 'catalog:prepare'])
        const preparationMs = duration(prepStart)
        const reader = JSON.parse(child(process.execPath, [script, '--reader']))
        if (synthetic && reader.openIo) {
            // This coarse guard detects volume-wide startup scans independently of filesystem caching.
            assert(reader.openIo.processReadCallBytes < snapshotBytes / 4, 'prepared startup read at least a quarter of the source bytes')
        }
        return {dataset, regionsInDataset: placeDestinations.length, syntheticSnapshotBytes: snapshotBytes || undefined,
            indexFileMiB: mib(statSync(index).size), preparationMs, ...reader}
    } finally {
        rmSync(temporary, {recursive: true, force: true})
    }
}

if (process.argv[2] == '--reader') console.log(JSON.stringify(await runReader()))
else console.log(JSON.stringify(run(process.argv[2] ?? '750000'), null, 2))
