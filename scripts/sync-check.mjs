import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {differences, map} from './sync.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function showDifference(canon, copy) {
    const result = spawnSync('git', ['diff', '--no-index', '--', canon, copy], {cwd: repository, encoding: 'utf8'})
    const lines = (result.stdout ?? '').split('\n').slice(0, 40)
    console.log(lines.join('\n'))
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const found = differences()
    const total = map().reduce((sum, entry) => sum + entry.copies.length, 0)
    for (const item of found) {
        console.log('расхождение: ' + item.copy + ' против канона ' + item.canon)
        showDifference(item.canon, item.copy)
    }
    if (found.length > 0) {
        console.log('Копий разошлось: ' + found.length + '.')
        console.log('Правьте канон в shared/ и запустите node scripts/sync.mjs --write,')
        console.log('либо поднимите правку из приложения: node scripts/sync.mjs --from=<приложение>.')
        process.exitCode = 1
    } else {
        console.log('Синхронно: ' + total + ' копий по ' + map().length + ' каноническим файлам.')
    }
}
