import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hosting = path.join(repository, 'apps/hosting')
export const installationTarget = 'ubuntu-24.04-linux-x64-node24'
const entrypoints = ['backend/server.ts', 'backend/agent-main.ts']
const required = ['package.json', 'package-lock.json', 'tsconfig.json', ...entrypoints, 'public/index.html', 'public/.vite/manifest.json']
const limit = 32 * 1024 * 1024

export function sha256(bytes) {return createHash('sha256').update(bytes).digest('hex')}
function execute(command, args, cwd = repository) {
    return execFileSync(command, args, {cwd, maxBuffer: limit, timeout: 60000, windowsHide: true})
}
function git(args) {return execute('git', args).toString('utf8').trim()}
function safePath(name) {
    const safe = /^[\w./-]+$/.test(name) && !name.startsWith('/') && !name.split('/').includes('..')
    if (!safe || name.includes('//')) throw new Error('Unsafe artifact path: ' + name)
    const parts = name.split('/')
    const excluded = ['node_modules', 'data', 'work', '.git', '.env', 'secrets']
    if (parts.some(part => excluded.includes(part))) throw new Error('Excluded artifact path: ' + name)
}
function filesBelow(directory, prefix = '') {
    const found = []
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const name = prefix + entry.name
        safePath(name)
        const file = path.join(directory, entry.name)
        if (lstatSync(file).isSymbolicLink()) throw new Error('Artifact links are forbidden: ' + name)
        if (entry.isDirectory()) found.push(...filesBelow(file, name + '/'))
        else if (entry.isFile()) found.push(name)
        else throw new Error('Artifact special file: ' + name)
    }
    return found.sort()
}
function runtimeFiles(tracked) {
    const selected = new Set()
    function visit(name) {
        if (selected.has(name)) return
        if (!tracked.has(name)) throw new Error('Runtime import is not tracked: ' + name)
        selected.add(name)
        const source = readFileSync(path.join(hosting, name), 'utf8')
        const imports = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g
        const dynamic = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g
        for (const match of [...source.matchAll(imports), ...source.matchAll(dynamic)]) {
            if (!match[1].startsWith('.')) continue
            const base = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]))
            const target = [base, base + '.ts', base + '/index.ts'].find(candidate => tracked.has(candidate))
            if (!target || !target.startsWith('backend/')) throw new Error('Unsupported runtime import: ' + match[1])
            visit(target)
        }
    }
    for (const entry of entrypoints) visit(entry)
    return [...selected].sort()
}
function versions(packageJson, lock) {
    const values = {...packageJson.dependencies, ...packageJson.devDependencies}
    for (const [name, version] of Object.entries(values)) {
        if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Unpinned dependency: ' + name)
        if (lock.packages['node_modules/' + name]?.version != version) throw new Error('Lock mismatch: ' + name)
    }
    if (!values.tsx || !values['wenay-common2'] || !values['wenay-react2']) throw new Error('Missing runtime dependency contract')
    return values
}
function publicFiles(directory) {
    const manifest = JSON.parse(readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8'))
    const selected = new Set(['index.html', '.vite/manifest.json'])
    for (const asset of Object.values(manifest)) {
        for (const name of [asset.file, ...asset.css ?? [], ...asset.assets ?? []]) {
            safePath(name)
            selected.add(name)
        }
    }
    for (const name of selected) {
        const file = path.join(directory, name)
        let current = directory
        for (const part of name.split('/')) {
            current = path.join(current, part)
            if (lstatSync(current).isSymbolicLink()) throw new Error('Public asset links are forbidden: ' + name)
        }
        if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error('Invalid public asset: ' + name)
    }
    return [...selected].sort()
}
export function packageInstallation(deps) {
    if (deps.target != installationTarget) throw new Error('Unsupported installation target')
    const output = path.resolve(deps.output)
    if (existsSync(output)) throw new Error('Artifact output already exists')
    if (!output.endsWith('.tar.gz')) throw new Error('Artifact output must be .tar.gz')
    const dirty = git(['status', '--porcelain', '--untracked-files=no', '--', 'apps/hosting'])
    if (dirty) throw new Error('Hosting tracked source must be clean before packaging')
    const revision = git(['rev-parse', 'HEAD'])
    const tracked = new Set(git(['ls-files', 'apps/hosting']).split('\n').map(name => name.slice('apps/hosting/'.length)))
    const frontend = [...tracked].filter(name => name.startsWith('frontend/')).sort()
    const sourceFiles = ['package.json', 'package-lock.json', 'tsconfig.json', ...runtimeFiles(tracked), ...frontend]
    const parent = path.join(hosting, '.test-data')
    mkdirSync(parent, {recursive: true})
    const stage = mkdtempSync(path.join(parent, 'installation-'))
    const archiveRoot = path.join(stage, 'bundle')
    const app = path.join(archiveRoot, 'app')
    try {
        for (const name of sourceFiles) {
            safePath(name)
            const target = path.join(app, name)
            mkdirSync(path.dirname(target), {recursive: true})
            // Git bytes identify the exact commit, independent of Windows checkout line endings.
            writeFileSync(target, execute('git', ['show', revision + ':apps/hosting/' + name]))
        }
        const build = {mode: 'provided-existing-assets', freshnessVerifiedByPackager: false}
        let publicDirectory = path.join(hosting, 'public')
        if (!deps.reusePublic) {
            execute(process.execPath, [path.join(hosting, 'node_modules/vite/bin/vite.js'), 'build', path.join(app, 'frontend'),
                '--config', path.join(app, 'frontend/vite.config.ts'), '--outDir', path.join(app, 'public')], hosting)
            publicDirectory = path.join(app, 'public')
            build.mode = 'fresh-vite-build'
            build.freshnessVerifiedByPackager = true
        } else {
            for (const name of publicFiles(publicDirectory)) {
                const target = path.join(app, 'public', name)
                mkdirSync(path.dirname(target), {recursive: true})
                writeFileSync(target, readFileSync(path.join(publicDirectory, name)))
            }
        }
        publicFiles(path.join(app, 'public'))
        const packageJson = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'))
        const lock = JSON.parse(readFileSync(path.join(app, 'package-lock.json'), 'utf8'))
        const dependencies = versions(packageJson, lock)
        const files = filesBelow(app).map(function record(name) {
            const bytes = readFileSync(path.join(app, name))
            return {path: 'app/' + name, size: bytes.length, sha256: sha256(bytes)}
        })
        const manifest = {format: 'hosting-source-assets-v1', target: deps.target, installedRuntime: false,
            source: {revision, app: 'apps/hosting'}, version: packageJson.version, dependencies,
            lockSha256: sha256(readFileSync(path.join(app, 'package-lock.json'))), build,
            builder: {platform: process.platform, arch: process.arch, node: process.version},
            runtime: {nodeMajor: 24, dependencyInstall: 'npm ci --include=dev --no-audit --no-fund',
                tsx: dependencies.tsx, authority: 'node --import tsx backend/server.ts', agent: 'node --import tsx backend/agent-main.ts'}, files}
        writeFileSync(path.join(archiveRoot, 'manifest.json'), JSON.stringify(manifest, null, 4) + '\n')
        mkdirSync(path.dirname(output), {recursive: true})
        const names = ['manifest.json', ...files.map(file => file.path)]
        execute('tar', ['-czf', output, '-C', archiveRoot, '--', ...names])
        const digest = sha256(readFileSync(output))
        verifyInstallation({artifact: output, sha256: digest, target: deps.target})
        return {artifact: output, sha256: digest, manifest}
    } finally {
        if (path.dirname(stage) != parent || !path.basename(stage).startsWith('installation-')) throw new Error('Unsafe staging cleanup')
        rmSync(stage, {recursive: true, force: true})
    }
}
function verifySnapshot(deps, archive, tar) {
    const entries = tar(['-tzf', archive]).toString('utf8').trim().split(/\r?\n/)
    const listing = tar(['-tvzf', archive]).toString('utf8').trim().split(/\r?\n/)
    if (entries.length > 500 || listing.length != entries.length) throw new Error('Unsupported archive listing')
    // Inspect only to stdout; verification never extracts files or follows an archive path into the filesystem.
    if (listing.some(line => !line.startsWith('-'))) throw new Error('Archive links/directories/special entries are forbidden')
    if (new Set(entries).size != entries.length) throw new Error('Duplicate archive entries')
    for (const name of entries) safePath(name)
    function read(name) {return tar(['-xOzf', archive, '--', name])}
    if (!entries.includes('manifest.json')) throw new Error('Missing artifact manifest')
    const manifest = JSON.parse(read('manifest.json').toString('utf8'))
    const correct = manifest.format == 'hosting-source-assets-v1' && manifest.target == deps.target && manifest.installedRuntime == false
    if (!correct || !/^[a-f0-9]{40}$/.test(manifest.source?.revision ?? '')) throw new Error('Invalid artifact identity/target')
    if (!Array.isArray(manifest.files)) throw new Error('Missing manifest files')
    const expected = ['manifest.json', ...manifest.files.map(file => file.path)].sort()
    if (JSON.stringify([...entries].sort()) != JSON.stringify(expected)) throw new Error('Artifact file set mismatch')
    for (const file of manifest.files) {
        safePath(file.path)
        if (!file.path.startsWith('app/')) throw new Error('Invalid artifact file root')
        const content = read(file.path)
        if (content.length != file.size || sha256(content) != file.sha256) throw new Error('Artifact file integrity mismatch: ' + file.path)
    }
    for (const name of required) if (!entries.includes('app/' + name)) throw new Error('Missing required artifact file: ' + name)
    const packageJson = JSON.parse(read('app/package.json').toString('utf8'))
    const lock = JSON.parse(read('app/package-lock.json').toString('utf8'))
    const dependencies = versions(packageJson, lock)
    if (JSON.stringify(dependencies) != JSON.stringify(manifest.dependencies)) throw new Error('Dependency manifest mismatch')
    if (sha256(read('app/package-lock.json')) != manifest.lockSha256) throw new Error('Lock fingerprint mismatch')
    if (manifest.runtime?.tsx != dependencies.tsx || manifest.runtime.nodeMajor != 24) throw new Error('Invalid runtime requirements')
    const assets = JSON.parse(read('app/public/.vite/manifest.json').toString('utf8'))
    const publicEntries = new Set(['app/public/index.html', 'app/public/.vite/manifest.json'])
    for (const asset of Object.values(assets)) {
        for (const name of [asset.file, ...asset.css ?? [], ...asset.assets ?? []]) {
            safePath(name)
            publicEntries.add('app/public/' + name)
            if (!entries.includes('app/public/' + name)) throw new Error('Missing frontend asset: ' + name)
        }
    }
    if (entries.some(name => name.startsWith('app/public/') && !publicEntries.has(name))) throw new Error('Unreferenced public artifact file')
    return manifest
}
export function createInstallationVerifier(deps = {}) {
    const tar = deps.tar ?? function nativeTar(args) {return execute('tar', args)}
    function verify(input) {
        if (input.target != installationTarget) throw new Error('Unsupported installation target')
        if (!/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw new Error('Expected external SHA256 is required')
        const original = path.resolve(input.artifact)
        const info = lstatSync(original)
        if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Artifact must be a bounded regular file')
        const bytes = readFileSync(original)
        if (bytes.length > limit || sha256(bytes) != input.sha256) throw new Error('Artifact SHA256 mismatch or size limit')
        const parent = realpathSync(tmpdir())
        const directory = mkdtempSync(path.join(parent, 'hosting-artifact-verify-'))
        try {
            const snapshot = path.join(directory, 'checked.tar.gz')
            // All later process IO reads exactly the checked bytes, never the replaceable caller path.
            writeFileSync(snapshot, bytes, {flag: 'wx', mode: 0o400})
            return verifySnapshot(input, snapshot, tar)
        } finally {
            const owned = path.dirname(directory) == parent && path.basename(directory).startsWith('hosting-artifact-verify-')
            if (!owned) throw new Error('Unsafe verifier snapshot cleanup')
            rmSync(directory, {recursive: true, force: true})
        }
    }
    return {verify}
}
export function verifyInstallation(input) {return createInstallationVerifier().verify(input)}
if (process.argv[1] && import.meta.url == pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(3)
        const value = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3)
        const target = value('target')
        if (process.argv[2] == 'pack') {
            const result = packageInstallation({output: value('output'), target, reusePublic: args.includes('--reuse-public')})
            console.log(JSON.stringify({artifact: result.artifact, sha256: result.sha256, installedRuntime: false}, null, 4))
        } else if (process.argv[2] == 'verify') {
            const manifest = verifyInstallation({artifact: value('artifact'), sha256: value('sha256'), target})
            console.log(JSON.stringify({verified: true, revision: manifest.source.revision, target, installedRuntime: false}, null, 4))
        } else throw new Error('Use pack --output=... --target=... [--reuse-public] or verify --artifact=... --sha256=... --target=...')
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}
