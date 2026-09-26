import {mkdtemp, realpath, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {randomBytes} from 'node:crypto'

// Explicit browser fixture: no configured accounts, user archive, Docker or network deployment.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = path.join(repository, 'apps/hosting')
const load = createRequire(path.join(appRoot, 'package.json'))
const {require: requireTs} = load('tsx/cjs/api')
const {createHostingRuntime} = requireTs(path.join(appRoot, 'backend/runtime.ts'), import.meta.url)
const {createServiceLeaderHost} = load('wenay-common2/service/host')
const {describeService} = load('wenay-common2/service/client')
const express = load('express')
await stat(path.join(appRoot, 'public/index.html'))

const accounts = [
    {account: 'admin', role: 'admin', projects: []},
    {account: 'owner', role: 'owner', projects: ['shop', 'other']},
    {account: 'operator', role: 'operator', projects: ['shop']},
    {account: 'observer', role: 'observer', projects: ['shop']},
    {account: 'agent', role: 'agent', projects: ['shop', 'other']}
].map(account => ({...account, password: account.account + '-browser-fixture-only'}))
const runtime = createHostingRuntime({accounts})
const temporary = await realpath(tmpdir())
const directory = await mkdtemp(path.join(temporary, 'wenay-hosting-origin-browser-'))
let host, closing, releaseReply, holdNext = false, failNext = false
const holdWaiters = new Set()
async function close() {
    closing ??= (async function stop() {
        for (const release of holdWaiters) release()
        await host?.close()
        const resolved = await realpath(directory)
        if (path.dirname(resolved) != temporary || !path.basename(resolved).startsWith('wenay-hosting-origin-browser-')) {
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
        return runtime.mount(leader.line.control.store, {async publicOriginSet(requestId, input) {
            const fail = failNext, hold = holdNext
            failNext = false
            holdNext = false
            const receipt = await leader.corridor.system.publicOriginSet(requestId, input)
            if (hold) await new Promise(resolve => {
                const release = () => {
                    holdWaiters.delete(release)
                    resolve()
                }
                holdWaiters.add(release)
                releaseReply = release
                console.log('FIXTURE_REPLY_HELD: native receipt persisted; enter release, revoke-owner or stop')
            })
            if (fail) throw new Error('Fixture reply interrupted after native receipt; repeat the same request')
            return receipt
        }})
    }})
    const admin = host.leader.corridor.fragment('admin')
    for (const project of ['shop', 'other']) {
        await admin.createProject('fixture-project-' + project, {id: project, title: project == 'shop' ? 'Магазин · fixture' : 'Другой проект · fixture'})
    }
    for (const [id, project, kind] of [['app-one', 'shop', 'docker'], ['app-two', 'shop', 'docker'], ['other-app', 'other', 'docker'],
        ['vm-only', 'shop', 'virtual-machine']]) {
        await admin.createEnvironment('fixture-environment-' + id, {id, project, kind, agent: 'agent'})
    }
    const seed = runtime.definition.resources.publicOrigin.open({principal: host.leader.access.principalOf({account: 'admin'}),
        sessionId: 'fixture-seed', resourceId: 'fixture-seed', signal: new AbortController().signal})
    await seed.facade.control.set({requestId: 'fixture-origin', environment: 'app-two', revision: 0, publicOrigin: 'https://fixture.example.test'})
    seed.close()
    process.once('SIGINT', () => {void close()})
    process.once('SIGTERM', () => {void close()})
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let pending = ''
    process.stdin.on('data', value => {
        pending += value
        const lines = pending.split(/\r?\n/)
        pending = lines.pop()
        for (const line of lines) {
            const command = line.trim(), owner = host.leader.line.control.store.state.accounts.owner
            if (command == 'stop') void close()
            else if (command == 'fail-next') failNext = true
            else if (command == 'hold-next') holdNext = true
            else if (command == 'release') {
                releaseReply?.()
                releaseReply = undefined
            }
            else if (command == 'revoke-owner') owner.role = 'observer'
            else if (command == 'revoke-projects') owner.projects = []
            else if (command == 'restore-owner') {
                owner.role = 'owner'
                owner.projects = ['shop', 'other']
            }
            else if (command) console.log('Unknown fixture command: ' + command)
            if (command && command != 'stop') console.log('FIXTURE_COMMAND=' + command)
        }
    })
    process.stdin.once('end', () => {void close()})
    console.log('BROWSER_SESSION=' + host.url)
    console.log('BROWSER_DATA=' + directory)
    for (const account of accounts) console.log('FIXTURE_LOGIN=' + account.account + ' / ' + account.password)
    console.log('Commands: fail-next, hold-next, release, revoke-owner, revoke-projects, restore-owner, stop')
    console.log('Fixture only: no agent, deployment, DNS, TLS or public proxy is running.')
    await new Promise(resolve => process.stdin.once('pause', resolve))
} finally {await close()}
