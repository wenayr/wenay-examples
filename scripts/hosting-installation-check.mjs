import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createInstallationVerifier, installationTarget, packageInstallation, sha256, verifyInstallation} from './hosting-installation.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const parent = path.join(repository, 'apps/hosting/.test-data')
mkdirSync(parent, {recursive: true})
const directory = mkdtempSync(path.join(parent, 'installation-check-'))
try {
    const artifact = path.join(directory, 'hosting.tar.gz')
    // Explicit inherited root build evidence; fixture does not start another Vite/Docker build.
    const packaged = packageInstallation({output: artifact, target: installationTarget, reusePublic: true})
    const manifest = verifyInstallation({artifact, sha256: packaged.sha256, target: installationTarget})
    assert.equal(manifest.installedRuntime, false)
    assert.equal(manifest.runtime.tsx, '4.23.1')
    assert.equal(manifest.runtime.dependencyInstall, 'npm ci --include=dev --no-audit --no-fund')
    assert.equal(manifest.dependencies['wenay-common2'], '3.1.1')
    assert.equal(manifest.dependencies['wenay-react2'], '5.0.0')
    assert.equal(manifest.build.freshnessVerifiedByPackager, false)
    assert(manifest.files.some(file => file.path == 'app/backend/agent.ts'))
    assert(!manifest.files.some(file => /node_modules|\/data\/|\/work\/|-check\.ts$|\.env/.test(file.path)))
    assert.throws(() => verifyInstallation({artifact, sha256: packaged.sha256, target: 'ubuntu-24.04-linux-arm64-node24'}), /target/)
    assert.throws(() => verifyInstallation({artifact, sha256: '0'.repeat(64), target: installationTarget}), /SHA256/)
    assert.throws(() => verifyInstallation({artifact, target: installationTarget}), /external SHA256/)
    for (const failure of ['corrupt', 'missing', 'wrong-target']) {
        const extracted = path.join(directory, failure)
        mkdirSync(extracted)
        execFileSync('tar', ['-xzf', artifact, '-C', extracted], {windowsHide: true})
        const entry = 'app/backend/server.ts'
        if (failure == 'corrupt') writeFileSync(path.join(extracted, entry), 'export const corrupted = true\n')
        if (failure == 'missing') rmSync(path.join(extracted, entry))
        if (failure == 'wrong-target') {
            writeFileSync(path.join(extracted, 'manifest.json'), JSON.stringify({...manifest, target: 'ubuntu-24.04-linux-arm64-node24'}))
        }
        const names = ['manifest.json', ...manifest.files.map(file => file.path).filter(name => failure != 'missing' || name != entry)]
        const broken = path.join(directory, failure + '.tar.gz')
        execFileSync('tar', ['-czf', broken, '-C', extracted, '--', ...names], {windowsHide: true})
        // Correct outer hash must not mask changed inner bytes, missing files or wrong manifest target.
        const expected = sha256(readFileSync(broken))
        assert.throws(() => verifyInstallation({artifact: broken, sha256: expected, target: installationTarget}), /integrity|file set|target/)
    }
    const originalBytes = readFileSync(artifact)
    const replacementBytes = readFileSync(path.join(directory, 'wrong-target.tar.gz'))
    let snapshot = ''
    let calls = 0
    const verifier = createInstallationVerifier({tar(args) {
        const archive = args[1]
        assert.notEqual(archive, artifact)
        if (!calls++) {
            snapshot = archive
            assert.equal(sha256(readFileSync(snapshot)), packaged.sha256)
            // Real process boundary: replace the caller's valid original after snapshot/SHA validation.
            writeFileSync(artifact, replacementBytes)
        }
        assert.equal(archive, snapshot, 'every tar read must use the same checked private snapshot')
        return execFileSync('tar', args, {windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024})
    }})
    try {
        assert.deepEqual(verifier.verify({artifact, sha256: packaged.sha256, target: installationTarget}), manifest)
        assert(calls > 2)
        assert.notEqual(sha256(readFileSync(artifact)), packaged.sha256)
        assert(!existsSync(path.dirname(snapshot)), 'verified snapshot cleaned after successful verification')
        assert.throws(() => verifyInstallation({artifact, sha256: packaged.sha256, target: installationTarget}), /SHA256/)
    } finally {writeFileSync(artifact, originalBytes)}
    let failedSnapshot = ''
    const failedVerifier = createInstallationVerifier({tar(args) {
        failedSnapshot = args[1]
        throw new Error('Fixture process failed')
    }})
    assert.throws(() => failedVerifier.verify({artifact, sha256: packaged.sha256, target: installationTarget}), /Fixture process failed/)
    assert(!existsSync(path.dirname(failedSnapshot)), 'verified snapshot cleaned after process failure')
    console.log('PASS Hosting source/assets archive: tracked runtime, exact lock/version/SHA, provided assets, separate verify, corrupt/missing/wrong-target denied')
    console.log('PASS verifier snapshot: original replaced after hash, every real tar read uses trusted bytes, success/failure snapshots cleaned')
    console.log('LIMIT: no Linux npm installation, installed runtime, OS/SSH/Docker/TLS or external readiness acceptance')
} finally {
    if (path.dirname(directory) != parent || !path.basename(directory).startsWith('installation-check-')) throw new Error('Unsafe fixture cleanup')
    rmSync(directory, {recursive: true, force: true})
}
