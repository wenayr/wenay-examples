import {readFile} from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import {runLeaderProcess} from 'wenay-common2/service/host'
import {describeService} from 'wenay-common2/service/client'
import type {AccountConfig} from './service'
import {createHostingRuntime} from './runtime'

async function main() {
    const configFile = process.env.HOSTING_ACCOUNTS_FILE
    if (!configFile) throw new Error('HOSTING_ACCOUNTS_FILE must point to a protected JSON account configuration')
    const tokenSecret = process.env.SERVICE_TOKEN_SECRET ?? ''
    const nodeToken = process.env.SERVICE_NODE_TOKEN ?? ''
    const strong = tokenSecret.length >= 32 && nodeToken.length >= 32
    if (!strong || tokenSecret == nodeToken) {
        throw new Error('SERVICE_TOKEN_SECRET and SERVICE_NODE_TOKEN must be different secrets'
            + ' of at least 32 characters, retained across restarts')
    }
    const accounts: AccountConfig[] = JSON.parse(await readFile(configFile, 'utf8'))
    const runtime = createHostingRuntime({accounts})
    const definition = runtime.definition
    const host = await runLeaderProcess({definition,
        env: {...process.env, SERVICE_PORT: process.env.SERVICE_PORT ?? '3700', SERVICE_DATA_DIR: process.env.SERVICE_DATA_DIR ?? path.resolve('data')},
        mount({app, leader}) {
            app.get('/api/client', function descriptor(_request, response) {response.json(describeService(definition))})
            app.use(express.static(path.resolve('public')))
            return runtime.mount(leader.line.control.store, leader.corridor.system)
        },
    })
    console.log('Hosting control API: '+host.url)
}

main().catch(function failed(error) {
    console.error(error.message)
    process.exitCode = 1
})
