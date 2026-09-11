// Канон: shared/react/service-session.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {useMemo, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {tServiceDefinition} from 'wenay-common2/service'

export function useServiceSession<D extends tServiceDefinition<any, any>>(deps: {url: string, storageKey: string, anonymous?: boolean}) {
    const {url, storageKey, anonymous = false} = deps
    const [auth, setAuth] = useState(() => ({storageKey, token: sessionStorage.getItem(storageKey) ?? ''}))
    const stored = sessionStorage.getItem(storageKey) ?? ''
    const token = auth.storageKey == storageKey ? auth.token : stored
    const [epoch, setEpoch] = useState(0)
    const key = JSON.stringify([url, storageKey, token, epoch, anonymous])
    const [renewed, setRenewed] = useState({key: '', token: ''})
    const [dismissed, setDismissed] = useState<unknown>(null)

    async function create(signal: AbortSignal) {
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(5000)])
        const response = await fetch(url + '/api/client', {signal: timeout})
        if (!response.ok) throw new Error('Сервис недоступен')
        const definition: ServiceClientDefinition<D> = await response.json()
        signal.throwIfAborted()
        const latest = token ? sessionStorage.getItem(storageKey) ?? token : ''
        function renew(value: string) {
            if (signal.aborted) return
            sessionStorage.setItem(storageKey, value)
            setRenewed({key, token: value})
        }
        return createServiceClient<D>({definition, url, ...(latest ? {auth: {token: latest}} : {}), onToken: renew})
    }

    const owned = useOwnedClient({key, enabled: !!token || anonymous, create})
    const session = owned.ready ? owned.client : null
    const health = useClientStore(useMemo(() => session ? {store: session.health} : null, [session]))
    const permissions = useClientStore(useMemo(() => session ? {store: session.identity.permissions} : null, [session]))
    const me = permissions.state?.account ? {...permissions.state, account: permissions.state.account} : null

    function setToken(value: string) {
        if (value) sessionStorage.setItem(storageKey, value)
        else sessionStorage.removeItem(storageKey)
        setAuth({storageKey, token: value})
        setEpoch(previous => previous + 1)
    }
    function dismissError() {
        setDismissed(owned.error)
    }

    const unseen = owned.error && owned.error != dismissed
    const error = unseen ? owned.error : null
    let message = ''
    if (error instanceof Error) message = error.message
    else if (error) message = String(error)
    return {
        session, me, token, setToken, dismissError,
        liveToken: renewed.key == key ? renewed.token : token,
        connected: health.state?.connected ?? false,
        error: message
    }
}
