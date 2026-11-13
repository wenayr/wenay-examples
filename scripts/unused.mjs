import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {APPS, manifest} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['backend', 'frontend', 'shared', 'organizer', 'scripts']
const sourceExtensions = ['.ts', '.tsx', '.mjs', '.js']

function appFiles(app) {
    const found = []
    function walk(directory) {
        if (!existsSync(directory)) return
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const full = path.join(directory, entry.name)
            if (entry.isDirectory()) {
                walk(full)
                continue
            }
            if (sourceExtensions.includes(path.extname(entry.name))) found.push(full)
        }
    }
    for (const root of roots) walk(path.join(repository, 'apps', app, root))
    return found
}

// Точки входа: скрипты package.json, Dockerfile, html и manifest scaffold.
function entryPoints(app) {
    const base = path.join(repository, 'apps', app)
    const found = new Set()
    const add = relative => {
        const full = path.resolve(base, relative)
        if (existsSync(full)) found.add(full)
    }
    for (const command of Object.values(manifest(app)?.scripts ?? {})) {
        for (const match of command.matchAll(/(?:tsx|node)\s+([\w./-]+\.(?:tsx|ts|mjs|js))/g)) add(match[1])
        for (const match of command.matchAll(/vite(?:\s+build)?\s+([\w./-]+)/g)) add(match[1] + '/vite.config.ts')
    }
    for (const file of ['Dockerfile', 'frontend/index.html', 'organizer/index.html']) {
        const full = path.join(base, file)
        if (!existsSync(full)) continue
        const text = readFileSync(full, 'utf8')
        // В index.html путь `/main.tsx` означает корень самого фронтенда, а не диска.
        const directory = path.dirname(file)
        for (const match of text.matchAll(/(?:src|COPY|CMD)[^\n]*?["'\s]([\w./-]+\.(?:tsx|ts|mjs|js))/g)) {
            add(file.endsWith('.html') ? path.join(directory, match[1].replace(/^\//, '')) : match[1])
        }
        if (file.endsWith('index.html')) add(directory + '/vite.config.ts')
    }
    for (const relative of scaffoldManifest(app)) {
        if (sourceExtensions.includes(path.extname(relative))) add(relative)
    }
    return found
}

function scaffoldManifest(app) {
    const file = path.join(repository, 'scripts', 'create-saas-example.mjs')
    const text = readFileSync(file, 'utf8')
    const block = text.match(new RegExp('\\n    ' + app + ': \\[[\\s\\S]*?\\n    \\],'))
    if (!block) return []
    return [...block[0].matchAll(/'([\w./-]+)'/g)].map(match => match[1])
}

function resolveImport(from, target) {
    const base = path.resolve(path.dirname(from), target)
    const candidates = [base + '.ts', base + '.tsx', base + '.mjs', base + '.js', base, path.join(base, 'index.ts')]
    return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

function localImports(file) {
    const text = readFileSync(file, 'utf8')
    const found = []
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) found.push(match[1])
    for (const match of text.matchAll(/require\('(\.[^']+)'\)/g)) found.push(match[1])
    // Дочерний процесс запускается по имени файла, а не импортом:
    // createProcess({script: 'serving-node.ts'}), boot('leader-pizzeria.ts').
    for (const match of text.matchAll(/'([\w-]+\.(?:tsx|ts|mjs|js))'/g)) found.push('./' + match[1])
    return found
}

export function reachable(app) {
    const seen = new Set()
    const queue = [...entryPoints(app)]
    while (queue.length > 0) {
        const file = queue.pop()
        if (seen.has(file)) continue
        seen.add(file)
        if (!sourceExtensions.includes(path.extname(file))) continue
        for (const target of localImports(file)) {
            const resolved = resolveImport(file, target)
            if (resolved && !seen.has(resolved)) queue.push(resolved)
        }
    }
    return seen
}

export function unusedFiles(app) {
    const live = reachable(app)
    // Объявления окружения подключает компилятор через tsconfig, а не импорт.
    const candidates = appFiles(app).filter(file => !live.has(file) && !file.endsWith('.d.ts'))
    return candidates.map(file => path.relative(repository, file).replaceAll('\\', '/'))
}

// Библиотеки объявляют часть пакетов как peer: транспорт, документацию и таблицы
// приложение обязано поставить само, хотя импортирует их библиотека, а не оно.
function peerDependencies(app) {
    const found = new Set()
    for (const library of ['wenay-common2', 'wenay-react2']) {
        const file = path.join(repository, 'apps', app, 'node_modules', library, 'package.json')
        if (!existsSync(file)) continue
        for (const name of Object.keys(JSON.parse(readFileSync(file, 'utf8')).peerDependencies ?? {})) found.add(name)
    }
    return found
}

// Зависимость использована при импорте из исходников, при упоминании её бинарника
// в скриптах package.json или при объявлении её peer-зависимостью библиотеки.
export function unusedDependencies(app) {
    const pkg = manifest(app)
    if (!pkg) return []
    const text = appFiles(app).map(file => readFileSync(file, 'utf8')).join('\n')
    const commands = Object.values(pkg.scripts ?? {}).join(' ')
    const peers = peerDependencies(app)
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    return names.filter(function unused(name) {
        if (text.includes("'" + name + "'") || text.includes("'" + name + "/")) return false
        if (new RegExp('(^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(commands)) return false
        if (peers.has(name)) return false
        // Пакеты типов подключает компилятор, а не импорт.
        if (name.startsWith('@types/') || name == 'typescript') return false
        return true
    })
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    for (const app of APPS) {
        if (!manifest(app)) continue
        const files = unusedFiles(app)
        const dependencies = unusedDependencies(app)
        if (files.length == 0 && dependencies.length == 0) {
            console.log(app + ': чисто')
            continue
        }
        console.log(app + ':')
        for (const file of files) console.log('  файл вне графа: ' + file)
        for (const name of dependencies) console.log('  зависимость без импорта: ' + name)
    }
}
