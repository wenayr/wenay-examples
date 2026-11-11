import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {collect} from './status.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const presentationFile = path.join(repository, 'apps', 'catalog', 'presentation.json')
const productsFile = path.join(repository, 'apps', 'catalog', 'products.js')

// Витрина не ведёт собственного списка состояний: оформление авторское,
// а порт, проверки, ограничения и готовность берутся из паспорта и STATUS.
function passport(app) {
    const file = path.join(repository, 'apps', app, 'PASSPORT.md')
    if (!existsSync(file)) return null
    const text = readFileSync(file, 'utf8')
    const field = name => text.match(new RegExp('- \\*\\*' + name + ':\\*\\* (.+)'))?.[1]?.trim() ?? ''
    const limits = text.split('## Ограничения')[1]?.split('##')[0]?.trim() ?? ''
    return {checks: field('Проверки'), limits, hosting: field('Размещение')}
}

// Ссылки и обратные кавычки убираем: карточка витрины — обычный текст.
function plain(value) {
    return value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/\*\*/g, '')
}

export function build() {
    const presentation = JSON.parse(readFileSync(presentationFile, 'utf8'))
    const rows = collect()
    const products = presentation.map(function product(item) {
        const row = rows.find(value => value.app == item.id)
        const paper = passport(item.id)
        const passed = row && row.results.typecheck == '✓' && row.results.test == '✓' && row.results.build == '✓'
        return {
            ...item,
            port: Number(row?.port ?? 0),
            ready: !!passed,
            checked: row?.checked ?? 'не запускалось',
            results: row?.results ?? {},
            scaffold: existsSync(path.join(repository, 'apps', item.id, 'scaffold.json')),
            checks: plain(paper?.checks ?? ''),
            limits: plain(paper?.limits ?? '')
        }
    })
    const head = '// Сгенерировано scripts/catalog.mjs из presentation.json, PASSPORT.md и STATUS.md.\n'
        + '// Оформление правьте в presentation.json, состояние — прогоном проверок.\n'
    writeFileSync(productsFile, head + 'export const products = ' + JSON.stringify(products, null, 4) + '\n', 'utf8')
    return products
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const products = build()
    for (const item of products) console.log(item.id.padEnd(12) + String(item.port).padEnd(6) + (item.ready ? 'готов' : 'в работе'))
    console.log('')
    console.log('apps/catalog/products.js собран из ' + products.length + ' карточек.')
}
