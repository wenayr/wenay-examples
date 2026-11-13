/** @typedef {(typeof import('./products.js').products)[number]} Product */

/** @param {string} value */
function normalized(value) {
    return value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
}

/**
 * @param {Product[]} products
 * @param {{category: string, query: string, verified: boolean}} filter
 */
export function selectProducts(products, filter) {
    const words = normalized(filter.query).split(/\s+/).filter(Boolean)
    return products.filter(function matches(product) {
        if (filter.category != 'all' && product.group != filter.category) return false
        if (filter.verified && !product.ready) return false
        const fields = [product.id, product.name, product.kind, product.title, product.description, ...product.labels, ...product.roles]
        const text = normalized(fields.join(' '))
        return words.every(word => text.includes(word))
    })
}

/** @param {Product} product */
export function launchCommand(product) {
    const commands = ['cd apps/' + product.id, 'npm ci', 'npm run build']
    if (product.id != 'hosting') commands.push('npm start')
    return commands.join('\n')
}

/** @param {Product} product */
export function copyCommand(product) {
    if (!product.scaffold) return ''
    return [
        'node scripts/create-saas-example.mjs ' + product.id + ' work/my-' + product.id + ' --name my-' + product.id,
        'cd work/my-' + product.id,
        'npm ci',
        'npm run typecheck',
        'npm test',
        'npm run build',
        'npm start'
    ].join('\n')
}
