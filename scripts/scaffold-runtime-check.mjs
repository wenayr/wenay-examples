import assert from 'node:assert/strict'
import {execFile, spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createSaasExample} from './create-saas-example.mjs'

// Deliberately one Support product slice, not a general scaffold runner.
const smoke = String.raw`import assert from 'node:assert/strict'
import {cp, readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
import {createHash, randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createSupportRuntime, type SupportDefinition} from './runtime'
import {createProcess} from './process-resource'

async function wait(label: string, ready: () => boolean) {
    const deadline = Date.now() + 18000
    while (!ready()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 30))
    }
}
async function files(directory: string, prefix = ''): Promise<Record<string, string>> {
    const found: Record<string, string> = {}
    for (const entry of await readdir(path.join(directory, prefix), {withFileTypes: true})) {
        assert(!entry.isSymbolicLink(), 'own archive must not contain symlinks')
        const relative = prefix ? prefix + '/' + entry.name : entry.name
        if (entry.isDirectory()) Object.assign(found, await files(directory, relative))
        else {
            assert(entry.isFile())
            found[relative] = createHash('sha256').update(await readFile(path.join(directory, relative))).digest('hex')
        }
    }
    return found
}
async function main() {
    const root = path.resolve(process.env.Q10_OWN_DATA!)
    const live = path.join(root, 'live')
    const restored = path.join(root, 'restored')
    const env = {SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
    let aborting = false
    function active() {assert(!aborting, 'Q10 phase aborted')}
    function processFor(script: string, env: NodeJS.ProcessEnv) {
        active()
        return createProcess({script, env})
    }
    let host = processFor('server.ts', env)
    let url = ''
    const sessions: ServiceClient<SupportDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []
    const nodes: ReturnType<typeof createProcess>[] = []
    async function close() {
        const closedResources = await Promise.allSettled(resources.splice(0).map(resource => resource.close()))
        for (const session of sessions.splice(0)) session.close()
        const closedProcesses = await Promise.allSettled([...nodes.splice(0).map(node => node.control.stop()), host.control.stop()])
        const failed = [...closedResources, ...closedProcesses].find(result => result.status == 'rejected')
        if (failed?.status == 'rejected') throw failed.reason
    }
    function abort(message: unknown) {
        if (message != 'q10-abort') return
        aborting = true
        void close().then(function stopped() {process.exit(1)}, function failed(error) {console.error(error)})
    }
    process.on('message', abort)
    async function client(account: string) {
        active()
        const response = await fetch(url + '/api/support/login', {method: 'POST',
            headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account, password: account + '-pass'}]})})
        const auth = await response.json()
        active()
        assert(response.ok && auth.ok)
        const session = createServiceClient<SupportDefinition>({definition: describeService(createSupportRuntime().definition),
            url, auth: {token: auth.value.token}, placement: {rng: () => 0}})
        sessions.push(session)
        await session.ready()
        active()
        await session.views.workspace.ready
        return session
    }
    async function history(session: ServiceClient<SupportDefinition>) {
        active()
        const owned = session.resources.open('conversation')
        resources.push(owned)
        await wait('conversation ready', () => owned.status.state.phase == 'ready')
        active()
        return owned.current()!.remote.control
    }
    const input = {orgId: 'northstar', subject: 'Warranty Desk urgent', body: 'Warranty copy smoke', priority: 'urgent' as const}
    try {
        url = await host.ready
        for (const id of ['q10-a', 'q10-b']) {
            const node = processFor('node.ts', {...env, SERVICE_DATA_DIR: path.join(root, id),
                SERVICE_NODE_ID: id, SERVICE_UPSTREAM: url})
            nodes.push(node)
            await node.ready
        }
        const customer = await client('customer')
        const owner = await client('owner')
        const agent = await client('agent')
        const outsider = await client('outsider')
        const created = await customer.commands.ticketCreate('q10-create', input)
        assert.deepEqual(await customer.commands.ticketCreate('q10-create', input), created)
        await wait('new ticket projection', () => customer.views.workspace.store.state.tickets.some(item => item.id == created.id))
        const ticket = customer.views.workspace.store.state.tickets.find(item => item.id == created.id)!
        assert(ticket.dueAt != undefined)
        assert.equal(ticket.dueAt - ticket.createdAt, 1800000)
        assert.equal(customer.views.workspace.store.state.tickets.filter(item => item.id == created.id).length, 1)
        for (const priority of ['normal', 'high'] as const) {
            const other = await customer.commands.ticketCreate('q10-' + priority, {...input, priority})
            await wait('unchanged SLA projection', () => customer.views.workspace.store.state.tickets.some(item => item.id == other.id))
            const projected = customer.views.workspace.store.state.tickets.find(item => item.id == other.id)!
            assert(projected.dueAt != undefined)
            assert.equal(projected.dueAt - projected.createdAt, priority == 'normal' ? 86400000 : 14400000)
        }
        const replyInput = {orgId: 'northstar', id: created.id, revision: created.revision, body: 'Warranty public', private: false}
        await assert.rejects(outsider.commands.ticketReply('q10-outsider', replyInput))
        await assert.rejects(customer.commands.ticketReply('q10-private-denied', {...replyInput, private: true}))
        const publicReply = await agent.commands.ticketReply('q10-public', replyInput)
        await assert.rejects(agent.commands.ticketReply('q10-stale', replyInput))
        const privateReply = await owner.commands.ticketReply('q10-private', {...replyInput, revision: publicReply.revision,
            body: 'Warranty private', private: true})
        const page = {orgId: 'northstar', ticketId: created.id, beforeId: '', query: '', limit: 50}
        const staffHistory = await history(agent)
        const customerHistory = await history(customer)
        assert.equal((await staffHistory.page(page)).total, 3)
        assert.equal((await customerHistory.page(page)).total, 2)
        assert(!(await customerHistory.page(page)).messages.some(item => item.private))
        const outsiderHistory = await history(outsider)
        await assert.rejects(outsiderHistory.page(page))
        await owner.commands.memberRole('q10-revoke', {orgId: 'northstar', account: 'agent', role: 'revoked'})
        await wait('revoked current projection', () => agent.views.workspace.store.state.organizations.length == 0)
        await assert.rejects(staffHistory.page(page))
        await wait('serving endpoint', () => !!customer.view.endpoint() && customer.view.endpoint()!.nodeId != 'leader')
        const endpoint = customer.view.endpoint()!
        const stable = customer.views.workspace.store
        await nodes[endpoint.nodeId == 'q10-a' ? 0 : 1].control.stop(true)
        await wait('endpoint failover', () => !!customer.view.endpoint() && customer.view.endpoint()!.nodeId != endpoint.nodeId)
        const finalReply = await customer.commands.ticketReply('q10-after-loss', {...replyInput,
            revision: privateReply.revision, body: 'Warranty after reconnect'})
        await wait('reconnected projection', () => customer.views.workspace.store.state.tickets
            .find(item => item.id == created.id)?.revision == finalReply.revision)
        assert.equal(customer.views.workspace.store, stable)
        await close()
        host = processFor('server.ts', env)
        url = await host.ready
        const restarted = await client('customer')
        assert.equal(restarted.views.workspace.store.state.tickets.find(item => item.id == created.id)?.revision, finalReply.revision)
        assert.deepEqual(await restarted.commands.ticketCreate('q10-create', input), created)
        await close()
        const before = await files(live)
        assert(Object.keys(before).length > 0)
        await cp(live, restored, {recursive: true, errorOnExist: true, force: false})
        assert.deepEqual(await files(restored), before)
        assert.deepEqual(await files(live), before)
        host = processFor('server.ts', {...env, SERVICE_DATA_DIR: restored})
        url = await host.ready
        const restoredCustomer = await client('customer')
        const restoredTicket = restoredCustomer.views.workspace.store.state.tickets.find(item => item.id == created.id)!
        assert.equal(restoredTicket.revision, finalReply.revision)
        assert(restoredTicket.dueAt != undefined)
        assert.equal(restoredTicket.dueAt - restoredTicket.createdAt, 1800000)
        assert.deepEqual(await restoredCustomer.commands.ticketCreate('q10-create', input), created)
        const restoredHistory = await history(restoredCustomer)
        assert.equal((await restoredHistory.page(page)).total, 3)
        assert(!(await restoredHistory.page(page)).messages.some(item => item.private))
        const restoredAgent = await client('agent')
        assert.equal(restoredAgent.views.workspace.store.state.organizations.length, 0)
        await assert.rejects((await history(restoredAgent)).page(page))
        assert.deepEqual(await files(live), before, 'source cold archive remains untouched')
        console.log('Q10_NATIVE_PASS=Warranty SLA, current roles/private resource, exact retry, failover, restart, cold directory restore')
    } finally {
        await close()
        process.removeListener('message', abort)
        if (process.connected) process.disconnect?.()
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
`

async function main() {
    const args = process.argv.slice(2)
    assert(args.length == 0 || (args.length == 2 && args[0] == '--npm-cli'), 'Use: node scripts/scaffold-runtime-check.mjs [--npm-cli path]')
    const npmCli = path.resolve(args[1] ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'))
    assert(existsSync(npmCli), 'npm CLI missing; supply --npm-cli with installed npm/bin/npm-cli.js')
    const parent = await realpath(tmpdir())
    const directory = await mkdtemp(path.join(parent, 'wenay-scaffold-runtime-q10-'))
    const copy = path.join(directory, 'warranty-desk')
    const cleanEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)) cleanEnv[key] = value
    }
    cleanEnv.Q10_OWN_DATA = path.join(directory, 'data')
    let cleanupSafe = true
    async function run(label, args) {
        console.log('Q10_PHASE=' + label)
        const started = Date.now()
        const child = spawn(process.execPath, args, {cwd: copy, env: cleanEnv,
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true, detached: process.platform != 'win32'})
        cleanupSafe = false
        let exited = false
        const completion = new Promise(function execute(resolve) {
            child.once('error', function failed(error) {
                if (!child.pid) cleanupSafe = true
                resolve({error})
            })
            child.once('close', function closed(code, signal) {
                exited = true
                cleanupSafe = true
                resolve({code, signal})
            })
        })
        async function deadline(milliseconds) {
            let timer
            try {
                return await Promise.race([completion, new Promise(resolve => {timer = setTimeout(() => resolve(null), milliseconds)})])
            } finally {clearTimeout(timer)}
        }
        const result = await deadline(label == 'npm-ci' ? 600000 : 120000)
        if (!result) {
            console.error('Q10_TIMEOUT=' + label)
            if (child.connected) child.send('q10-abort', function sent() {})
            await deadline(15000)
            if (!exited && child.pid) {
                if (process.platform == 'win32') {
                    await new Promise(function terminate(resolve, reject) {
                        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 10000},
                            function stopped(error) {
                                if (error && !exited) reject(error)
                                else resolve()
                            })
                    })
                } else {
                    try {process.kill(-child.pid, 'SIGKILL')} catch (error) {if (!exited) throw error}
                }
                await deadline(10000)
            }
            assert(exited, 'phase process-tree stop unconfirmed; retain own temporary directory')
            throw new Error(label + ': deadline exceeded')
        }
        if (result.error) throw result.error
        assert.equal(result.code, 0, label + ': exit ' + result.code + '/' + result.signal)
        console.log('Q10_PHASE_MS=' + label + ':' + (Date.now() - started))
    }
    async function replace(file, before, after) {
        const target = path.join(copy, file)
        const source = await readFile(target, 'utf8')
        assert.equal(source.split(before).length, 2, 'Expected one business-specific extension anchor: ' + file)
        await writeFile(target, source.replace(before, after))
    }
    console.log('Q10_OWN_DIRECTORY=' + directory)
    try {
        await createSaasExample({template: 'support', destination: copy, name: 'warranty-desk-q10', port: 4994, title: 'Warranty Desk'})
        const pkg = JSON.parse(await readFile(path.join(copy, 'package.json'), 'utf8'))
        const lockPath = path.join(copy, 'package-lock.json')
        const locked = await readFile(lockPath)
        const lock = JSON.parse(locked.toString())
        assert.equal(pkg.name, lock.packages[''].name)
        for (const [name, version] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) {
            assert(/^\d+\.\d+\.\d+$/.test(version), 'exact npm version required: ' + name)
            assert.equal(lock.packages['node_modules/' + name].version, version)
        }
        await replace('backend/domain.ts', 'const hours = {normal: 24, high: 4, urgent: 1}[input.priority]',
            'const hours = {normal: 24, high: 4, urgent: 0.5}[input.priority]')
        await replace('backend/domain-check.ts', 'assert.equal(state().tickets[urgent.id].dueAt, clock + 3600_000)',
            'assert.equal(state().tickets[urgent.id].dueAt, clock + 1800_000)')
        await writeFile(path.join(copy, 'backend/q10-copy-check.ts'), smoke)
        console.log('Q10_EXTENSION=domain.ts urgent hours0.5; domain-check.ts business expectation1800000; own native smoke')
        const npmUserConfig = path.join(directory, 'user.npmrc')
        const npmGlobalConfig = path.join(directory, 'global.npmrc')
        await writeFile(npmUserConfig, '')
        await writeFile(npmGlobalConfig, '')
        cleanEnv.npm_config_userconfig = npmUserConfig
        cleanEnv.npm_config_globalconfig = npmGlobalConfig
        cleanEnv.npm_config_cache = path.join(directory, 'npm-cache')
        await run('npm-ci', [npmCli, 'ci', '--no-audit', '--no-fund', '--userconfig', npmUserConfig, '--globalconfig', npmGlobalConfig,
            '--cache', path.join(directory, 'npm-cache'), '--registry', 'https://registry.npmjs.org/'])
        assert.equal(createHash('sha256').update(await readFile(lockPath)).digest('hex'), createHash('sha256').update(locked).digest('hex'))
        await run('typecheck', [npmCli, 'run', 'typecheck'])
        await run('build', [npmCli, 'run', 'build'])
        const tsx = path.join(copy, 'node_modules/tsx/dist/cli.mjs')
        for (const name of ['domain-check', 'conversation-check', 'q10-copy-check']) {
            await run(name, [tsx, 'backend/' + name + '.ts'])
        }
        console.log('Q10_PASS=autonomous Support copy subset; browser/full donor/backup-format pending')
    } finally {
        const absolute = path.resolve(directory)
        assert(path.dirname(absolute) == parent && path.basename(absolute).startsWith('wenay-scaffold-runtime-q10-'))
        assert(cleanupSafe, 'child stop unconfirmed: retain own directory ' + absolute)
        await rm(absolute, {recursive: true, force: true})
        assert(!existsSync(absolute))
        console.log('Q10_CLEANUP=own directory absent')
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
