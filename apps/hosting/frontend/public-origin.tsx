import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useAsyncAction, useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {HostingRuntimeDefinition} from '../backend/runtime'

type Client = ServiceClient<HostingRuntimeDefinition>
type Dashboard = Client['views']['dashboard']['store']['state']
type Environment = Dashboard['environments'][number]
type Input = {requestId: string, environment: string, revision: number, publicOrigin: string}

function errorText(error: unknown) {return error instanceof Error ? error.message : String(error)}

export function PublicOrigin({client, environments, operations}: {
    client: Client, environments: Environment[], operations: Dashboard['operations']
}) {
    const [selected, setSelected] = useState('')
    const eligible = environments.filter(environment => environment.kind == 'docker' && !environment.active && !environment.pending
        && !operations.some(operation => operation.environment == environment.id))
    const environment = eligible.find(item => item.id == selected) ?? eligible[0]
    return <details>
        <summary>Публичный адрес приложения</summary>
        <p>Настройка сохраняет HTTPS origin для приложения. DNS, TLS-сертификат и внешний прокси ещё не настраиваются.</p>
        <p>Адрес можно задать до первого развёртывания. Изменение адреса уже развёрнутого окружения — отдельный будущий этап.</p>
        {environment ? <>
            <label>Окружение Docker
                <select value={environment.id} onChange={event => setSelected(event.target.value)}>
                    {eligible.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
                </select>
            </label>
            <OriginForm key={environment.id} client={client} environment={environment}/>
        </> : <p>Нет окружений Docker без предыдущих развёртываний. Создайте новое окружение для настройки адреса.</p>}
    </details>
}

function OriginForm({client, environment}: {client: Client, environment: Environment}) {
    const alive = useRef(true)
    useEffect(() => {
        alive.current = true
        return () => {alive.current = false}
    }, [])
    const owned = useOwnedClient({key: client, create() {
        const resource = client.resources.open('publicOrigin')
        return {...resource, ready: Promise.resolve()}
    }})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const current = status.state?.phase == 'ready' ? owned.client?.current() : null
    const action = useAsyncAction({key: current?.generation, enabled: !!current})
    const [draft, setDraft] = useState<string | null>(null)
    const [ticket, setTicket] = useState<Readonly<Input> | null>(null)
    const retained = useRef<Readonly<Input> | null>(null)
    const [notice, setNotice] = useState('')
    async function send(clear = false) {
        if (!current || action.pending) return
        const payload = retained.current ?? Object.freeze({requestId: crypto.randomUUID(), environment: environment.id,
            revision: environment.revision, publicOrigin: clear ? '' : (draft ?? environment.publicOrigin ?? '').trim()})
        retained.current = payload
        setTicket(payload)
        setNotice('')
        const remote = current
        try {
            await action.run(() => remote.remote.control.set(payload))
            if (!alive.current || owned.client?.current()?.generation != remote.generation) return
            retained.current = null
            setTicket(null)
            setDraft(null)
            setNotice('Настройка сохранена. Актуальное значение показывает панель.')
        } catch {}
    }
    function cancelRetry() {
        retained.current = null
        setTicket(null)
        action.clearError()
        setNotice('Следующее сохранение использует актуальную revision окружения.')
    }
    let saveLabel = ticket ? 'Повторить тот же запрос' : 'Сохранить адрес'
    if (action.pending) saveLabel = 'Сохраняем…'
    return <form onSubmit={event => {
        event.preventDefault()
        void send()
    }}>
        <p>Сохранённый origin: <strong className="public-origin-value">{environment.publicOrigin ?? 'Не задан'}</strong></p>
        <fieldset disabled={!current || action.pending}>
            <label>HTTPS origin
                <input type="url" placeholder="https://app.example.test" value={draft ?? environment.publicOrigin ?? ''}
                    disabled={!!ticket} onChange={event => {
                        setDraft(event.target.value)
                        setNotice('')
                    }}/>
            </label>
            <p className="muted">Только origin без логина, пути, завершающего слеша, query и fragment.</p>
            <button className="primary">{saveLabel}</button>{' '}
            {!ticket && <button type="button" disabled={!environment.publicOrigin} onClick={() => {void send(true)}}>Снять настройку</button>}
            {ticket && <button type="button" onClick={cancelRetry}>Отменить повтор и редактировать</button>}
        </fieldset>
        {ticket && <p>Повтор сохраняет исходные адрес и revision {ticket.revision}. Для нового изменения отмените повтор.</p>}
        {!current && <p role="status">{status.state?.phase == 'denied' ? 'Доступ к настройке отсутствует.' : 'Подключаемся к настройке адреса…'}</p>}
        {!!status.state?.error && <p role="alert">{status.state.error.message}</p>}
        {!!owned.error && <p role="alert">{errorText(owned.error)}</p>}
        {!!action.error && <p role="alert">{errorText(action.error)}</p>}
        {!!notice && <p role="status">{notice}</p>}
    </form>
}
