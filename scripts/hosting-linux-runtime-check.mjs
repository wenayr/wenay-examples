import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {installationTarget, sha256, verifyInstallation} from './hosting-installation.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ubuntuImage = 'ubuntu:24.04@sha256:496754492fb28b4d3049432f2ca787449331e23fb14f0dd3fffea86bf5a93eb4'
const nodeImage = 'node:24.18.0-bookworm-slim@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6'
const label = 'wenay.examples.hosting-linux-fixture'
const args = process.argv.slice(2)
const value = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3)

export function validateExtractionPaths(manifest) {
    const names = ['manifest.json', ...manifest.files.map(file => file.path)]
    for (const name of names) {
        const parts = name.split('/')
        const canonical = path.posix.normalize(name) == name && parts.every(part => part && part != '.' && part != '..')
        const rooted = name == 'manifest.json' || name.startsWith('app/')
        if (!canonical || !rooted || name.includes('\\')) throw new Error('Noncanonical artifact extraction path: ' + name)
    }
    if (new Set(names).size != names.length) throw new Error('Duplicate artifact extraction path')
}

function docker(arguments_, timeout = 180000) {
    return execFileSync('docker', arguments_, {timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true}).toString('utf8').trim()
}
function image(reference) {
    try {docker(['image', 'inspect', reference], 15000)}
    catch {docker(['pull', '--platform', 'linux/amd64', reference])}
    const inspected = JSON.parse(docker(['image', 'inspect', reference]))[0]
    if (inspected.Os != 'linux' || inspected.Architecture != 'amd64') throw new Error('Pinned image platform mismatch')
    const digest = reference.slice(reference.indexOf('@') + 1)
    if (!inspected.RepoDigests.some(item => item.endsWith('@' + digest))) throw new Error('Pinned image digest mismatch')
    return {reference, id: inspected.Id, os: inspected.Os, architecture: inspected.Architecture}
}
const runtimeProbe = String.raw`import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {createServiceClient} from 'wenay-common2/service/client'

async function bounded(promise, milliseconds) {
    let timer
    const expiry = new Promise(function timeout(_resolve, reject) {
        timer = setTimeout(function expired() {reject(new Error('Fixture deadline exceeded'))}, milliseconds)
    })
    try {return await Promise.race([promise, expiry])}
    finally {clearTimeout(timer)}
}
async function until(check) {
    const end = Date.now() + 12000
    while (!await check()) {
        assert(Date.now() < end, 'Fixture readiness exceeded')
        await new Promise(function tick(resolve) {setTimeout(resolve, 50)})
    }
}
const contract = JSON.parse(await readFile('/fixture/contract.json', 'utf8'))
for (const [name, version] of Object.entries(contract.dependencies)) {
    const installed = JSON.parse(await readFile('node_modules/' + name + '/package.json', 'utf8'))
    assert.equal(installed.version, version)
}
const url = 'http://127.0.0.1:3700'
const password = randomBytes(24).toString('hex')
const accounts = [{account: 'linux-admin', password, role: 'admin', projects: []}]
await mkdir('/run-fixture/data', {mode: 0o700})
await writeFile('/run-fixture/accounts.json', JSON.stringify(accounts), {flag: 'wx', mode: 0o600})
const child = spawn(process.execPath, ['--import', 'tsx', 'backend/server.ts'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
        NODE_OPTIONS: '--max-old-space-size=128', HOSTING_ACCOUNTS_FILE: '/run-fixture/accounts.json',
        SERVICE_DATA_DIR: '/run-fixture/data', SERVICE_PORT: '3700', SERVICE_HOST: '127.0.0.1',
        SERVICE_PUBLIC_URL: url, SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'),
        SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')}
})
let exited = false
let output = ''
function capture(bytes) {output = (output + bytes.toString()).slice(-16000)}
child.stdout.on('data', capture)
child.stderr.on('data', capture)
const stopped = new Promise(function onClose(resolve) {
    child.once('close', function closed(code) {
        exited = true
        resolve(code)
    })
    child.once('error', function failed() {
        exited = true
        resolve(-1)
    })
})
let client
try {
    await until(async function descriptorReady() {
        if (exited) throw new Error('Authority exited before readiness: ' + output)
        try {return (await fetch(url + '/api/client', {signal: AbortSignal.timeout(500)})).ok}
        catch {return false}
    })
    const descriptor = await (await fetch(url + '/api/client', {signal: AbortSignal.timeout(3000)})).json()
    assert(!JSON.stringify(descriptor).includes(password))
    client = createServiceClient({definition: descriptor, url, auth: {credentials: {account: accounts[0].account, password}}, log() {}})
    await bounded(client.ready(), 10000)
    const principal = await bounded(client.identity.me(), 5000)
    assert.equal(principal.account, accounts[0].account)
    assert(principal.roles.includes('admin'))
    const input = Object.freeze({id: 'linux-proof', title: 'Owned Linux runtime fixture'})
    const created = await bounded(client.commands.createProject('linux-native-proof', input), 5000)
    const repeated = await bounded(client.commands.createProject('linux-native-proof', input), 5000)
    assert.deepEqual(repeated, created)
    await until(function projected() {return client.views.dashboard.store.state.projects?.length == 1})
    assert.equal(client.views.dashboard.store.state.projects[0].id, input.id)
    assert.equal((await fetch(url + '/', {signal: AbortSignal.timeout(3000)})).status, 200)
    const assets = JSON.parse(await readFile('public/.vite/manifest.json', 'utf8'))
    assert.equal((await fetch(url + '/' + assets['index.html'].file, {signal: AbortSignal.timeout(3000)})).status, 200)
    console.log('PASS Linux authority: descriptor + actual native authenticated RPC/project receipt repeat + dashboard + static asset')
} finally {
    client?.close()
    child.kill('SIGTERM')
    try {await bounded(stopped, 5000)}
    catch {
        child.kill('SIGKILL')
        await bounded(stopped, 2000)
    }
}
`
const bootstrap = String.raw`import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {cp, readFile, writeFile} from 'node:fs/promises'

assert.equal(process.platform, 'linux')
assert.equal(process.arch, 'x64')
assert.equal(process.version, 'v24.18.0')
const release = await readFile('/etc/os-release', 'utf8')
assert(/^ID=ubuntu$/m.test(release))
assert(/^VERSION_ID="24.04"$/m.test(release))
const glibc = process.report.getReport().header.glibcVersionRuntime
assert(/^2\.39(?:\.|$)/.test(glibc), 'Expected Ubuntu24.04 glibc2.39 runtime')
console.log(JSON.stringify({os: 'Ubuntu24.04', arch: process.arch, node: process.version, glibc}))
await cp('/fixture/app', '/run-fixture/app', {recursive: true})
await writeFile('/run-fixture/app/runtime-probe.mjs', await readFile('/fixture/runtime-probe.mjs'))
process.chdir('/run-fixture/app')
await writeFile('/run-fixture/npm-user-config', '', {flag: 'wx', mode: 0o600})
async function run(arguments_, timeout) {
    const child = spawn(process.execPath, arguments_, {stdio: 'inherit', env: {...process.env,
        NODE_OPTIONS: '--max-old-space-size=192', TMPDIR: '/run-fixture', npm_config_cache: '/run-fixture/npm-cache',
        npm_config_userconfig: '/run-fixture/npm-user-config'}})
    let expired = false
    const timer = setTimeout(function timedOut() {expired = true; child.kill('SIGKILL')}, timeout)
    try {
        const code = await new Promise(function closed(resolve, reject) {
            child.once('error', reject)
            child.once('close', resolve)
        })
        assert.equal(code, 0, expired ? 'Fixture process timeout' : 'Fixture process failed')
    } finally {clearTimeout(timer)}
}
await run(['/usr/local/lib/node_modules/npm/bin/npm-cli.js', 'ci', '--include=dev', '--no-audit', '--no-fund'], 180000)
console.log('PASS real Linux npm ci --include=dev')
await run(['runtime-probe.mjs'], 40000)
`
function main() {
    const artifact = path.resolve(repository, value('artifact') ?? '')
    const expected = value('sha256')
    const artifactParent = realpathSync(path.join(repository, 'work/hosting-installation'))
    const allowed = path.dirname(realpathSync(artifact)) == artifactParent && /^hosting-[a-f0-9]{7,40}\.tar\.gz$/.test(path.basename(artifact))
    if (!allowed || lstatSync(artifact).isSymbolicLink()) throw new Error('Only explicitly selected owned Hosting work artifact is accepted')
    const manifest = verifyInstallation({artifact, sha256: expected, target: installationTarget})
    validateExtractionPaths(manifest)
    const plan = {target: installationTarget, artifactSha256: expected, source: manifest.source.revision,
        ubuntuImage, nodeToolchainDonor: nodeImage, memory: '768MiB', tmpfs: '512MiB', cpus: 1,
        agent: false, hostSocket: false, installedRuntime: false}
    if (!args.includes('--run')) {
        console.log(JSON.stringify({...plan, phase: 'prepared-only; --run required for actual Docker fixture'}, null, 4))
        return
    }
    const parent = path.join(repository, 'apps/hosting/.test-data')
    mkdirSync(parent, {recursive: true})
    const directory = mkdtempSync(path.join(parent, 'linux-runtime-'))
    const owner = randomUUID()
    const name = 'hosting-linux-' + owner.slice(0, 12)
    const donor = name + '-donor', container = name + '-runtime', volume = name + '-node'
    function removeOwned(kind, target) {
        let record
        try {record = JSON.parse(docker([kind, 'inspect', target], 10000))[0]}
        catch (error) {
            if (/no such|not found/i.test(error.stderr?.toString() ?? '')) return
            throw error
        }
        const labels = kind == 'volume' ? record.Labels : record.Config.Labels
        if (labels?.[label] != owner) throw new Error('Refusing to remove foreign Docker fixture: ' + target)
        if (kind == 'volume') docker(['volume', 'rm', target], 15000)
        else docker(['container', 'rm', '-f', target], 15000)
    }
    try {
        const snapshot = path.join(directory, 'checked.tar.gz')
        const bytes = readFileSync(artifact)
        if (sha256(bytes) != expected) throw new Error('Artifact changed before snapshot')
        writeFileSync(snapshot, bytes, {flag: 'wx', mode: 0o400})
        const snapshotManifest = verifyInstallation({artifact: snapshot, sha256: expected, target: installationTarget})
        validateExtractionPaths(snapshotManifest)
        const payload = path.join(directory, 'payload')
        mkdirSync(payload)
        execFileSync('tar', ['-xzf', snapshot, '-C', payload, '--no-same-owner', '--no-same-permissions'], {windowsHide: true, timeout: 30000})
        writeFileSync(path.join(payload, 'contract.json'), JSON.stringify(manifest))
        writeFileSync(path.join(payload, 'runtime-probe.mjs'), runtimeProbe)
        writeFileSync(path.join(payload, 'bootstrap.mjs'), bootstrap)
        console.log(JSON.stringify({...plan, images: [image(ubuntuImage), image(nodeImage)]}, null, 4))
        docker(['volume', 'create', '--label', label + '=' + owner, volume])
        // Docker populates a new owned volume from the donor's /usr/local. The donor never starts.
        docker(['create', '--name', donor, '--label', label + '=' + owner, '--network', 'none',
            '--memory', '768m', '--memory-swap', '768m', '--pids-limit', '128',
            '--mount', 'type=volume,source=' + volume + ',target=/usr/local', nodeImage, 'true'])
        const mounts = ['--mount', 'type=volume,source=' + volume + ',target=/usr/local,readonly,volume-nocopy',
            '--mount', 'type=bind,source=' + payload + ',target=/fixture,readonly']
        const security = ['--memory', '768m', '--memory-swap', '768m', '--cpus', '1', '--pids-limit', '128',
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '1000:1000',
            '--tmpfs', '/run-fixture:rw,exec,nosuid,nodev,size=512m,mode=1777']
        console.log(docker(['run', '--name', container, '--label', label + '=' + owner, ...security, ...mounts,
            ubuntuImage, '/usr/local/bin/node', '/fixture/bootstrap.mjs'], 240000))
        console.log('PASS bounded Ubuntu24.04/Node24 runtime fixture; not SSH/systemd/agent/TLS/clean-server installation')
    } finally {
        const failures = []
        for (const [kind, target] of [['container', container], ['container', donor], ['volume', volume]]) {
            try {removeOwned(kind, target)} catch (error) {failures.push(error.message)}
        }
        if (path.dirname(directory) != parent || !path.basename(directory).startsWith('linux-runtime-')) throw new Error('Unsafe fixture cleanup')
        rmSync(directory, {recursive: true, force: true})
        if (failures.length) throw new Error('Owned Docker cleanup failed: ' + failures.join(' | '))
    }
}
if (process.argv[1] && import.meta.url == pathToFileURL(path.resolve(process.argv[1])).href) {
    try {main()} catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
