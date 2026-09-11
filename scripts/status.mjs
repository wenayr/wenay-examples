import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {APPS, SCRIPTS, manifest} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logDirectory = path.join(repository, 'work', 'run-all')

const MARKS = {ok: '✓', fail: '✗', missing: '—'}

function readLog(app, script) {
    const file = path.join(logDirectory, app + '-' + script + '.log')
    if (!existsSync(file)) return null
    const header = readFileSync(file, 'utf8').split('\n', 1)[0]
    const parts = header.split(' ')
    if (parts[0] != '#' || parts[1] != 'exit') return null
    return {code: Number(parts[2]), at: parts[3], seconds: Number(parts[4])}
}

// Порт объявлен в точке входа приложения как SERVICE_PORT ?? '<номер>'.
function readPort(app) {
    for (const file of ['backend/server.ts', 'backend/runtime.ts', 'backend/main.ts', 'server.mjs']) {
        const full = path.join(repository, 'apps', app, file)
        if (!existsSync(full)) continue
        const found = readFileSync(full, 'utf8').match(/PORT\s*\?\?\s*'?(\d{4})/)
        if (found) return found[1]
    }
    return '—'
}

function readDataDirectory(app) {
    const names = readdirSync(path.join(repository, 'apps', app), {withFileTypes: true})
    const data = names.filter(entry => entry.isDirectory() && /(^data$|-data$)/.test(entry.name))
    return data.length > 0 ? data.map(entry => entry.name).join(', ') : '—'
}

// Списки импортов библиотек для паспортов приложений (задача D05).
export function libraryImports(app) {
    const roots = ['backend', 'frontend', 'shared', 'organizer']
    const found = new Set()
    function walk(directory) {
        if (!existsSync(directory)) return
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const full = path.join(directory, entry.name)
            if (entry.isDirectory()) {walk(full); continue}
            if (!/\.(ts|tsx)$/.test(entry.name)) continue
            const text = readFileSync(full, 'utf8')
            for (const match of text.matchAll(/from '(wenay-(?:common2|react2)[^']*)'/g)) found.add(match[1])
        }
    }
    for (const root of roots) walk(path.join(repository, 'apps', app, root))
    return [...found].sort()
}

export function collect() {
    const rows = []
    for (const app of APPS) {
        const pkg = manifest(app)
        const results = {}
        for (const script of SCRIPTS) {
            const log = readLog(app, script)
            const declared = pkg?.scripts?.[script]
            if (!log) {results[script] = declared ? '?' : MARKS.missing; continue}
            results[script] = log.code == 0 ? MARKS.ok : MARKS.fail
        }
        const requires = pkg?.wenayExamples?.requires ?? []
        const checked = SCRIPTS.map(script => readLog(app, script)).filter(Boolean).map(log => log.at).sort().pop()
        rows.push({
            app,
            port: readPort(app),
            common2: pkg?.dependencies?.['wenay-common2'] ?? '—',
            react2: pkg?.dependencies?.['wenay-react2'] ?? '—',
            data: readDataDirectory(app),
            requires: requires.length > 0 ? requires.join(', ') : 'нет',
            results,
            checked: checked ? checked.slice(0, 16).replace('T', ' ') : 'не запускалось'
        })
    }
    return rows
}

function versionLine(rows) {
    const known = rows.filter(row => row.common2 != '—')
    const common2 = [...new Set(known.map(row => row.common2))]
    const react2 = [...new Set(known.map(row => row.react2))]
    if (common2.length == 1 && react2.length == 1) {
        return 'Текущие зависимости: **common2 ' + common2[0] + ' / react2 ' + react2[0] + '**.'
    }
    const differences = known.map(row => row.app + ' ' + row.common2 + '/' + row.react2).join(', ')
    return 'Версии библиотек расходятся между приложениями: ' + differences + '.'
}

function table(rows) {
    const lines = [
        '| Приложение | Порт | common2 | react2 | typecheck | test | build | Внешние | Проверено |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    ]
    for (const row of rows) {
        lines.push('| ' + [
            row.app, row.port, row.common2, row.react2,
            row.results.typecheck, row.results.test, row.results.build,
            row.requires, row.checked
        ].join(' | ') + ' |')
    }
    return lines.join('\n')
}

// Подстановка между маркерами: единственный источник версий для README (задача D04).
export function replaceMarked(text, marker, body) {
    const open = '<!-- ' + marker + ' -->'
    const close = '<!-- /' + marker + ' -->'
    const start = text.indexOf(open)
    const end = text.indexOf(close)
    if (start < 0 || end < 0) return text
    return text.slice(0, start + open.length) + '\n' + body + '\n' + text.slice(end)
}

function updateMarkers(rows) {
    const changed = []
    const line = versionLine(rows)
    const files = [path.join(repository, 'README.md')]
    for (const app of APPS) files.push(path.join(repository, 'apps', app, 'README.md'))
    for (const file of files) {
        if (!existsSync(file)) continue
        const before = readFileSync(file, 'utf8')
        const app = path.basename(path.dirname(file))
        const row = rows.find(item => item.app == app)
        const own = row && row.common2 != '—' ? 'Текущие зависимости: **common2 ' + row.common2 + ' / react2 ' + row.react2 + '**.' : line
        let after = replaceMarked(before, 'status:versions', file.endsWith('README.md') && row ? own : line)
        if (row) after = replaceMarked(after, 'status:imports', libraryImports(app).map(name => '`' + name + '`').join(', '))
        if (after == before) continue
        writeFileSync(file, after, 'utf8')
        changed.push(path.relative(repository, file))
    }
    return changed
}

export function write() {
    const rows = collect()
    const head = [
        '# Состояние каталога',
        '',
        'Сгенерировано `scripts/status.mjs` ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC. Не редактировать вручную.',
        '',
        versionLine(rows),
        '',
        '`✓` прошло, `✗` упало, `—` скрипта нет, `?` не запускалось. Результат берётся из последнего прогона `npm run check:all`.',
        '',
        ''
    ].join('\n')
    const file = path.join(repository, 'doc', 'STATUS.md')
    writeFileSync(file, head + table(rows) + '\n', 'utf8')
    const changed = updateMarkers(rows)
    return {rows, changed}
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const {rows, changed} = write()
    console.log(table(rows))
    console.log('')
    console.log('doc/STATUS.md обновлён.')
    if (changed.length > 0) console.log('Маркеры обновлены: ' + changed.join(', '))
}
