async function loadWindow(deps) {
    const schedule = deps.setTimeout ?? setTimeout
    const cancel = deps.clearTimeout ?? clearTimeout
    let timer
    try {
        await Promise.race([Promise.resolve().then(deps.load), new Promise((_resolve, reject) => {
            timer = schedule(() => {
                const error = new Error('Сервер не ответил за время подключения')
                error.name = 'ConnectionTimeoutError'
                reject(error)
            }, deps.timeoutMs)
        })])
        if (!deps.actual()) throw new Error('Окно подключения сменилось')
    } finally {cancel(timer)}
}

module.exports = {loadWindow}
