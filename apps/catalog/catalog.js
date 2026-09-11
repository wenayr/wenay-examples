import {products} from './products.js'

/** @typedef {(typeof products)[number]} Product */

const cards = /** @type {HTMLElement} */ (document.querySelector('#cards'))
const dialog = /** @type {HTMLDialogElement} */ (document.querySelector('#details'))
const content = /** @type {HTMLElement} */ (document.querySelector('#detail-content'))
const readyCount = /** @type {HTMLElement} */ (document.querySelector('#ready-count'))
const pendingCount = /** @type {HTMLElement} */ (document.querySelector('#pending-count'))

const ready = products.filter(product => product.ready)
readyCount.textContent = String(ready.length).padStart(2, '0')
pendingCount.textContent = String(products.length - ready.length).padStart(2, '0')

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

/** @param {Product} product */
function copyCommand(product) {
    return [
        'node scripts/create-saas-example.mjs ' + product.id + ' work/my-' + product.id + ' --name my-' + product.id,
        'cd work/my-' + product.id,
        'npm ci',
        'npm run build',
        'npm start'
    ].join('\n')
}

/**
 * @param {Product} product
 * @param {string} text
 */
function openLink(product, text) {
    const link = /** @type {HTMLAnchorElement} */ (node('a', 'detail-open', text))
    link.href = 'http://127.0.0.1:' + product.port + '/'
    link.target = '_blank'
    link.rel = 'noopener'
    return link
}

/** @param {Product} product */
function show(product) {
    content.replaceChildren()
    const heading = node('h2', '', product.name + ' / ' + product.title)
    heading.id = 'detail-title'
    content.append(node('p', 'eyebrow', product.kind), heading, node('p', '', product.description))
    content.append(node('h3', '', 'Путь участников'))
    const list = node('ol')
    for (const role of product.roles) list.append(node('li', '', role))
    content.append(list, node('h3', '', 'Что проверено'), node('p', '', product.checks))
    content.append(node('p', 'detail-note', product.limits))
    if (product.ready) {
        content.append(node('h3', '', 'Создать самостоятельную копию'), node('pre', '', copyCommand(product)))
        const note = 'Запускайте команды из репозитория примеров. Папка назначения должна быть новой.'
        content.append(node('p', '', note + ' Аккаунты и подробные проверки описаны в README созданного проекта.'))
        content.append(openLink(product, 'Открыть локальный пример ↗'))
    }
    dialog.showModal()
}

/** @param {Product} product */
function visualOf(product) {
    const visual = node('div', 'visual')
    const mock = node('div', 'mock')
    const aside = node('div', 'mock-aside')
    const main = node('div', 'mock-main')
    const lines = node('div', 'mock-lines')
    aside.append(node('b', '', product.name.slice(0, 1)), node('i'), node('i'), node('i'))
    product.labels.forEach(function line(label, index) {
        const box = node('div', '', label)
        box.append(node('strong', '', product.counts[index]), node('i'), node('i'))
        lines.append(box)
    })
    main.append(node('h4', '', product.name), lines)
    mock.append(aside, main)
    visual.append(mock, node('span', 'mock-label', 'Схема сценария'))
    return visual
}

/** @param {string} filter */
function render(filter) {
    cards.replaceChildren()
    for (const product of products.filter(item => filter == 'all' || item.ready)) {
        const card = node('article', 'card')
        card.style.setProperty('--accent', product.accent)
        card.style.setProperty('--wash', product.wash)
        const body = node('div', 'card-body')
        const top = node('div', 'card-top')
        const bottom = node('div', 'card-bottom')
        top.append(node('h3', '', product.name), node('span', 'tag', product.kind))
        if (product.ready) bottom.append(openLink(product, 'Открыть пример ↗'))
        else bottom.append(node('span', 'state', 'В работе'))
        const details = node('button', '', 'Сценарий и запуск →')
        details.addEventListener('click', () => show(product))
        bottom.append(details)
        body.append(top, node('p', '', product.description), bottom)
        card.append(visualOf(product), body)
        cards.append(card)
    }
}

const filters = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-filter]'))
filters.forEach(function bind(button) {
    button.addEventListener('click', function pick() {
        filters.forEach(function mark(item) {
            item.classList.toggle('active', item == button)
            item.setAttribute('aria-pressed', String(item == button))
        })
        render(button.dataset.filter ?? 'all')
    })
})
document.querySelector('#close')?.addEventListener('click', () => dialog.close())
render('ready')
