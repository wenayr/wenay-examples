import {products} from './products.js'
import {selectProducts, launchCommand, copyCommand} from './catalog-model.js'

/** @typedef {(typeof products)[number]} Product */

const cards = /** @type {HTMLElement} */ (document.querySelector('#cards'))
const dialog = /** @type {HTMLDialogElement} */ (document.querySelector('#details'))
const content = /** @type {HTMLElement} */ (document.querySelector('#detail-content'))
const search = /** @type {HTMLInputElement} */ (document.querySelector('#search'))
const verified = /** @type {HTMLInputElement} */ (document.querySelector('#verified'))
const resultCount = /** @type {HTMLElement} */ (document.querySelector('#result-count'))
const filters = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-category]'))
const filter = {category: 'all', query: '', verified: false}

/** @type {HTMLElement | null} */
let opener = null
document.querySelector('#product-count')?.replaceChildren(String(products.length).padStart(2, '0'))

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function node(tag, className, text) {
    const result = document.createElement(tag)
    if (className) result.className = className
    if (text) result.textContent = text
    return result
}

/**
 * @param {string} url
 * @param {string} title
 * @param {string} className
 */
function link(url, title, className) {
    const result = /** @type {HTMLAnchorElement} */ (node('a', className, title))
    result.href = url
    result.target = '_blank'
    result.rel = 'noopener'
    return result
}

/** @param {string} command */
function commands(command) {
    const section = node('div', 'command-block')
    const pre = node('pre')
    pre.append(node('code', '', command))
    const controls = node('div', 'command-controls')
    const copy = /** @type {HTMLButtonElement} */ (node('button', 'copy-button', 'Копировать команды'))
    const feedback = node('span', 'copy-feedback')
    feedback.setAttribute('role', 'status')
    copy.addEventListener('click', async function copyText() {
        copy.disabled = true
        try {
            await navigator.clipboard.writeText(command)
            feedback.textContent = 'Команды скопированы'
        } catch {
            feedback.textContent = 'Не удалось скопировать. Выделите команды и скопируйте их вручную.'
        } finally {
            copy.disabled = false
        }
    })
    controls.append(copy, feedback)
    section.append(pre, controls)
    return section
}

/** @param {Product} product */
function technicalDetails(product) {
    const details = node('details', 'technical-details')
    details.append(node('summary', '', 'Проверки, ограничения и самостоятельная копия'))
    const stamp = product.checked == 'не запускалось' ? 'Нет записанных прогонов.' : 'Последняя запись: ' + product.checked + ' UTC.'
    details.append(node('p', 'check-date', stamp))
    const results = node('ul', 'check-results')
    const names = {typecheck: 'Проверка типов', test: 'Тесты', build: 'Сборка'}
    for (const [key, value] of Object.entries(product.results)) {
        let label = value
        if (value == '✓') label = 'успешно'
        if (value == '✗') label = 'есть ошибки'
        if (value == '?') label = 'нет результата'
        results.append(node('li', '', (names[/** @type {keyof typeof names} */ (key)] ?? key) + ': ' + label))
    }
    details.append(results)
    details.append(node('p', '', 'Это сохранённые результаты для зависимостей примера. После изменения исходников проверки нужно повторить.'))
    details.append(node('h3', '', 'Какие сценарии проверяются'), node('p', '', product.checks))
    details.append(node('h3', '', 'Ограничения примера'), node('p', '', product.limits))
    const copy = copyCommand(product)
    if (copy) {
        details.append(node('h3', '', 'Создать свой проект'))
        details.append(node('p', '', 'Выполняйте из корня репозитория. Папка назначения должна быть новой. Данные и секреты исходного примера не копируются.'))
        details.append(commands(copy))
        details.append(node('p', '', 'Копия использует отдельный порт. Адрес и демонстрационные аккаунты будут в её README.'))
    }
    return details
}

/**
 * @param {Product} product
 * @param {HTMLElement} trigger
 */
function show(product, trigger) {
    opener = trigger
    content.replaceChildren()
    const heading = node('h2', '', product.title)
    heading.id = 'detail-title'
    content.append(node('p', 'eyebrow', product.name + ' / ' + product.kind), heading, node('p', '', product.description))
    content.append(node('h3', '', 'Как работает сценарий'))
    const list = node('ol')
    for (const role of product.roles) list.append(node('li', '', role))
    content.append(list, node('h3', '', 'Запустить у себя'))
    content.append(node('p', '', 'Откройте терминал в корне репозитория. Нужен Node.js 22.12 или новее.'))
    if (product.id == 'hosting') {
        content.append(node('p', 'launch-note', 'Сначала подготовьте панель по README. Для размещения также потребуется Docker и настроенный агент.'))
        content.append(link('/guides/hosting', 'README: обязательная настройка панели ↗', 'documentation-link'))
    }
    content.append(commands(launchCommand(product)))
    if (product.id == 'hosting') {
        content.append(node('p', '', 'Перед npm start задайте HOSTING_ACCOUNTS_FILE — путь к файлу аккаунтов с заменёнными паролями-заглушками.'))
        content.append(node('p', '', 'Также задайте SERVICE_TOKEN_SECRET и SERVICE_NODE_TOKEN: разные секреты не короче 32 символов. Сохраните их для перезапуска.'))
    }
    content.append(node('p', 'launch-note', 'Сначала дождитесь запуска сервера в терминале. Витрина не запускает приложения и не проверяет их доступность.'))
    content.append(link('http://127.0.0.1:' + product.port + '/', 'Открыть запущенный пример ↗', 'button primary detail-open'))
    content.append(node('p', '', 'Адрес по умолчанию: 127.0.0.1:' + product.port + '. Если изменили порт, используйте адрес из терминала.'))
    content.append(link('/guides/' + product.id, 'README: аккаунты и настройка ↗', 'documentation-link'))
    if (product.id == 'pizzeria') {
        content.append(node('h3', '', 'Органайзер команды'))
        content.append(node('p', '', 'Отдельный интерфейс с задачами, чатом и холстом. Запускается из того же приложения в другом терминале.'))
        content.append(commands('cd apps/pizzeria\nnpm run start:organizer'))
        content.append(link('/guides/organizer', 'README органайзера ↗', 'documentation-link'))
    }
    content.append(technicalDetails(product))
    dialog.showModal()
    dialog.scrollTop = 0
}

/** @param {Product} product */
function cardOf(product) {
    const card = node('article', 'card')
    card.style.setProperty('--product-accent', product.accent)
    card.style.setProperty('--product-wash', product.wash)
    const top = node('div', 'card-top')
    const mark = node('span', 'product-mark', product.name.slice(0, 1))
    mark.setAttribute('aria-hidden', 'true')
    const name = node('div', 'product-name', product.name)
    name.append(node('span', 'product-kind', product.kind))
    top.append(mark, name)
    const title = node('h3', '', product.title)
    const tags = node('ul', 'process-tags')
    tags.setAttribute('aria-label', 'Этапы работы')
    for (const label of product.labels) tags.append(node('li', '', label))
    const bottom = node('div', 'card-bottom')
    const details = node('button', 'text-button', 'Сценарий и запуск')
    details.setAttribute('aria-label', product.name + ': сценарий и запуск')
    const arrow = node('span', '', '→')
    arrow.setAttribute('aria-hidden', 'true')
    details.append(arrow)
    details.addEventListener('click', function openDetails() {show(product, details)})
    const state = product.ready ? 'Успешный прогон записан' : 'Проверки требуют внимания'
    bottom.append(details, node('p', 'card-state' + (product.ready ? '' : ' pending'), state))
    card.append(top, title, node('p', 'card-description', product.description), tags, bottom)
    return card
}

function resetFilters() {
    filter.category = 'all'
    filter.query = ''
    filter.verified = false
    search.value = ''
    verified.checked = false
    render()
    search.focus()
}

function render() {
    cards.replaceChildren()
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category == filter.category)))
    const selected = selectProducts(products, filter)
    resultCount.textContent = 'Показано: ' + selected.length + ' из ' + products.length
    for (const product of selected) cards.append(cardOf(product))
    if (selected.length > 0) return
    const empty = node('div', 'empty-state')
    empty.append(node('h3', '', 'Подходящих примеров пока нет'))
    empty.append(node('p', '', 'Попробуйте другое слово или сбросьте выбранные фильтры.'))
    const reset = node('button', '', 'Показать все приложения')
    reset.addEventListener('click', resetFilters)
    empty.append(reset)
    cards.append(empty)
}

filters.forEach(function bind(button) {
    button.addEventListener('click', function pick() {
        filter.category = button.dataset.category ?? 'all'
        render()
    })
})
search.addEventListener('input', function searchProducts() {
    filter.query = search.value
    render()
})
verified.addEventListener('change', function filterVerified() {
    filter.verified = verified.checked
    render()
})
document.querySelector('#close')?.addEventListener('click', function closeDialog() {dialog.close()})
dialog.addEventListener('close', function restoreFocus() {opener?.focus()})
const featured = /** @type {HTMLButtonElement} */ (document.querySelector('#featured'))
featured.addEventListener('click', function showFeatured() {
    const product = products.find(item => item.id == 'support')
    if (product) show(product, featured)
})
render()
