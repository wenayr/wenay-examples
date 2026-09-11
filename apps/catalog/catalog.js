import {products} from './products.js'
const cards = document.querySelector('#cards'), dialog = document.querySelector('#details'), content = document.querySelector('#detail-content')
document.querySelector('#ready-count').textContent = String(products.filter(product => product.ready).length).padStart(2, '0')
document.querySelector('#pending-count').textContent = String(products.filter(product => !product.ready).length).padStart(2, '0')
function node(tag, className, text) {const result = document.createElement(tag); if (className) result.className = className; if (text) result.textContent = text; return result}
function show(product) {
    content.replaceChildren()
    content.append(node('p', 'eyebrow', product.kind), Object.assign(node('h2', '', product.name + ' / ' + product.title), {id: 'detail-title'}), node('p', '', product.description), node('h3', '', 'Путь участников'))
    const list = node('ol'); product.roles.forEach(role => list.append(node('li', '', role))); content.append(list, node('h3', '', 'Что проверено'), node('p', '', product.checks), node('p', 'detail-note', product.limits))
    if (product.ready) {
        content.append(node('h3', '', 'Создать самостоятельную копию'), node('pre', '', 'node scripts/create-saas-example.mjs ' + product.id + ' work/my-' + product.id + ' --name my-' + product.id + '\ncd work/my-' + product.id + '\nnpm ci\nnpm run build\nnpm start'), node('p', '', 'Запускайте команды из репозитория примеров. Папка назначения должна быть новой. Аккаунты и подробные проверки описаны в README созданного проекта.'))
        const link = node('a', 'detail-open', 'Открыть локальный пример ↗'); link.href = 'http://127.0.0.1:' + product.port + '/'; link.target = '_blank'; link.rel = 'noopener'; content.append(link)
    }
    dialog.showModal()
}
function render(filter) {
    cards.replaceChildren()
    for (const product of products.filter(product => filter == 'all' || product.ready)) {
        const card = node('article', 'card'); card.style.setProperty('--accent', product.accent); card.style.setProperty('--wash', product.wash)
        const visual = node('div', 'visual'), mock = node('div', 'mock'), aside = node('div', 'mock-aside'), main = node('div', 'mock-main'), lines = node('div', 'mock-lines')
        aside.append(node('b', '', product.name.slice(0, 1)), node('i'), node('i'), node('i'))
        product.labels.forEach((label, index) => {const box = node('div', '', label); box.append(node('strong', '', product.counts[index]), node('i'), node('i')); lines.append(box)})
        main.append(node('h4', '', product.name), lines); mock.append(aside, main); visual.append(mock, node('span', 'mock-label', 'Схема сценария'))
        if (product.screenshot) {
            const image = document.createElement('img'); image.alt = 'Интерфейс ' + product.name; image.loading = 'lazy'; image.addEventListener('load', () => visual.replaceChildren(image)); image.src = '/screenshots/' + product.id + '.png'
        }
        const body = node('div', 'card-body'), top = node('div', 'card-top'), bottom = node('div', 'card-bottom')
        top.append(node('h3', '', product.name), node('span', 'tag', product.kind))
        if (product.ready) {const link = node('a', '', 'Открыть пример ↗'); link.href = 'http://127.0.0.1:' + product.port + '/'; link.target = '_blank'; link.rel = 'noopener'; bottom.append(link)}
        else bottom.append(node('span', 'state', 'В работе'))
        const details = node('button', '', 'Сценарий и запуск →'); details.addEventListener('click', () => show(product)); bottom.append(details)
        body.append(top, node('p', '', product.description), bottom); card.append(visual, body); cards.append(card)
    }
}
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(item => {item.classList.toggle('active', item == button); item.setAttribute('aria-pressed', String(item == button))})
    render(button.dataset.filter)
}))
document.querySelector('#close').addEventListener('click', () => dialog.close())
render('ready')

