import {mkdtemp, realpath, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'

// Isolated browser fixture. Never reads a user archive, provider configuration or credentials.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = path.join(repository, 'apps/documents')
const load = createRequire(path.join(appRoot, 'package.json'))
const {require: requireTs} = load('tsx/cjs/api')
const {createDocumentRuntime} = requireTs(path.join(appRoot, 'backend/runtime.ts'), import.meta.url)
const {hashSecret} = requireTs(path.join(appRoot, 'backend/identity.ts'), import.meta.url)
const {createServiceLeaderHost} = load('wenay-common2/service/host')
const {describeService} = load('wenay-common2/service/client')
const express = load('express')
await stat(path.join(appRoot, 'public/index.html'))
const temporary = await realpath(tmpdir())
const directory = await mkdtemp(path.join(temporary, 'wenay-documents-keys-browser-'))
const runtime = createDocumentRuntime({directory: path.join(directory, 'processing'), processor: {
    async extract({signal}) {
        signal.throwIfAborted()
        throw new Error('Keys browser fixture: document processing is disabled')
    }
}})
// Seed only this new in-memory initial state; real runtime, native commands and guards remain unchanged.
const initial = runtime.definition.initial
initial.accounts.fixtureAdmin = {account: 'fixtureAdmin', name: 'Владелец fixture', secret: hashSecret('fixture-admin-only')}
initial.organizations.northstar.members.fixtureAdmin = 'owner'
initial.organizations.harbor.members.fixtureAdmin = 'owner'
initial.organizations.harbor.members.owner = 'owner'
let host, closing, failNext = false, holdNext = false, releaseReply
let commandSequence = 0
const holdWaiters = new Set()

async function close() {
    closing ??= (async function stop() {
        for (const release of holdWaiters) release()
        await host?.close()
        const resolved = await realpath(directory)
        if (path.dirname(resolved) != temporary || !path.basename(resolved).startsWith('wenay-documents-keys-browser-')) {
            throw new Error('Refusing to remove an unexpected browser fixture directory')
        }
        await rm(resolved, {recursive: true, force: true})
        process.stdin.pause()
    })()
    return closing
}

try {
    host = await createServiceLeaderHost({definition: runtime.definition, env: {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: directory,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }, mount({app, leader}) {
        app.get('/api/client', (_request, response) => response.json(describeService(runtime.definition)))
        app.use(express.static(path.join(appRoot, 'public')))
        return runtime.mount({store: leader.line.control.store, execute: {...leader.corridor.system,
            async productKeyRegister(requestId, input) {
                const fail = failNext, hold = holdNext
                failNext = false
                holdNext = false
                const receipt = await leader.corridor.system.productKeyRegister(requestId, input)
                if (hold) await new Promise(resolve => {
                    const release = () => {
                        holdWaiters.delete(release)
                        resolve()
                    }
                    holdWaiters.add(release)
                    releaseReply = release
                    console.log('FIXTURE_REPLY_HELD: native key persisted; use release within the 12-second resource deadline')
                })
                if (fail) throw new Error('Fixture response interrupted after native registration; repeat the same issue ticket')
                return receipt
            }
        }})
    }})
    const admin = host.leader.corridor.fragment('fixtureAdmin')
    async function control(command) {
        if (command == 'stop') return close()
        if (command == 'fail-next') failNext = true
        else if (command == 'hold-next') holdNext = true
        else if (command == 'release') {
            releaseReply?.()
            releaseReply = undefined
        }
        else if (command == 'revoke-owner' || command == 'restore-owner') {
            await admin.memberRole('fixture-role-' + ++commandSequence,
                {orgId: 'northstar', account: 'owner', role: command == 'revoke-owner' ? 'reviewer' : 'owner'})
        }
        else if (command) throw new Error('Unknown fixture command: ' + command)
        if (command) console.log('FIXTURE_COMMAND=' + command)
    }
    process.once('SIGINT', () => {void close()})
    process.once('SIGTERM', () => {void close()})
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let pending = '', controls = Promise.resolve()
    process.stdin.on('data', value => {
        pending += value
        const lines = pending.split(/\r?\n/)
        pending = lines.pop()
        for (const line of lines) {
            controls = controls.then(() => control(line.trim())).catch(error => console.error('FIXTURE_CONTROL_ERROR=' + error.message))
        }
    })
    process.stdin.once('end', () => {void close()})
    console.log('BROWSER_SESSION=' + host.url)
    console.log('BROWSER_DATA=' + directory)
    console.log('FIXTURE_LOGIN=owner / owner-pass (Northstar + Harbor owner)')
    console.log('FIXTURE_LOGIN=reviewer / reviewer-pass')
    console.log('FIXTURE_LOGIN=customer / customer-pass (uploader)')
    console.log('Commands: fail-next, hold-next, release, revoke-owner, restore-owner, stop')
    console.log('Synthetic data only; processing disabled; no AI, external provider, machine HTTP or user archive.')
    await new Promise(resolve => process.stdin.once('pause', resolve))
} finally {await close()}
