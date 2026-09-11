import React, {useCallback, useEffect, useRef, useState} from 'react'
import type {PizzeriaNetwork} from '../backend/network'
import {useClientStore} from 'wenay-react2/react'
import {useServiceSession} from '../shared/react/service-session'
import {useServiceAction} from '../shared/react/service-action'
import type {serviceDefinition} from '../backend/service'

export type Location = ReturnType<PizzeriaNetwork['view']['list']>[number]
type NetworkStatus = ReturnType<PizzeriaNetwork['view']['status']>

type LocationsProps = {children: (location: Location, network: boolean) => React.ReactNode}

const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR'})

export function Locations({children}: LocationsProps) {
    const [locations, setLocations] = useState<Location[] | null>(null)
    const [selected, setSelected] = useState(sessionStorage.getItem('pizzeria-location') ?? '')
    const [error, setError] = useState('')
    const [network, setNetwork] = useState(false)
    useEffect(function loadLocations() {
        const controller = new AbortController()
        async function load() {
            const response = await fetch('/api/locations/list', {signal: controller.signal})
            if (response.status == 404) {
                if (controller.signal.aborted) return
                const single = {id: 'local', title: 'Печь', url: window.location.origin, online: true}
                setLocations([single])
                return
            }
            const body = await response.json()
            if (!body.ok) throw new Error('Каталог заведений недоступен')
            if (!controller.signal.aborted) {
                setLocations(body.value)
                setNetwork(true)
            }
        }
        load().catch(function failed(reason) {
            if (!controller.signal.aborted) setError(reason.message)
        })
        return function closed() {controller.abort()}
    }, [])
    if (error) {
        return <main>
            <p role="alert">{error}</p>
            <button onClick={function reload() {window.location.reload()}}>Повторить</button>
        </main>
    }
    if (!locations?.length) return <main><p>Загружаем заведения…</p></main>

    const location = locations.find(item => item.id == selected) ?? locations[0]
    function choose(event: React.ChangeEvent<HTMLSelectElement>) {
        sessionStorage.setItem('pizzeria-location', event.target.value)
        setSelected(event.target.value)
    }

    return <>
        {network && <div className="location-bar">
            <label>Ваше заведение
                <select value={location.id} onChange={choose}>
                    {locations.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
                </select>
            </label>
            <span>Меню, заказы, склад и права сотрудников отдельные для каждого заведения.</span>
        </div>}
        {children(location, network)}
    </>
}

export function NetworkOwner(props: {location: Location, token: string}) {
    return <NetworkOwnerPanel key={JSON.stringify([props.location.id, props.token])} {...props}/>
}

function NetworkOwnerPanel({location, token}: {location: Location, token: string}) {
    const [status, setStatus] = useState<NetworkStatus | null>(null)
    const [count, setCount] = useState(1)
    const [loadError, setLoadError] = useState('')
    const [revision, setRevision] = useState(0)
    const lifetime = useRef<AbortController | null>(null)
    const command = useServiceAction()
    useEffect(function inspectProcesses() {
        const controller = new AbortController()
        lifetime.current = controller
        setStatus(null)
        setLoadError('')
        async function readStatus() {
            const response = await fetch('/api/owner/status?args='+encodeURIComponent(JSON.stringify([location.id])), {
                headers: {authorization: 'Bearer '+token}, signal: controller.signal,
            })
            const body = await response.json()
            if (!body.ok) throw new Error(body.error?.message ?? 'Не удалось получить состояние')
            controller.signal.throwIfAborted()
            const value: NetworkStatus = body.value
            setStatus(value)
            setCount(value.desiredNodes)
        }
        readStatus().catch(function failed(error) {if (!controller.signal.aborted) setLoadError(error.message)})
        return function closed() {controller.abort()}
    }, [location.id, token, revision])
    async function scale(event: React.FormEvent) {
        event.preventDefault()
        const signal = lifetime.current?.signal
        if (!signal || signal.aborted || !status) return
        await command.action(async function resize() {
            const response = await fetch('/api/owner/scaleNodes', {
                method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer '+token},
                body: JSON.stringify({args: [location.id, count]}), signal,
            })
            const body = await response.json()
            if (!body.ok) throw new Error(body.error?.message ?? 'Не удалось изменить число узлов')
            signal.throwIfAborted()
            setStatus(body.value)
        })
    }
    return <section className="panel">
        <h2>Обслуживание заведения</h2>
        <p>
            Дополнительные узлы обслуживают подключения и живые данные.
            Заказы и склад записывает основной процесс этого заведения.
        </p>
        {status ? <p>
            Основной процесс: {status.online ? 'работает' : 'недоступен'}.
            Узлов работает: {status.nodes.filter(node => node.online).length}.
        </p> : !loadError && <p role="status">Загружаем состояние заведения…</p>}
        <form onSubmit={scale}>
            <fieldset className="row" disabled={command.busy || !status}>
                <label>Количество дополнительных узлов
                    <input
                        type="number"
                        min="0"
                        max="8"
                        step="1"
                        required
                        value={count}
                        onChange={event => setCount(Number(event.target.value))}
                    />
                </label>
                <button>{command.busy ? 'Применяем…' : 'Применить'}</button>
            </fieldset>
        </form>
        {(loadError || command.error) && <p role="alert">{loadError || command.error}</p>}
        {loadError && (
            <button onClick={() => setRevision(value => value + 1)}>
                Повторить загрузку состояния
            </button>
        )}
    </section>
}

type tOverviewState = 'loading' | 'ready' | 'signin' | 'offline'
type OverviewMetric = {state: tOverviewState, total: number, delivered: number}
const overviewLabels = {
    loading: 'Подключаемся',
    ready: 'Данные актуальны',
    signin: 'Нужен вход владельца',
    offline: 'Нет связи'
} as const

function OwnerLocationRow({location, report}: {location: Location, report: (id: string, value: OverviewMetric) => void}) {
    const connection = useServiceSession<typeof serviceDefinition>({
        url: location.url,
        storageKey: 'pizzeria-token:' + location.id
    })
    const allowed = !!connection.me?.roles.includes('owner') && !!connection.me.views.includes('revenue')
    const revenue = useClientStore(allowed?connection.session?.views.revenue: null)
    // Строка показывает ровно то, что удалось получить: вход, связь, права, данные.
    let state: tOverviewState = 'loading'
    if (!connection.token) state = 'signin'
    else if (connection.error) state = 'offline'
    else if (connection.session && !connection.connected) state = 'offline'
    else if (connection.session && !allowed) state = 'signin'
    else if (connection.session && revenue.ready && revenue.state?.total != undefined) state = 'ready'

    const total = state == 'ready' ? revenue.state!.total : 0
    const delivered = state == 'ready' ? revenue.state!.delivered : 0
    useEffect(function reportSummary() {
        report(location.id, {state, total, delivered})
    }, [location.id, state, total, delivered, report])

    return <tr>
        <td>{location.title}</td>
        <td>{overviewLabels[state]}</td>
        <td>{state == 'ready' ? delivered : '—'}</td>
        <td>{state == 'ready' ? total.toFixed(2) : '—'}</td>
    </tr>
}

export function OwnerOverview() {
    const [revision, setRevision] = useState(0)
    return <section className="panel">
        <h2>Обзор сети</h2>
        <p>
            Выручка заведений, где вы вошли как владелец.
            Для доступа к остальным выберите заведение вверху и войдите в него.
        </p>
        <OwnerOverviewRows key={revision}/>
        <button onClick={() => setRevision(value => value + 1)}>
            Обновить доступ к заведениям
        </button>
    </section>
}

function OwnerOverviewRows() {
    const [locations, setLocations] = useState<Location[] | null>(null)
    const [metrics, setMetrics] = useState<Record<string, OverviewMetric>>({})
    const [error, setError] = useState('')
    const report = useCallback(function report(id: string, value: OverviewMetric) {
        setMetrics(previous => ({...previous, [id]: value}))
    }, [])
    useEffect(function loadLocations() {
        const controller = new AbortController()
        async function load() {
            const response = await fetch('/api/locations/list', {signal: controller.signal})
            const body = await response.json()
            if (!body.ok) throw new Error('Не удалось загрузить заведения')
            controller.signal.throwIfAborted()
            setLocations(body.value)
        }
        load().catch(function failed(error) {if (!controller.signal.aborted) setError(error.message)})
        return function close() {controller.abort()}
    }, [])
    if (error) return <p role="alert">{error}</p>
    if (!locations) return <p role="status">Загружаем заведения…</p>
    const ready = locations.flatMap(function counted(location) {
        return metrics[location.id]?.state == 'ready' ? [metrics[location.id]] : []
    })
    const total = ready.reduce((sum, row) => sum + row.total, 0)

    return <>
        <p>
            <b>{money.format(total)}</b> · учтено заведений: {ready.length} из {locations.length}
        </p>
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Заведение</th>
                        <th>Состояние</th>
                        <th>Доставлено</th>
                        <th>Выручка, €</th>
                    </tr>
                </thead>
                <tbody>
                    {locations.map(location => (
                        <OwnerLocationRow key={location.id} location={location} report={report}/>
                    ))}
                </tbody>
            </table>
        </div>
    </>
}
