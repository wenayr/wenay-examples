import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {MeteringDefinition} from '../backend/runtime'
import {useServiceAction} from '../shared/react/service-action'
import {useCommandAction} from '../shared/react/command-action'
import {metrics, type KeyCredentials} from './contracts'

const operations = [
    {id: 'record', title: 'Учесть расход', description: 'Записать завершённую операцию и занять единицы лимита.'},
    {id: 'reserve', title: 'Создать резерв', description: 'Занять единицы до начала работы и слот параллельного выполнения.'},
    {id: 'settle', title: 'Подтвердить расход', description: 'Указать фактический расход существующего резерва.'},
    {id: 'release', title: 'Освободить резерв', description: 'Вернуть единицы и слот, если работа не была выполнена.'},
    {id: 'unknown', title: 'Исход неизвестен', description: 'Сохранить резерв до выяснения результата операции.'}
] as const

type PlaygroundProps = {
    orgId: string,
    credentials: KeyCredentials | null,
    consumed: () => void,
    disabled: boolean,
    openKeys: () => void
}

export function Playground({orgId, credentials, consumed, disabled, openKeys}: PlaygroundProps) {
    const [account, setAccount] = useState(credentials ? 'key:' + credentials.id : '')
    const [secret, setSecret] = useState(credentials?.secret ?? '')
    const [auth, setAuth] = useState<{token: string, account: string} | null>(null)
    const action = useServiceAction(orgId)
    const [operation, setOperation] = useState<string>('record')
    const [eventId, setEventId] = useState(() => 'demo-' + crypto.randomUUID())
    const [result, setResult] = useState('')
    const lifetime = useRef(0)
    useEffect(function stopOnLeave() {return () => {lifetime.current++}}, [])
    const owned = useOwnedClient({key: auth?.token, enabled: !!auth, create: async function client(signal) {
        const response = await fetch('/api/client', {signal})
        if (!response.ok) throw new Error('Сервис не предоставил описание API')
        const definition: ServiceClientDefinition<MeteringDefinition> = await response.json()
        signal.throwIfAborted()
        return createServiceClient<MeteringDefinition>({definition, url: location.origin, auth: {token: auth!.token}})
    }})
    const client = owned.ready ? owned.client : null
    const health = useClientStore(useMemo(() => client ? {store: client.health} : null, [client]))
    const permissions = useClientStore(useMemo(() => client ? {store: client.identity.permissions} : null, [client]))
    const commands = useCommandAction(client?.commands)
    const resource = useOwnedClient({key: client, enabled: !!client, create: () => ({...client!.resources.open('usage'), ready: Promise.resolve()})})
    const resourceStatus = useClientStore(useMemo(() => resource.client ? {store: resource.client.status} : null, [resource.client]))
    const usage = resourceStatus.state?.phase == 'ready' ? resource.client?.current()?.remote : null
    const probe = useServiceAction(usage)
    const [identity, setIdentity] = useState<{remote: typeof usage, orgId: string, scopes: string[], expiresAt: number} | null>(null)
    const [snapshot, setSnapshot] = useState<{remote: typeof usage, text: string, at: number} | null>(null)
    const verified = identity?.remote == usage ? identity : null
    useEffect(function identifyKey() {
        let active = true
        if (usage) void probe.action(async function identity() {
            const result = await usage.control.identity()
            if (active) setIdentity({remote: usage, ...result})
        })
        return () => {active = false}
    }, [usage])
    const busy = action.busy || commands.busy || disabled
    const connected = !!client && !!health.state?.connected
    const canWrite = (permissions.state?.commands.includes('usageRecord') ?? false) && verified?.orgId == orgId && verified.expiresAt > Date.now()

    async function reconnect() {
        if (client) await action.action(async function reconnectSession() {await client.ready()})
    }

    async function readUsage() {
        if (!usage) return
        const request = usage
        await probe.action(async function read() {
            const result = await request.control.read({period: new Date().toISOString().slice(0, 7), limit: 25})
            setSnapshot({remote: request, text: JSON.stringify(result, null, 2), at: Date.now()})
        })
    }

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const generation = lifetime.current
        await action.action(async function authenticateKey() {
            if (!account.startsWith('key:')) throw new Error('Введите аккаунт API-ключа в формате key:…')
            const response = await fetch('/api/metering/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [{account, password: secret}]})
            })
            const value = await response.json()
            if (!response.ok || !value.ok) throw new Error(value.error?.message ?? 'Ключ не принят')
            if (generation != lifetime.current) return
            setAuth({token: value.value.token, account})
            setSecret('')
            consumed()
        })
    }

    function disconnect() {
        lifetime.current++
        setAuth(null)
        setSecret('')
        setResult('')
        consumed()
    }

    async function execute(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const reference = String(form.get('reference') ?? '')
        const metric = String(form.get('metric') ?? 'search') as 'search' | 'document'
        const units = Number(form.get('units'))
        const reason = String(form.get('reason') ?? '')
        const generation = lifetime.current
        setResult('')
        async function runOperation() {
            if (operation == 'record') {
                return commands.execute('usageRecord', {eventId, metric, units, reference})
            }
            if (operation == 'reserve') {
                return commands.execute('usageReserve', {eventId, metric, units, reference})
            }
            if (operation == 'settle') return commands.execute('usageSettle', {eventId, units})
            if (operation == 'release') return commands.execute('usageRelease', {eventId, reason})
            return commands.execute('usageUncertain', {eventId, reason})
        }
        try {
            const response = await runOperation()
            if (generation == lifetime.current) setResult(JSON.stringify(response, null, 2))
        } catch {}
    }

    let connectionHint = 'Ожидаем подтверждение сессии сервера.'
    if (connected && !verified) connectionHint = 'Проверяем права ключа…'
    else if (connected && verified!.orgId != orgId) {
        connectionHint = 'Ключ принадлежит другой организации.'
            + ' Выберите соответствующую организацию в кабинете.'
    } else if (connected && canWrite) connectionHint = 'Доступна запись операций.'
    else if (connected) connectionHint = 'У ключа нет права usage:write.'

    const loginForm = <form onSubmit={login}>
        <label>Аккаунт ключа
            <input
                value={account}
                onChange={event => setAccount(event.target.value)}
                placeholder="key:…"
                autoComplete="off"
                spellCheck={false}
                required
            />
        </label>
        <label>Секрет
            <input
                value={secret}
                onChange={event => setSecret(event.target.value)}
                type="password"
                autoComplete="off"
                required
            />
        </label>
        <button className="primary" disabled={busy}>
            {action.busy ? 'Подключаем…' : 'Подключить API-ключ'}
        </button>
    </form>

    const session = <>
        <div className={'client-status' + (connected ? ' ready' : '')}>
            <span>●</span>
            <strong>{connected ? 'Клиент подключён' : 'Подключение…'}</strong>
        </div>
        <code className="connected-account">{auth?.account}</code>
        <p className="muted">{connectionHint}</p>
        <div className="button-row">
            {client && !connected && <button disabled={busy} onClick={reconnect}>Переподключить</button>}
            <button disabled={commands.busy} onClick={disconnect}>Отключить ключ</button>
        </div>
    </>

    const tip = <div className="client-tip">
        <h3>Попробуйте последовательно</h3>
        <ol>
            <li>Создать резерв на 20 единиц.</li>
            <li>С тем же ID подтвердить расход 12.</li>
            <li>Повторить подтверждение: расход не удвоится.</li>
        </ol>
        <p>Для новой операции нужен новый ID. Повтор с другим содержимым отклоняется.</p>
    </div>

    const usageFields = <>
        <label>Продукт
            <select name="metric">
                {Object.entries(metrics).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
        </label>
        <label>Основание
            <input
                name="reference"
                maxLength={180}
                placeholder="Например, документ DOC-104"
                defaultValue="Проверка API-клиента"
            />
        </label>
    </>

    const unitsField = <label>Единиц
        <input
            name="units"
            type="number"
            min={operation == 'settle' ? 0 : 1}
            max={10000}
            defaultValue={10}
            required
        />
    </label>

    const reasonField = <label>Причина
        <input name="reason" maxLength={300} placeholder="Почему изменяется исход операции" required/>
    </label>

    const withUnits = ['record', 'reserve', 'settle'].includes(operation)

    const requestForm = <form onSubmit={execute}>
        <label>Действие
            <select value={operation} onChange={event => setOperation(event.target.value)}>
                {operations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
            <small>{operations.find(item => item.id == operation)?.description}</small>
        </label>
        <label>ID события
            <div className="event-input">
                <input
                    value={eventId}
                    onChange={event => setEventId(event.target.value)}
                    maxLength={120}
                    pattern="[A-Za-z0-9_:.\-]+"
                    spellCheck={false}
                    required
                />
                <button type="button" onClick={() => setEventId('demo-' + crypto.randomUUID())}>
                    Новый ID
                </button>
            </div>
        </label>
        {['record', 'reserve'].includes(operation) && usageFields}
        {withUnits ? unitsField : reasonField}
        <button className="primary" disabled={busy || !connected || !canWrite}>
            {commands.busy ? 'Выполняем…' : 'Выполнить запрос →'}
        </button>
    </form>

    const canRead = !!verified?.scopes.includes('usage:read')

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">ПРОВЕРИТЬ НА ПРАКТИКЕ</p>
                <h1>API-клиент</h1>
                <p>Настоящий запрос от отдельного ключа. Тестовые единицы, без денег.</p>
            </div>
            <button onClick={openKeys}>К ключам доступа ↗</button>
        </div>
        <div className="notice">
            Этот клиент входит отдельно от кабинета владельца.
            Организация и права определяются самим API-ключом на сервере.
        </div>
        <div className="client-layout">
            <section className="panel client-connection">
                <div className="panel-heading">
                    <div>
                        <h2>Подключение ключа</h2>
                        <p>Секрет используется только для этого входа.</p>
                    </div>
                </div>
                {!auth ? loginForm : session}
                {!!(action.error || owned.error) && (
                    <p role="alert" className="inline-error">
                        {action.error || 'Не удалось подключить API-клиент'}
                    </p>
                )}
                {tip}
            </section>
            <section className="panel request-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Выполнить операцию</h2>
                        <p>Операции появятся в журнале организации ключа.</p>
                    </div>
                    <span className="soft-badge">RPC · common2</span>
                </div>
                {requestForm}
                {commands.error && <p className="inline-error" role="alert">{commands.error}</p>}
                {result && <div className="response-panel">
                    <h3>Ответ сервиса</h3>
                    <pre role="status">{result}</pre>
                </div>}
            </section>
        </div>
        <section className="panel usage-snapshot">
            <div className="panel-heading">
                <div>
                    <h2>Проверка чтения расхода</h2>
                    <p>Снимок текущего периода от API-ключа, до 25 последних операций.</p>
                </div>
                <button disabled={busy || probe.busy || !usage || !canRead} onClick={readUsage}>
                    Прочитать usage: read
                </button>
            </div>
            {probe.error && <p className="inline-error" role="alert">{probe.error}</p>}
            {snapshot?.remote == usage && snapshot && <details>
                <summary>Снимок на {new Date(snapshot.at).toLocaleTimeString('ru-RU')}</summary>
                <pre>{snapshot.text}</pre>
            </details>}
        </section>
        <p className="footnote">
            Токен API-клиента и секрет живут только в памяти страницы.
            Возврат к другому разделу закрывает подключение.
            Кабинет владельца не получает команд учёта от своего имени.
        </p>
    </>

}

