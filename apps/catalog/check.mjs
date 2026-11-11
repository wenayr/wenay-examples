import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {products} from './products.js'
import {selectProducts, launchCommand, copyCommand} from './catalog-model.js'

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
        rows.set(cells[0], {port: cells[1], typecheck: cells[4], test: cells[5], build: cells[6], checked: cells[11]})
    }
    return rows
}

function main() {
    const rows = statusRows()
    const listed = [...rows.keys()].filter(app => app != 'catalog').sort()
    assert.deepEqual(products.map(product => product.id).sort(), listed, 'все приложения STATUS представлены в витрине')
    for (const product of products) {
        const row = rows.get(product.id)
        assert(row, 'карточка ' + product.id + ' есть в STATUS')
        assert.equal(String(product.port), row.port, 'порт карточки ' + product.id + ' совпадает с кодом приложения')
        const passed = row.typecheck == '✓' && row.test == '✓' && row.build == '✓'
        assert.equal(product.ready, passed, 'готовность ' + product.id + ' совпадает с результатом проверок')
        assert.equal(product.checked, row.checked, 'дата карточки совпадает с последним записанным прогоном')
        assert.deepEqual(product.results, {typecheck: row.typecheck, test: row.test, build: row.build})
        const scaffold = existsSync(path.join(repository, 'apps', product.id, 'scaffold.json'))
        assert.equal(product.scaffold, scaffold, 'команды копирования доступны только для существующего шаблона')
        assert(['clients', 'team', 'operations'].includes(product.group), 'у карточки известная категория')
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
    checkSelection()
    checkCommands()
    console.log('PASS catalog: ' + products.length + ' карточек, порты и готовность совпадают со STATUS, разметка паспортов очищена')
}

function checkSelection() {
    const filter = {category: 'all', query: '', verified: false}
    assert.equal(selectProducts(products, filter).length, products.length)
    assert.equal(selectProducts(products, {...filter, query: '  NORTHSTAR  '})[0]?.id, 'support')
    assert.equal(selectProducts(products, {...filter, query: 'учет квоты'})[0]?.id, 'metering', 'поиск учитывает е/ё и несколько слов')
    assert.equal(selectProducts(products, {...filter, query: 'несуществующий-продукт'}).length, 0)
    const clients = selectProducts(products, {...filter, category: 'clients'})
    assert(clients.length > 0 && clients.every(item => item.group == 'clients'))
    assert.equal(selectProducts(products, {...filter, category: 'team', query: 'Northstar'}).length, 0)
    const pending = products.map(item => ({...item, ready: false}))
    assert.equal(selectProducts(pending, {...filter, verified: true}).length, 0, 'нет успешных прогонов — пустая выдача')
    assert.equal(selectProducts(pending, filter).length, products.length, 'непроверенные приложения остаются доступны')
}

function checkCommands() {
    for (const product of products) {
        const pkg = JSON.parse(readFileSync(path.join(repository, 'apps', product.id, 'package.json'), 'utf8'))
        assert(pkg.scripts.start && pkg.scripts.build, 'команды запуска объявлены у ' + product.id)
        assert(launchCommand(product).startsWith('cd apps/' + product.id + '\n'))
        if (product.id == 'hosting') assert(!launchCommand(product).includes('npm start'), 'hosting требует настройки до запуска')
        assert.equal(Boolean(copyCommand(product)), product.scaffold)
    }
    const pkg = JSON.parse(readFileSync(path.join(repository, 'apps', 'pizzeria', 'package.json'), 'utf8'))
    assert(pkg.scripts['start:organizer'], 'органайзер запускается отдельным npm script')
}

main()
