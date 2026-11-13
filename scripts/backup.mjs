import {createHash} from 'node:crypto'
import {createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {manifest as packageOf} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FORMAT = 'wenay-cold-backup-1'
const MANIFEST = 'manifest.json'
const COMPLETE = 'complete'

// Каталог данных приложения объявлен в его точке входа как SERVICE_DATA_DIR ?? '<имя>'.
export function dataDirectory(app) {
    for (const file of ['backend/server.ts', 'backend/main.ts']) {
        const full = path.join(repository, 'apps', app, file)
        if (!existsSync(full)) continue
        const found = readFileSync(full, 'utf8').match(/SERVICE_DATA_DIR\s*\?\?\s*path\.resolve\('([\w.-]+)'\)/)
        if (found) return found[1]
    }
    return ''
}

function walk(root, prefix = '') {
    const found = []
    for (const entry of readdirSync(path.join(root, prefix), {withFileTypes: true})) {
        const relative = prefix ? prefix + '/' + entry.name : entry.name
        if (entry.isSymbolicLink()) throw new Error('Ссылка в каталоге данных не копируется: ' + relative)
        if (entry.isDirectory()) {
            found.push(...walk(root, relative))
            continue
        }
        if (!entry.isFile()) throw new Error('Необычный элемент в каталоге данных: ' + relative)
        found.push(relative)
    }
    return found
}

function digestOf(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Копия холодная: писателя быть не должно. Открытый порт приложения — верный
// признак, что он жив; закрытый порт сам по себе ничего не доказывает.
async function portBusy(port) {
    if (!port || port == '—') return false
    try {
        const signal = AbortSignal.timeout(700)
        await fetch('http://127.0.0.1:' + port + '/health', {signal})
        return true
    } catch {
        return false
    }
}

export async function backup(options) {
    const {app, destination, stopped} = options
    const pkg = packageOf(app)
    if (!pkg) throw new Error('Неизвестное приложение: ' + app)
    const directory = dataDirectory(app)
    if (!directory) throw new Error('У приложения ' + app + ' не найден каталог данных')
    // По умолчанию берём каталог данных приложения; --from указывает другой запуск.
    const source = options.from ? path.resolve(repository, options.from) : path.join(repository, 'apps', app, directory)
    if (!existsSync(source)) throw new Error('Каталог данных не создан: ' + path.relative(repository, source))

    const port = options.port ?? ''
    if (await portBusy(port)) throw new Error('Приложение отвечает на порту ' + port + '. Остановите его и его исполнителей')
    if (!stopped) throw new Error('Подтвердите остановку писателя и фоновых исполнителей флагом --i-stopped-it')

    const target = path.resolve(repository, destination)
    if (existsSync(target) && readdirSync(target).length > 0) throw new Error('Каталог назначения должен быть пустым: ' + destination)
    if (target == source || target.startsWith(source + path.sep)) throw new Error('Копия не может лежать внутри исходного каталога')

    const files = walk(source).sort()
    mkdirSync(path.join(target, 'data'), {recursive: true})
    const records = []
    for (const relative of files) {
        const from = path.join(source, relative)
        const to = path.join(target, 'data', relative)
        mkdirSync(path.dirname(to), {recursive: true})
        await pipeline(createReadStream(from), createWriteStream(to))
        records.push({path: relative, size: statSync(to).size, sha256: digestOf(to)})
    }

    // Повторная сверка после копирования: неполная копия не должна выглядеть годной.
    for (const record of records) {
        const copy = path.join(target, 'data', record.path)
        if (digestOf(copy) != record.sha256) throw new Error('Копия файла отличается от исходной: ' + record.path)
    }

    const body = {
        format: FORMAT,
        app,
        dataDirectory: directory,
        dataVersion: options.dataVersion ?? '',
        libraries: {
            common2: pkg.dependencies?.['wenay-common2'] ?? '',
            react2: pkg.dependencies?.['wenay-react2'] ?? ''
        },
        takenAt: new Date().toISOString(),
        files: records
    }
    writeFileSync(path.join(target, MANIFEST), JSON.stringify(body, null, 4) + '\n', 'utf8')
    // Признак завершённой копии пишется последним.
    writeFileSync(path.join(target, COMPLETE), body.takenAt + '\n', 'utf8')
    return {files: records.length, bytes: records.reduce((sum, item) => sum + item.size, 0), manifest: body}
}

function flag(name) {
    return process.argv.find(value => value.startsWith('--' + name + '='))?.split('=')[1] ?? ''
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const [app, destination] = process.argv.slice(2).filter(value => !value.startsWith('--'))
    if (!app || !destination) {
        console.log('Использование: node scripts/backup.mjs <приложение> <пустой каталог> --i-stopped-it [--from=каталог] [--port=NNNN] [--data-version=X]')
        process.exitCode = 1
    } else {
        const stopped = process.argv.includes('--i-stopped-it')
        backup({app, destination, stopped, from: flag('from'), port: flag('port'), dataVersion: flag('data-version')}).then(function done(result) {
            console.log('Скопировано файлов: ' + result.files + ', байт: ' + result.bytes)
            console.log('Копия готова: ' + destination)
        }).catch(function failed(error) {
            console.error(error.message)
            process.exitCode = 1
        })
    }
}
