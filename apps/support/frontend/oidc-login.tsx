import React, {useEffect, useRef, useState} from 'react'

export function OidcLogin({onToken}: {onToken: (token: string) => void}) {
    const current = useRef(onToken)
    current.current = onToken
    const [enabled, setEnabled] = useState(false)
    const [error, setError] = useState('')
    useEffect(function discover() {
        const abort = new AbortController()
        async function exchange() {
            try {
                const response = await fetch('/auth/oidc/status', {signal: abort.signal})
                if (!response.ok) return
                const status = await response.json()
                if (abort.signal.aborted || !status.enabled) return
                setEnabled(true)
                const result = await fetch('/auth/oidc/exchange', {method: 'POST', headers: {'X-OIDC-Exchange': '1'}, credentials: 'same-origin', signal: abort.signal})
                if (result.status == 204) return
                const body = await result.json()
                if (abort.signal.aborted) return
                if (!result.ok || typeof body.token != 'string') throw new Error('Вход не завершён. Начните его заново.')
                current.current(body.token)
            } catch (reason) {if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Вход временно недоступен')}
        }
        void exchange()
        return () => abort.abort()
    }, [])
    return enabled ? <div className="oidc-login"><a className="primary" href="/auth/oidc/start">Войти через организацию</a>{error && <p role="alert">{error}</p>}</div> : null
}
