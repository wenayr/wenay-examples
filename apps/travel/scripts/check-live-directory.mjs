// Optional Chromium E2E. Run after npm run build; provide Playwright in Node's module path.
import assert from 'node:assert/strict'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createRequire} from 'node:module'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
import {savePlaceSnapshot} from '../backend/places/index.mjs'
import {runPhotoImport} from '../backend/photos/import-photos.ts'

const require = createRequire(import.meta.url)
const {chromium} = require('playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.env.TRAVEL_TEST_PORT ?? 48320)
const base = 'http://127.0.0.1:' + port
const temp = await mkdtemp(path.join(tmpdir(), 'wenay-live-directory-'))
const manifest = path.join(temp, 'photos.json')
process.env.TRAVEL_SNAPSHOT_DIR = temp
const targetId = 'Q90000014'
const targetName = 'SSE Test Hotel 14'
const names = Array.from({length: 15}, (_, index) => 'SSE Test Hotel ' + String(index + 1).padStart(2, '0'))

function publishHotels(names) {
    const records = names.map((name, i) => ({
        id: 'wikidata:Q' + (90000001 + i), wikidataId: 'Q' + (90000001 + i), name,
        latitude: 27.12 + 0.002 * i, longitude: 33.81 + 0.002 * i, locality: 'Test', category: 'Test hotel',
    }))
    savePlaceSnapshot('hurghada', {sourceId: 'wikidata', records, fetchedAt: new Date().toISOString()})
}

const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/0/00/Hotel-photo-fixture.webp'
async function importFixturePhoto(present) {
    const title = 'Hotel-photo-fixture.webp'
    const file = {
        url: imageUrl, mime: 'image/webp', sha1: 'a'.repeat(40), descriptionurl: 'https://commons.wikimedia.org/wiki/File:' + title,
        extmetadata: {Artist: {value: 'Test photographer'}, LicenseShortName: {value: 'CC BY 4.0'},
            LicenseUrl: {value: 'https://creativecommons.org/licenses/by/4.0/'}},
    }
    async function fetchFixture(input) {
        const url = new URL(input)
        if (url.hostname == 'query.wikidata.org') {
            const id = {type: 'uri', value: 'http://www.wikidata.org/entity/' + targetId}
            const file = {type: 'uri', value: 'http://commons.wikimedia.org/wiki/Special:FilePath/' + title}
            return Response.json({results: {bindings: [present ? {id, file} : {id}]}})
        }
        assert.equal(url.hostname, 'commons.wikimedia.org')
        return Response.json({query: {pages: [{title: 'File:' + title, imageinfo: [file]}]}})
    }
    await runPhotoImport({manifestPath: manifest, checkpointPath: path.join(temp, 'checkpoint.json'),
        targets: [{key: targetId, links: []}], exclusions: {}, force: true, fetcher: fetchFixture})
}

async function expectRevisionChange(previous) {
    for (let i = 0; i < 100; i++) {
        const page = await fetch(base + '/api/travel/catalog?destination=hurghada&source=wikidata&limit=1').then(r => r.json())
        if (page.revision != previous) return page.revision
        await delay(120)
    }
    throw new Error('Server did not observe the published files')
}

let server, browser, stopped
async function start() {
    server = spawn(process.execPath, ['server.mjs'], {
        cwd: root, env: {...process.env, SERVICE_PORT: String(port), TRAVEL_PHOTO_MANIFEST: manifest, TRAVEL_REFRESH_MODE: 'manual'},
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    stopped = once(server, 'exit')
    let output = ''
    server.stdout.on('data', text => { output += text })
    server.stderr.on('data', text => { output += text })
    for (let attempt = 0; attempt < 100; attempt++) {
        if (server.exitCode != null) throw new Error('Application exited early: ' + output)
        if (output.includes(String(port))) {
            const response = await fetch(base + '/api/travel/destinations')
            if (response.ok) return
        }
        await delay(100)
    }
    throw new Error('Application did not start: ' + output)
}

async function stop() {
    if (server && server.exitCode == null && server.signalCode == null) server.kill()
    if (stopped) await stopped
    server = undefined
}

try {
    await writeFile(manifest, '{}')
    publishHotels(names)
    await start()
    const chromiumOptions = process.env.TRAVEL_TEST_CHROMIUM_MODULE
        ? (await import(process.env.TRAVEL_TEST_CHROMIUM_MODULE)).default : undefined
    browser = await chromium.launch(chromiumOptions ? {
        executablePath: await chromiumOptions.executablePath(), args: chromiumOptions.args,
    } : {headless: true})
    const context = await browser.newContext({locale: 'ru-RU', viewport: {width: 1200, height: 900}})
    // The upstream HTTP fixture and the virtual photograph never leave this test.
    const localPhoto = await readFile(path.join(root, 'public/hotel-photos/q111399390.webp'))
    await context.route(url => url.origin + url.pathname == imageUrl, route => route.fulfill({contentType: 'image/webp', body: localPhoto}))
    const ui = await context.newPage()
    const errors = [], network = [], events = []
    ui.on('pageerror', error => errors.push(error.message))
    ui.on('request', request => network.push(request.url()))
    const cdp = await context.newCDPSession(ui)
    await cdp.send('Network.enable')
    cdp.on('Network.eventSourceMessageReceived', event => events.push(event.eventName))
    await ui.goto(base, {waitUntil: 'domcontentloaded'})
    const cards = ui.locator('.property-card')
    await ui.getByLabel('Источник', {exact: true}).selectOption('wikidata')
    const searchLoaded = ui.waitForResponse(response =>
        new URL(response.url()).searchParams.get('q') == 'SSE Test Hotel' && response.ok())
    await ui.getByRole('searchbox').fill('SSE Test Hotel')
    await searchLoaded
    await ui.waitForFunction(() => document.querySelector('.directory-pagination')?.textContent.includes('из 15'))
    await ui.getByRole('button', {name: 'Дальше'}).click()
    await ui.locator('.directory-pagination').getByText('13–15 из 15').waitFor()
    await cards.locator('h3 button', {hasText: targetName}).click()
    const dialog = ui.getByRole('dialog')
    await dialog.getByText('Фото объекта пока нет').waitFor()
    await dialog.getByRole('link', {name: /Booking.com/}).waitFor()
    const optionRequests = () => network.filter(url => url.includes('/api/travel/options?')).length
    const beforeOptions = optionRequests()
    const timeOrigin = await ui.evaluate(() => performance.timeOrigin)
    let revision = await fetch(base + '/api/travel/catalog?destination=hurghada&source=wikidata').then(r => r.json()).then(p => p.revision)

    await importFixturePhoto(true)
    revision = await expectRevisionChange(revision)
    await dialog.locator('.property-photo img').waitFor()
    await dialog.locator('.property-photo figcaption').getByText('Test photographer', {exact: true}).waitFor()
    await ui.waitForFunction(() => document.querySelector('dialog img')?.naturalWidth > 0)
    await dialog.locator('figcaption a', {hasText: 'CC BY 4.0'}).waitFor()
    assert.equal(await cards.locator('h3 button', {hasText: targetName}).count(), 0, 'record moved to page 1 with photo')
    await ui.locator('.directory-pagination').getByText('13–15 из 15').waitFor()
    assert.equal(optionRequests(), beforeOptions, 'a new photo did not repeat the supplier query')
    console.log('PASS open hotel receives photo and credit after moving off current results page')

    // The tab misses an update while offline. A new server epoch requires reset and a fresh GET.
    await context.setOffline(true)
    await stop()
    const renamed = names.map(name => name == targetName ? name + ' Renamed' : name)
    publishHotels(renamed)
    await importFixturePhoto(false)
    await start()
    await context.setOffline(false)
    await dialog.getByRole('heading', {name: targetName + ' Renamed'}).waitFor()
    await dialog.getByText('Фото объекта пока нет').waitFor()
    for (let i = 0; i < 100 && !events.includes('reset'); i++) await delay(100)
    assert.ok(events.includes('reset'), 'browser received reset after restart')
    assert.ok(events.includes('catalog'), 'browser received delta before disconnect')
    assert.equal(await ui.getByRole('searchbox').inputValue(), 'SSE Test Hotel')
    assert.equal(await ui.getByLabel('Источник', {exact: true}).inputValue(), 'wikidata')
    assert.equal(await ui.evaluate(() => performance.timeOrigin), timeOrigin, 'same document after restart')
    assert.equal(optionRequests(), beforeOptions)
    console.log('PASS native EventSource reconnect and reset after restart while filtered hotel stays open')

    publishHotels(renamed.slice(0, 8))
    await dialog.waitFor({state: 'detached'})
    await ui.locator('.directory-pagination').getByText('1–8 из 8').waitFor()
    assert.equal(await cards.count(), 8)
    assert.equal(await ui.locator('.directory-map-pin').count(), 8)
    assert.equal(await ui.evaluate(() => performance.timeOrigin), timeOrigin)
    assert.deepEqual(errors, [])
    console.log('PASS removed hotel closes its dialog, empty last page returns to valid page and map updates')
} finally {
    await browser?.close()
    await stop()
    await rm(temp, {recursive: true, force: true})
}
