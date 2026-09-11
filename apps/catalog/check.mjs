import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {products} from './products.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(here, '../..')

// Витрина не хранит своего состояния: карточки обязаны совпадать с паспортами
// приложений и с последним прогоном проверок.
function statusRows() {
    const text = readFileSync(path.join(repository, 'doc', 'STATUS.md'), 'utf8')
    const rows = new Map()
    for (const line of text.split('\n')) {
        if (!line.startsWith('| ') || line.startsWith('| ---') || line.startsWith('| Приложение')) continue
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
        rows.set(cells[0], {port: cells[1], typecheck: cells[4], test: cells[5], build: cells[6]})
    }
    return rows
}

function main() {
    const rows = statusRows()
    assert(products.length >= 9, 'в витрине не меньше девяти карточек')
    for (const product of products) {
        const row = rows.get(product.id)
        assert(row, 'карточка ' + product.id + ' есть в STATUS')
        assert.equal(String(product.port), row.port, 'порт карточки ' + product.id + ' совпадает с кодом приложения')
        const passed = row.typecheck == '✓' && row.test == '✓' && row.build == '✓'
        assert.equal(product.ready, passed, 'готовность ' + product.id + ' совпадает с результатом проверок')
        const filled = {name: product.name, kind: product.kind, title: product.title}
        Object.assign(filled, {description: product.description, accent: product.accent, wash: product.wash})
        for (const [field, value] of Object.entries(filled)) {
            assert(value, 'у карточки ' + product.id + ' заполнено поле ' + field)
        }
        assert(product.roles.length >= 2, 'у карточки ' + product.id + ' описаны роли')
        assert(product.checks, 'у карточки ' + product.id + ' указаны проверки из паспорта')
        assert(product.limits, 'у карточки ' + product.id + ' указаны ограничения из паспорта')
        assert(!/\[|\]\(|`/.test(product.checks + product.limits), 'разметка паспорта не попала в карточку')
    }
    const generated = readFileSync(path.join(here, 'products.js'), 'utf8')
    assert(generated.startsWith('// Сгенерировано'), 'products.js собран scripts/catalog.mjs, а не правился руками')
    console.log('PASS catalog: ' + products.length + ' карточек, порты и готовность совпадают со STATUS, разметка паспортов очищена')
}

main()
