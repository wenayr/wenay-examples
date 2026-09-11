export function captureUnavailable(kind: 'screen' | 'voice') {
    if (!globalThis.isSecureContext) return 'Для экрана и микрофона откройте приложение по HTTPS. На этом компьютере также можно использовать localhost.'
    const devices = navigator.mediaDevices
    if (kind == 'screen' && typeof devices?.getDisplayMedia != 'function') {
        return 'В этом браузере показ экрана недоступен.'
            + ' Откройте доску в браузере с поддержкой демонстрации экрана,'
            + ' смотреть чужой экран можно и здесь.'
    }
    if (kind == 'voice' && typeof devices?.getUserMedia != 'function') return 'В этом браузере запись с микрофона недоступна. Можно продолжить общение текстом.'
    return ''
}
