import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logDirectory = path.join(repository, 'work', 'run-all')

// Порядок появления приложений. Используется везде, где каталог перебирается целиком.
export const APPS = [
    'pizzeria', 'hosting', 'support', 'documents', 'metering', 'crm',
    'booking', 'forms', 'monitoring', 'content', 'catalog', 'approvals', 'chat'
]
export const SCRIPTS = ['typecheck', 'test', 'build']

const externalTools = {
    docker: ['docker', ['info']],
    python3: ['python3', ['--version']],
    python: ['python', ['--version']]
}

export function manifest(app) {
    const file = path.join(repository, 'apps', app, 'package.json')
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
}

function run(command, args, options) {
    return new Promise(function wait(resolve) {
        const child = spawn(command, args, {shell: true, ...options})
        let output = ''
        child.stdout?.on('data', chunk => {output += chunk})
        child.stderr?.on('data', chunk => {output += chunk})
        child.on('error', function failed(error) {resolve({code: 1, output: output + error.message})})
        child.on('close', code => resolve({code: code ?? 1, output}))
    })
}

const toolCache = new Map()

async function hasTool(name) {
    if (toolCache.has(name)) return toolCache.get(name)
    const tool = externalTools[name]
    let available = false
    if (tool) {
        const result = await run(tool[0], tool[1], {cwd: repository})
        available = result.code == 0
    }
    // python3 отсутствует в типовой установке Windows; засчитываем python той же версии.
    if (!available && name == 'python3') available = await hasTool('python')
    toolCache.set(name, available)
    return available
}

async function missingTool(app, script) {
    if (script != 'test') return ''
    const required = manifest(app)?.wenayExamples?.requires ?? []
    for (const name of required) {
        if (!await hasTool(name)) return name
    }
    return ''
}

export function fingerprint(app) {
    const hash = createHash('sha256')
    for (const name of ['package.json', 'package-lock.json']) {
        const file = path.join(repository, 'apps', app, name)
        hash.update(name + '\n')
        hash.update(existsSync(file) ? readFileSync(file) : 'missing')
    }
    return hash.digest('hex')
}

function writeLog(app, script, code, seconds, output, status, checkedFingerprint) {
    mkdirSync(logDirectory, {recursive: true})
    const file = path.join(logDirectory, app + '-' + script + '.log')
    const header = '# result ' + JSON.stringify({code, at: new Date().toISOString(), seconds, status, fingerprint: checkedFingerprint})
    writeFileSync(file, header + '\n' + output, 'utf8')
    return path.relative(repository, file)
}

async function execute(app, script) {
    const started = Date.now()
    const declared = manifest(app)?.scripts?.[script]
    const checkedFingerprint = fingerprint(app)
    if (!declared) {
        const log = writeLog(app, script, null, 0, '', 'нет', checkedFingerprint)
        return {status: 'нет', seconds: 0, log}
    }
    const blocked = await missingTool(app, script)
    if (blocked) {
        const status = 'пропущено: нет ' + blocked
        const log = writeLog(app, script, null, 0, '', status, checkedFingerprint)
        return {status, seconds: 0, log}
    }
    const cwd = path.join(repository, 'apps', app)
    const result = await run('npm', ['run', script], {cwd})
    const seconds = (Date.now() - started) / 1000
    const status = result.code == 0 ? 'ok' : 'fail(' + result.code + ')'
    const log = writeLog(app, script, result.code, seconds, result.output, status, checkedFingerprint)
    return {status, seconds, log}
}

function parse(argv) {
    const scripts = argv.filter(value => !value.startsWith('--'))
    const flag = name => argv.find(value => value.startsWith('--' + name + '='))?.split('=')[1] ?? ''
    const list = value => value.split(',').map(item => item.trim()).filter(Boolean)
    const skip = list(flag('skip') + ',' + (process.env.RUN_ALL_SKIP ?? ''))
    const only = list(flag('only'))
    const unknown = scripts.filter(script => !SCRIPTS.includes(script))
    if (unknown.length > 0) throw new Error('Неизвестный скрипт: ' + unknown.join(', ') + '. Допустимы: ' + SCRIPTS.join(', '))
    return {scripts: scripts.length > 0 ? scripts : SCRIPTS, skip, only, stop: !argv.includes('--continue') && argv.includes('--stop')}
}

export async function runAll(argv) {
    const options = parse(argv)
    const selected = APPS.filter(function chosen(app) {
        if (options.only.length > 0 && !options.only.includes(app)) return false
        return true
    })
    const rows = []
    let failed = 0
    for (const app of selected) {
        for (const script of options.scripts) {
            let result
            if (options.skip.includes(app)) {
                const status = 'пропущено: --skip'
                const log = writeLog(app, script, null, 0, '', status, fingerprint(app))
                result = {status, seconds: 0, log}
            } else result = await execute(app, script)
            rows.push({app, script, ...result})
            if (result.status.startsWith('fail')) failed++
            console.log([app, script, result.status, result.seconds.toFixed(1) + ' c'].join(' · '))
            if (failed > 0 && options.stop) break
        }
        if (failed > 0 && options.stop) break
    }
    const width = {app: 12, script: 10, status: 22}
    const pad = (value, size) => String(value).padEnd(size)
    console.log('')
    console.log(pad('Приложение', width.app) + pad('Скрипт', width.script) + pad('Статус', width.status) + 'Секунды  Лог')
    for (const row of rows) {
        const cells = pad(row.app, width.app) + pad(row.script, width.script) + pad(row.status, width.status)
        console.log(cells + pad(row.seconds.toFixed(1), 9) + row.log)
    }
    console.log('')
    console.log('Всего: ' + rows.length + ', с ошибкой: ' + failed)
    return failed
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    runAll(process.argv.slice(2)).then(function finished(failed) {
        process.exitCode = failed > 0 ? 1 : 0
    }).catch(function crashed(error) {
        console.error(error.message)
        process.exitCode = 1
    })
}
