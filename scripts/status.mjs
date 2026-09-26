import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {APPS, SCRIPTS, manifest, fingerprint} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const logDirectory = path.join(repository, 'work', 'run-all')

const MARKS = {ok: '✓', fail: '✗', missing: '—'}

function readLog(app, script) {
    const file = path.join(logDirectory, app + '-' + script + '.log')
    if (!existsSync(file)) return null
    const header = readFileSync(file, 'utf8').split('\n', 1)[0]
    if (!header.startsWith('# result ')) return null
    try {
        const result = JSON.parse(header.slice('# result '.length))
        if (result.fingerprint != fingerprint(app)) return null
        if (typeof result.status != 'string' || typeof result.at != 'string') return null
        return result
    } catch {
        return null
    }
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
            if (entry.isDirectory()) {
                walk(full)
                continue
            }
            if (!/\.(ts|tsx)$/.test(entry.name)) continue
            const text = readFileSync(full, 'utf8')
            for (const match of text.matchAll(/from '(wenay-(?:common2|react2|calls)[^']*)'/g)) found.add(match[1])
        }
    }
    for (const root of roots) walk(path.join(repository, 'apps', app, root))
    return [...found].sort()
}


// Manifest identifies the current graph even when obsolete output files remain nearby.
export function measureBundle(roots) {
    const initialFiles = new Set()
    const allFiles = new Set()
    let complete = true
    for (const root of roots) {
        const page = path.join(root, 'index.html')
        if (!existsSync(page)) {
            complete = false
            continue
        }
        const html = readFileSync(page, 'utf8')
        const direct = [...html.matchAll(/(?:src|href)=["']\/?([\w./-]+\.(?:js|css))["']/g)].map(match => match[1])
        function asset(file) {
            const resolved = path.resolve(root, file)
            const relative = path.relative(root, resolved)
            if (relative == '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                throw new Error('Bundle path escapes output: ' + file)
            }
            if (!existsSync(resolved)) throw new Error('Bundle asset missing: ' + resolved)
            return resolved
        }
        const manifestFile = path.join(root, '.vite', 'manifest.json')
        for (const file of direct) initialFiles.add(asset(file))
        if (!existsSync(manifestFile)) {
            complete = false
            continue
        }
        const graph = JSON.parse(readFileSync(manifestFile, 'utf8'))
        const entries = Object.keys(graph).filter(key => direct.includes(graph[key].file))
        if (direct.some(file => file.endsWith('.js') && !entries.some(key => graph[key].file == file))) {
            throw new Error('HTML entry missing from bundle manifest: ' + manifestFile)
        }
        function walk(includeDynamic, files) {
            const visited = new Set()
            function visit(key) {
                if (visited.has(key)) return
                visited.add(key)
                const chunk = graph[key]
                if (!chunk) throw new Error('Bundle manifest references missing chunk: ' + key)
                if (/\.(js|css)$/.test(chunk.file)) files.add(asset(chunk.file))
                for (const css of chunk.css ?? []) files.add(asset(css))
                for (const imported of chunk.imports ?? []) visit(imported)
                if (includeDynamic) for (const imported of chunk.dynamicImports ?? []) visit(imported)
            }
            for (const entry of entries) visit(entry)
        }
        walk(false, initialFiles)
        for (const file of direct) allFiles.add(asset(file))
        walk(true, allFiles)
    }
    function bytes(files) {return [...files].reduce((sum, file) => sum + statSync(file).size, 0)}
    const largest = complete ? Math.max(0, ...[...allFiles].map(file => statSync(file).size)) : 0
    return {total: complete ? bytes(allFiles) : 0, initial: bytes(initialFiles), largest, complete}
}

function readBundle(app) {
    const roots = [path.join(repository, 'apps', app, 'public')]
    if (app == 'pizzeria') roots.push(path.join(repository, 'apps', app, 'organizer-public'))
    return measureBundle(roots)
}

export function collect() {
    const rows = []
    for (const app of APPS) {
        const pkg = manifest(app)
        const results = {}
        for (const script of SCRIPTS) {
            const log = readLog(app, script)
            const declared = pkg?.scripts?.[script]
            if (!log) {
                results[script] = declared ? '?' : MARKS.missing
                continue
            }
            if (log.status.startsWith('пропущено:')) results[script] = log.status
            else if (log.status == 'нет') results[script] = MARKS.missing
            else results[script] = log.status == 'ok' && log.code == 0 ? MARKS.ok : MARKS.fail
        }
        const requires = pkg?.wenayExamples?.requires ?? []
        // Живая проверка копии и восстановления есть не у всех приложений.
        const backup = existsSync(path.join(repository, 'apps', app, 'backend', 'backup-check.ts'))
        const times = SCRIPTS.map(script => readLog(app, script)).filter(Boolean)
        const checked = times.map(log => log.at).sort().pop()
        const test = readLog(app, 'test')
        const bundle = readBundle(app)
        rows.push({
            app,
            port: readPort(app),
            common2: pkg?.dependencies?.['wenay-common2'] ?? '—',
            react2: pkg?.dependencies?.['wenay-react2'] ?? '—',
            data: readDataDirectory(app),
            requires: requires.length > 0 ? requires.join(', ') : 'нет',
            backup: backup ? MARKS.ok : MARKS.missing,
            seconds: test?.status == 'ok' ? Math.round(test.seconds) : 0,
            bundle,
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
        '| Приложение | Порт | common2 | react2 | typecheck | test | build | Копия | Тест, с | Сборка, КБ | Внешние | Проверено |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    ]
    for (const row of rows) {
        lines.push('| ' + [
            row.app, row.port, row.common2, row.react2,
            row.results.typecheck, row.results.test, row.results.build,
            row.backup,
            row.seconds > 0 ? String(row.seconds) : MARKS.missing,
            row.bundle.total > 0 ? String(Math.round(row.bundle.total / 1024)) : MARKS.missing,
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

// `apply` разделяет режимы: обычный запуск переписывает файлы, --verify только сравнивает.
function updateMarkers(rows, apply) {
    const changed = []
    const line = versionLine(rows)
    const files = [path.join(repository, 'README.md')]
    for (const app of APPS) {
        files.push(path.join(repository, 'apps', app, 'README.md'))
        files.push(path.join(repository, 'apps', app, 'PASSPORT.md'))
    }
    for (const file of files) {
        if (!existsSync(file)) continue
        const before = readFileSync(file, 'utf8')
        const app = path.basename(path.dirname(file))
        const row = rows.find(item => item.app == app)
        const passport = path.basename(file) == 'PASSPORT.md'
        const known = row && row.common2 != '—'
        const own = known ? 'Текущие зависимости: **common2 ' + row.common2 + ' / react2 ' + row.react2 + '**.' : line
        // В паспорте строки версий нет: там только список импортов библиотек.
        let after = before
        if (!passport) after = replaceMarked(before, 'status:versions', row ? own : line)
        if (row) after = replaceMarked(after, 'status:imports', libraryImports(app).map(name => '`' + name + '`').join(', '))
        if (after == before) continue
        if (apply) writeFileSync(file, after, 'utf8')
        changed.push(path.relative(repository, file))
    }
    return changed
}

const statusFile = path.join(repository, 'doc', 'STATUS.md')

// Максимум относится к отдельному файлу: отложенная загрузка не уменьшает полный граф.
function bundleNote(rows) {
    const largest = rows.map(row => row.bundle.largest).sort((a, b) => b - a)[0] ?? 0
    if (largest == 0) return 'Сборок нет: столбец размера заполнится после `npm run build:all`.'
    const value = Math.round(largest / 1024)
    const warning = value > 500 ? ' Vite предупреждает о файлах больше 500 КБ; начальный и полный вес сравниваются через `npm run status:bundles`.' : ''
    return 'Самый большой файл сборки сейчас ' + value + ' КБ.' + warning
}

function render(rows, stamp) {
    const head = [
        '# Состояние каталога',
        '',
        'Сгенерировано `scripts/status.mjs` ' + stamp + ' UTC. Не редактировать вручную.',
        '',
        versionLine(rows),
        '',
        '`✓` прошло, `✗` упало, `—` скрипта нет, `?` нет результата для текущих package.json и lock. Пропуски указаны явно.',
        'Колонка «Копия» — есть ли у приложения живая проверка холодной копии и восстановления (`npm run test:backup`).',
        'Колонки «Тест, с» и «Сборка, КБ» — длительность последнего `npm test` и полный достижимый JS/CSS граф текущего HTML по Vite manifest, без сжатия.',
        'Граф включает static и dynamic imports и их CSS; старые и недостижимые файлы исключены. У пиццерии суммируются два UI. Без manifest вес неизвестен (—).',
        bundleNote(rows),
        '',
        ''
    ].join('\n')
    return head + table(rows) + '\n'
}

// Отметка времени меняется при каждом запуске, поэтому сравнению не подлежит.
export function withoutStamp(text) {
    return text.replace(/^Сгенерировано .*$/m, '')
        .replace(/^Самый большой файл сборки сейчас .*$/m, '')
        .replace(/^Сборок нет: .*$/m, '')
        .split('\n').map(function stableRow(line) {
            if (!line.startsWith('| ') || line.startsWith('| ---') || line.startsWith('| Приложение')) return line
            const cells = line.split('|')
            if (cells.length != 14) return line
            // Время, текущий размер сборки и дата запуска не определяют результат проверки.
            for (const index of [9, 10, 12]) cells[index] = ''
            return cells.join('|')
        }).join('\n')
}

export function write() {
    const rows = collect()
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    writeFileSync(statusFile, render(rows, stamp), 'utf8')
    const changed = updateMarkers(rows, true)
    return {rows, changed}
}

// В check:all скрипт запускается с --verify: он не должен ничего менять.
// Расхождение означает, что таблицу или версии правили руками и забыли перегенерировать.
function verify() {
    const rows = collect()
    const changed = updateMarkers(rows, false)
    const current = existsSync(statusFile) ? readFileSync(statusFile, 'utf8') : ''
    if (withoutStamp(current) != withoutStamp(render(rows, ''))) changed.unshift('doc/STATUS.md')
    if (changed.length == 0) return 0
    console.log('Устарело: ' + changed.join(', '))
    console.log('Запустите npm run status и закоммитьте результат.')
    return 1
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    if (process.argv.includes('--bundles')) {
        console.log('Приложение/UI · начальный JS/CSS, КиБ · полный JS/CSS, КиБ')
        for (const app of APPS) {
            if (!manifest(app)?.scripts?.build) continue
            const names = app == 'pizzeria' ? ['public', 'organizer-public'] : ['public']
            for (const name of names) {
                const bundle = measureBundle([path.join(repository, 'apps', app, name)])
                const initial = (bundle.initial / 1024).toFixed(1) + (bundle.complete ? '' : ' (неполный граф)')
                const total = bundle.complete ? (bundle.total / 1024).toFixed(1) : '— (нужна сборка с manifest)'
                console.log(app + '/' + name + ' · ' + initial + ' · ' + total)
            }
        }
    } else if (process.argv.includes('--verify')) {
        process.exitCode = verify()
    } else {
        const {rows, changed} = write()
        console.log(table(rows))
        console.log('')
        console.log('doc/STATUS.md обновлён.')
        if (changed.length > 0) console.log('Маркеры обновлены: ' + changed.join(', '))
    }
}
