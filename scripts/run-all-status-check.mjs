import assert from 'node:assert/strict'
import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(tmpdir(), 'wenay-run-status-'))

try {
    await mkdir(path.join(temporary, 'scripts'))
    for (const name of ['run-all.mjs', 'status.mjs']) {
        await copyFile(path.join(repository, 'scripts', name), path.join(temporary, 'scripts', name))
    }
    const runner = await import(pathToFileURL(path.join(temporary, 'scripts', 'run-all.mjs')).href)
    const status = await import(pathToFileURL(path.join(temporary, 'scripts', 'status.mjs')).href)
    for (const app of runner.APPS) await mkdir(path.join(temporary, 'apps', app), {recursive: true})
    const packageFile = path.join(temporary, 'apps', 'catalog', 'package.json')
    await writeFile(packageFile, JSON.stringify({scripts: {test: 'node --version'}}))
    await writeFile(path.join(temporary, 'apps', 'catalog', 'package-lock.json'), '{}')
    const testResult = () => status.collect().find(row => row.app == 'catalog').results.test
    assert.equal(testResult(), '?')
    await runner.runAll(['test', '--only=catalog'])
    assert.equal(testResult(), '✓')
    const fingerprint = runner.fingerprint('catalog')
    await writeFile(packageFile, (await readFile(packageFile, 'utf8')) + '\n')
    assert.notEqual(runner.fingerprint('catalog'), fingerprint)
    assert.equal(testResult(), '?', 'old success cannot validate changed dependencies')
    await runner.runAll(['test', '--only=catalog', '--skip=catalog'])
    assert.equal(testResult(), 'пропущено: --skip')
    const log = path.join(temporary, 'work', 'run-all', 'catalog-test.log')
    await writeFile(log, '# exit 0 2026-09-11T00:00:00Z 1\n')
    assert.equal(testResult(), '?', 'legacy logs have no proven dependency fingerprint')
    await runner.runAll(['test', '--only=catalog'])
    await writeFile(path.join(temporary, 'apps', 'catalog', 'package-lock.json'), '{"lockfileVersion":3}')
    assert.equal(testResult(), '?', 'changed lock invalidates success too')
    await writeFile(packageFile, JSON.stringify({scripts: {test: 'node -e "process.exit(7)"'}}))
    assert.equal(await runner.runAll(['test', '--only=catalog']), 1, 'failed child makes the run fail')
    assert.equal(testResult(), '✗', 'failed run cannot preserve an earlier success')
    await runner.runAll(['build', '--only=catalog'])
    assert.equal(status.collect().find(row => row.app == 'catalog').results.build, '—')
    const hostingPackage = {scripts: {typecheck: 'node --version', build: 'node --version', test: 'node --version'},
        wenayExamples: {requires: ['absent-fixture-tool']}}
    await writeFile(path.join(temporary, 'apps', 'hosting', 'package.json'), JSON.stringify(hostingPackage))
    await runner.runAll(['typecheck', 'build', 'test', '--only=hosting'])
    const hosting = status.collect().find(row => row.app == 'hosting')
    assert.equal(hosting.results.typecheck, '✓')
    assert.equal(hosting.results.build, '✓')
    assert.equal(hosting.results.test, 'пропущено: нет absent-fixture-tool')

    const row = '| catalog | 3800 | — | — | ✓ | ✓ | — | — | 1 | 123 | нет | 2026-09-26 10:00 |'
    const later = row.replace('| 1 | 123 |', '| 8 | 999 |').replace('10:00', '10:30')
    assert.equal(status.withoutStamp(row), status.withoutStamp(later))
    assert.notEqual(status.withoutStamp(row), status.withoutStamp(row.replace('✓', '✗')))
    assert.notEqual(status.withoutStamp(row), status.withoutStamp(row.replace('✓', 'пропущено: --skip')))
    assert.notEqual(status.withoutStamp(row), status.withoutStamp(row.replace('catalog', 'another')))
    assert.notEqual(status.withoutStamp(row), status.withoutStamp(row.replace('— | — | ✓', '3.1.1 | 5.0.0 | ✓')))
    console.log('PASS run-all/status: success, failure, stale fingerprint, explicit skip, absent script, legacy log and stable verification')
} finally {
    const absolute = path.resolve(temporary)
    assert(absolute.startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(absolute, {recursive: true, force: true})
}
