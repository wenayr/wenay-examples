import {execFile, spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {fingerprint} from './run-all.mjs'

const exec = promisify(execFile)
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hosting = path.join(repository, 'apps', 'hosting')
const reportDirectory = path.join(repository, 'work', 'hosting-live')
const products = ['support', 'metering', 'documents', 'crm', 'booking', 'forms', 'monitoring', 'approvals', 'content']
const digestPattern = /@sha256:[a-f0-9]{64}$/
export const dependencyLabel = 'org.wenay.examples.dependencies'

export const steps = [
    ...['organizer', 'pizzeria'].map(id => ({id, script: 'test:public-address', env: {HOSTING_APP_KIND: id}})),
    ...products.map(id => ({id, script: 'test:' + id, env: {}})),
    {id: 'runtime', script: 'test:docker', env: {}}
]

export function selectSteps(argv) {
    const only = argv.find(value => value.startsWith('--only='))?.slice('--only='.length)
    const requested = only?.split(',').filter(Boolean)
    const knownFlag = value => value.startsWith('--only=') || value.startsWith('--images=') || ['--plan', '--include-runtime'].includes(value)
    const unknown = argv.filter(value => !knownFlag(value))
    if (unknown.length) throw new Error('Неизвестные параметры: ' + unknown.join(', '))
    if (requested?.some(id => !steps.some(step => step.id == id))) throw new Error('Неизвестный live-сценарий: ' + only)
    if (only != null && !requested.length) throw new Error('--only требует хотя бы один сценарий')
    return steps.filter(step => requested ? requested.includes(step.id) : step.id != 'runtime' || argv.includes('--include-runtime'))
}

export function gateExitCode(rows) {
    if (rows.some(row => row.status == 'fail')) return 1
    return rows.some(row => row.status == 'skip') ? 2 : 0
}

export function productImagesFile(argv) {
    const file = argv.find(value => value.startsWith('--images='))?.slice('--images='.length)
    if (file != null && !path.isAbsolute(file)) throw new Error('--images требует абсолютный путь к JSON образов')
    return file
}

export function inspectImageEvidence({reference, image, expectedDependencies, requireDigestReference = false}) {
    const digest = image?.RepoDigests?.[0]
    if (!digestPattern.test(digest ?? '')) return {reason: 'нет manifest RepoDigest у ' + reference}
    if (requireDigestReference && !digestPattern.test(reference)) {
        return {reason: 'prepared reference не закреплён digest: ' + reference}
    }
    const dependencies = image?.Config?.Labels?.[dependencyLabel]
    if (expectedDependencies != null && !dependencies) {
        return {reason: 'image dependencies not verified: нет ' + dependencyLabel + ' у ' + reference}
    }
    if (expectedDependencies != null && dependencies != expectedDependencies) {
        return {reason: 'image dependencies stale: fingerprint package+lock не совпадает у ' + reference}
    }
    return {evidence: {reference, digest, id: image.Id, dependencies}}
}

async function readPrepared(name, file) {
    try {return JSON.parse(await readFile(file ?? path.join(hosting, 'data', name), 'utf8'))}
    catch {return {}}
}

async function inspectImages(step, docker, env) {
    let references
    if (step.id == 'runtime') {
        const prepared = await readPrepared('example-images.json')
        references = [env.HOSTING_NODE_IMAGE ?? prepared.node, env.HOSTING_PYTHON_IMAGE ?? prepared.python]
    } else if (step.script == 'test:public-address') {
        const prepared = await readPrepared('product-images.json', env.HOSTING_PRODUCT_IMAGES_FILE)
        // The existing check reads this JSON even when its first-image override is set.
        const imagesFile = env.HOSTING_PRODUCT_IMAGES_FILE ?? 'hosting/data/product-images.json'
        if (!Object.keys(prepared).length) return {reason: 'нет доступного product-images JSON: ' + imagesFile}
        references = [env.HOSTING_ORGANIZER_IMAGE ?? prepared[step.id + '-first'], prepared[step.id + '-second']]
    } else references = ['first', 'second'].map(release => 'wenay-examples.local/' + step.id + ':' + release)
    if (references.some(reference => !reference)) return {reason: 'не подготовлены оба образа для ' + step.id}
    const application = step.script == 'test:public-address' ? 'pizzeria' : step.id
    const expectedDependencies = step.id == 'runtime' ? undefined : fingerprint(application)
    const images = []
    for (const reference of references) {
        try {
            const result = await exec(docker, ['image', 'inspect', reference], {env, windowsHide: true, timeout: 15000})
            const image = JSON.parse(result.stdout)[0]
            const checked = inspectImageEvidence({
                reference, image, expectedDependencies,
                requireDigestReference: step.script == 'test:public-address' || step.id == 'runtime'
            })
            if (checked.reason) return {reason: checked.reason}
            images.push(checked.evidence)
        } catch {return {reason: 'локальный образ недоступен: ' + reference}}
    }
    return {images}
}

function runStep(step, env) {
    return new Promise(function completed(resolve) {
        const child = spawn('npm', ['run', step.script], {
            cwd: hosting, env: {...env, ...step.env}, shell: process.platform == 'win32', windowsHide: true
        })
        let output = ''
        child.stdout?.on('data', function stdout(chunk) {
            output += chunk
            process.stdout.write(chunk)
        })
        child.stderr?.on('data', function stderr(chunk) {
            output += chunk
            process.stderr.write(chunk)
        })
        child.on('error', error => resolve({code: 1, output: output + error.message}))
        child.on('close', code => resolve({code: code ?? 1, output}))
    })
}

async function main(argv) {
    const selected = selectSteps(argv)
    const imagesFile = productImagesFile(argv)
    if (argv.includes('--plan')) {
        for (const step of selected) console.log(step.id + ' · npm run ' + step.script + ' · ' + JSON.stringify(step.env))
        if (imagesFile) console.log('Product images JSON: ' + imagesFile)
        console.log('PLAN ONLY: Docker, images, tests and log files were not touched.')
        return 0
    }
    const env = {...process.env}
    if (imagesFile) env.HOSTING_PRODUCT_IMAGES_FILE = imagesFile
    const docker = env.DOCKER_BIN ?? 'docker'
    const pathKey = Object.keys(env).find(key => key.toLowerCase() == 'path') ?? 'PATH'
    if (path.isAbsolute(docker)) env[pathKey] = path.dirname(docker) + path.delimiter + (env[pathKey] ?? '')
    let dockerReason = ''
    try {
        const info = await exec(docker, ['info', '--format', '{{.OSType}}'], {env, windowsHide: true, timeout: 15000})
        if (info.stdout.trim() != 'linux') dockerReason = 'нужен Linux Docker Engine'
    } catch {dockerReason = 'Docker Engine недоступен (docker info)'}
    console.log('Docker: ' + (dockerReason || 'Linux Engine available'))
    console.log('Python: documents uses /usr/bin/python3 inside its image; host DOCUMENT_PYTHON is not a live prerequisite.')
    await mkdir(reportDirectory, {recursive: true})
    const rows = []
    const initialReport = {at: new Date().toISOString(), complete: false, selected: selected.map(step => step.id), rows}
    await writeFile(path.join(reportDirectory, 'report.json'), JSON.stringify(initialReport, null, 4), 'utf8')
    let failed = false
    for (const step of selected) {
        const started = Date.now()
        let application = products.includes(step.id) ? step.id : 'pizzeria'
        if (step.id == 'runtime') application = 'hosting'
        const row = {
            id: step.id, script: step.script, status: 'skip', reason: '', seconds: 0,
            fingerprint: {hosting: fingerprint('hosting'), application: fingerprint(application)}
        }
        if (failed) row.reason = 'не запускалось после ошибки предыдущего сценария'
        else if (dockerReason) row.reason = dockerReason
        else {
            const inspected = await inspectImages(step, docker, env)
            if (inspected.reason) row.reason = inspected.reason
            else {
                row.images = inspected.images
                console.log('\nLIVE ' + step.id + ' · npm run ' + step.script)
                const result = await runStep(step, env)
                row.code = result.code
                row.status = result.code == 0 ? 'pass' : 'fail'
                row.reason = result.code == 0 ? '' : 'npm exit ' + result.code
                row.log = path.relative(repository, path.join(reportDirectory, step.id + '.log'))
                await writeFile(path.join(reportDirectory, step.id + '.log'), result.output, 'utf8')
                failed = row.status == 'fail'
            }
        }
        row.seconds = (Date.now() - started) / 1000
        rows.push(row)
        console.log(step.id + ' · ' + row.status + ' · ' + row.seconds.toFixed(1) + ' s' + (row.reason ? ' · ' + row.reason : ''))
        // Preserve a partial report if a later scenario fails or the run is interrupted.
        const report = {at: new Date().toISOString(), complete: false, selected: selected.map(step => step.id), rows}
        await writeFile(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 4), 'utf8')
    }
    const code = gateExitCode(rows)
    const report = {at: new Date().toISOString(), complete: true, code, selected: selected.map(step => step.id), rows}
    await writeFile(path.join(reportDirectory, 'report.json'), JSON.stringify(report, null, 4), 'utf8')
    const outcome = {0: 'PASS selected scenarios', 1: 'FAIL'}[code] ?? 'INCOMPLETE: skipped prerequisites'
    console.log('\nLive gate: ' + outcome)
    console.log('Report: ' + path.relative(repository, path.join(reportDirectory, 'report.json')))
    return code
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(code => {process.exitCode = code}).catch(function failed(error) {
        console.error(error.message)
        process.exitCode = 1
    })
}
