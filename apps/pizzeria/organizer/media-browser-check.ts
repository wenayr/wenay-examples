import path from 'node:path'
import os from 'node:os'
import {mkdtemp, rm} from 'node:fs/promises'
import express from 'express'
import {build} from 'vite'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import {createOrganizerService} from './service'

async function main() {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wenay-media-browser-'))
    const service = createOrganizerService()
    try {
        await build({configFile: false, root: path.resolve('organizer'), build: {modulePreload: false, outDir: directory, rollupOptions: {input: path.resolve('organizer/media-browser-check.html')}}})
    } catch (error) {await rm(directory, {recursive: true, force: true}); throw error}
    const host = await createServiceLeaderHost({definition: service.definition, env: {SERVICE_PORT: '0'}, mount({app, leader}) {
        app.get('/api/client', (_req, res) => res.json(describeService(service.definition)))
        app.get('/', (_req, res) => res.redirect('/media-browser-check.html'))
        app.use(express.static(directory))
        return service.mount(leader.line.control.store)
    }})
    async function close() {
        await host.close()
        if (path.dirname(path.resolve(directory)) != path.resolve(os.tmpdir())) throw new Error('Unexpected temporary output')
        await rm(directory, {recursive: true, force: true})
        process.exit()
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    console.log('MEDIA_BROWSER_CHECK=' + host.url)
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
