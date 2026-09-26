const form = document.querySelector('form')
const origin = document.querySelector('#origin')
const message = document.querySelector('#message')
const button = document.querySelector('button')
let pending = true
button.disabled = true

window.desktopSetup.read().then(value => {
    origin.value = value.origin
    message.textContent = value.message
    pending = false
    button.disabled = false
    origin.focus()
}).catch(() => {message.textContent = 'Локальное окно подключения недоступно. Закройте приложение и повторите запуск.'})

form.addEventListener('submit', async event => {
    event.preventDefault()
    if (pending) return
    pending = true
    button.disabled = true
    origin.disabled = true
    message.textContent = 'Сохраняем адрес и подключаемся…'
    try {
        const result = await window.desktopSetup.configureOrigin(origin.value)
        if (!result.ok) message.textContent = result.message
    } catch {message.textContent = 'Не удалось подключиться. Повторите попытку.'}
    finally {
        pending = false
        button.disabled = false
        origin.disabled = false
    }
})
