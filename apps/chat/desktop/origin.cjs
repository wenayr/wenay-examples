function configuredOrigin(value) {
    const error = 'Введите HTTPS origin без завершающего /, пути, логина, пароля, query или fragment'
    if (typeof value != 'string' || !value || value.length > 2048 || value.includes(',') || value.includes('*')) throw new Error(error)
    let url
    try {url = new URL(value)} catch {throw new Error(error)}
    if (url.protocol != 'https:' || !url.hostname || url.username || url.password || url.origin != value) throw new Error(error)
    return url.origin
}

function allowsNavigation(deps) {
    try {
        const url = new URL(deps.url)
        return url.protocol == 'https:' && url.origin == deps.origin && !url.username && !url.password
    } catch {return false}
}

module.exports = {configuredOrigin, allowsNavigation}
