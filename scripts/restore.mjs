import {createHash} from 'node:crypto'
import {createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {FORMAT} from './backup.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function digestOf(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Путь из manifest не должен уводить за пределы каталога восстановления.
function safeRelative(value) {
    if (!value || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) return false
    if (value.includes('\\')) return false
    return !value.split('/').some(part => part == '' || part == '.' || part == '..')
}

export async function restore(options) {
    const {source, destination} = options
    const from = path.resolve(repository, source)
    const to = path.resolve(repository, destination)
    if (!existsSync(path.join(from, 'complete'))) throw new Error('Копия не завершена: нет признака complete')
    const body = JSON.parse(readFileSync(path.join(from, 'manifest.json'), 'utf8'))
    if (body.format != FORMAT) throw new Error('Неизвестный формат копии: ' + body.format)
    if (options.dataVersion && body.dataVersion && options.dataVersion != body.dataVersion) {
        throw new Error('Формат данных копии ' + body.dataVersion + ' не совпадает с ожидаемым ' + options.dataVersion)
    }
    if (existsSync(to) && readdirSync(to).length > 0) throw new Error('Каталог восстановления должен быть пустым: ' + destination)
    if (to == from || to.startsWith(from + path.sep) || from.startsWith(to + path.sep)) {
        throw new Error('Каталог восстановления не должен пересекаться с копией')
    }

    const seen = new Set()
    for (const record of body.files) {
        if (!safeRelative(record.path)) throw new Error('Небезопасный путь в копии: ' + record.path)
        if (seen.has(record.path)) throw new Error('Повторный путь в копии: ' + record.path)
        seen.add(record.path)
        const file = path.join(from, 'data', record.path)
        if (!existsSync(file)) throw new Error('В копии нет файла: ' + record.path)
        if (statSync(file).size != record.size) throw new Error('Размер файла не совпадает с manifest: ' + record.path)
        if (digestOf(file) != record.sha256) throw new Error('Хеш файла не совпадает с manifest: ' + record.path)
    }

    // Проверка целиком выполнена до первой записи: неудача не оставляет полукопии.
    for (const record of body.files) {
        const target = path.join(to, record.path)
        mkdirSync(path.dirname(target), {recursive: true})
        await pipeline(createReadStream(path.join(from, 'data', record.path)), createWriteStream(target))
    }
    return {app: body.app, files: body.files.length, takenAt: body.takenAt, dataDirectory: body.dataDirectory}
}

function flag(name) {
    return process.argv.find(value => value.startsWith('--' + name + '='))?.split('=')[1] ?? ''
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const [source, destination] = process.argv.slice(2).filter(value => !value.startsWith('--'))
    if (!source || !destination) {
        console.log('Использование: node scripts/restore.mjs <каталог копии> <новый пустой каталог> [--data-version=X]')
        process.exitCode = 1
    } else {
        restore({source, destination, dataVersion: flag('data-version')}).then(function done(result) {
            console.log('Восстановлено файлов: ' + result.files + ' из копии ' + result.takenAt)
            console.log('Запускайте приложение ' + result.app + ' с SERVICE_DATA_DIR=' + destination)
        }).catch(function failed(error) {
            console.error(error.message)
            process.exitCode = 1
        })
    }
}
