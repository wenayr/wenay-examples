import {copyFileSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function map() {
    const file = path.join(repository, 'scripts', 'sync-map.json')
    return JSON.parse(readFileSync(file, 'utf8'))
}

export function differences() {
    const found = []
    for (const entry of map()) {
        const canon = readFileSync(path.join(repository, entry.canon))
        for (const copy of entry.copies) {
            if (readFileSync(path.join(repository, copy)).equals(canon)) continue
            found.push({canon: entry.canon, copy})
        }
    }
    return found
}

function writeCopies() {
    let written = 0
    for (const entry of map()) {
        const canon = path.join(repository, entry.canon)
        for (const copy of entry.copies) {
            const target = path.join(repository, copy)
            if (readFileSync(target).equals(readFileSync(canon))) continue
            copyFileSync(canon, target)
            console.log('записано: ' + copy)
            written++
        }
    }
    return written
}

// Правку удобнее делать в приложении, где виден её эффект; отсюда она поднимается в канон.
function writeCanonFrom(app) {
    let written = 0
    for (const entry of map()) {
        const copy = entry.copies.find(item => item.startsWith('apps/' + app + '/'))
        if (!copy) continue
        const source = path.join(repository, copy)
        const canon = path.join(repository, entry.canon)
        if (readFileSync(source).equals(readFileSync(canon))) continue
        writeFileSync(canon, readFileSync(source))
        console.log('канон обновлён из ' + copy)
        written++
    }
    return written
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const from = process.argv.find(value => value.startsWith('--from='))?.split('=')[1]
    if (from) {
        const raised = writeCanonFrom(from)
        console.log('Поднято в канон файлов: ' + raised + '. Запустите sync.mjs --write, чтобы разослать остальным копиям.')
    } else if (process.argv.includes('--write')) {
        console.log('Обновлено копий: ' + writeCopies())
    } else {
        console.log('Использование: node scripts/sync.mjs --write | --from=<приложение>')
        process.exitCode = 1
    }
}
