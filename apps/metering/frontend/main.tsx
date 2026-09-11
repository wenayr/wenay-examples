import React, {lazy, Suspense, useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {MeteringDefinition} from '../backend/runtime'
import type {MeteringWorkspace} from './contracts'
import {useServiceSession} from '../shared/react/service-session'
import {useServiceAction} from '../shared/react/service-action'
import {useCommandAction} from '../shared/react/command-action'
import {ServiceView} from '../shared/react/service-view'
import {Keys} from './keys'
import {Playground} from './playground'
import {Webhooks} from './webhooks'
import {date, metrics, number, roles, statuses, type Commands, type Resources, type KeyCredentials} from './contracts'
import './style.css'

const Ledger = lazy(() => import('./ledger'))
const initial: MeteringWorkspace = {
    account: {account: '', name: ''}, organizations: [], currentPeriod: '',
    keys: [], periods: [], events: [], audit: [], subscriptions: [], webhooks: [], deliveries: []
}

const navigation = [
    {id: 'overview', title: 'Обзор', icon: '◫'},
    {id: 'keys', title: 'Ключи доступа', icon: '⚿'},
    {id: 'client', title: 'API-клиент', icon: '⌘'},
    {id: 'events', title: 'Журнал операций', icon: '▤'},
    {id: 'webhooks', title: 'Интеграции', icon: '↗'},
    {id: 'audit', title: 'История действий', icon: '◷'}
] as const

const presets = {owner: 'Владелец', auditor: 'Аудитор', outsider: 'Другая команда'}

const auditLabels: Record<string, string> = {
    'key.issue': 'Создан ключ',
    'key.revoke': 'Отозван ключ',
    'budget.configure': 'Изменён тестовый лимит',
    'usage.record': 'Учтена операция',
    'usage.reserve': 'Создан резерв',
    'usage.settle': 'Подтверждён расход',
    'usage.release': 'Резерв освобождён',
    'usage.unknown': 'Отмечен неизвестный исход'
}

function App() {
    const connection = useServiceSession<MeteringDefinition>({url: location.origin, storageKey: 'counter-token'})
    const commands = useCommandAction(connection.session?.commands)
    const action = useServiceAction(connection.token)
    const [preset, setPreset] = useState('owner')
    const error = connection.error || action.error || commands.error

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/metering/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [credentials]})
            })
            const body = await response.json()
            if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            connection.setToken(body.value.token)
        })
    }

    function dismiss() {
        connection.dismissError()
        action.clearError()
        commands.clearError()
    }

    const banner = error ? (
        <div className="error-banner" role="alert">
            <strong>Действие не завершено.</strong> {error}
            <button aria-label="Закрыть ошибку" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login">
        <section className="login-intro">
            <div className="brand"><span>◫</span> counter<span className="brand-label">API METERING</span></div>
            <div>
                <p className="eyebrow">СЕРВИС РАСТЁТ. РАСХОД ПОНЯТЕН.</p>
                <h1>Каждая операция<br/>на своём месте.</h1>
                <p>Ключи, квоты и прозрачная история<br/>использования вашего API.</p>
                <div className="login-equation">
                    <span>Лимит</span><b>−</b><span>Расход</span><b>−</b><span>Резерв</span><b>=</b>
                    <strong>Доступно</strong>
                </div>
            </div>
            <footer>Тестовые единицы. Реальных платежей нет.</footer>
        </section>
        <section className="login-form">
            <p className="eyebrow">КАБИНЕТ РАЗРАБОТЧИКА</p>
            <h2>Добро пожаловать</h2>
            <p>Продолжите работу с вашей организацией.</p>
            <form key={preset} onSubmit={login}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" defaultValue={preset + '-pass'} autoComplete="current-password" required/>
                </label>
                <button className="primary" disabled={action.busy}>
                    {action.busy ? 'Входим…' : 'Открыть кабинет →'}
                </button>
            </form>
            <div className="presets">
                <small>Демонстрация по ролям</small>
                <div>
                    {Object.entries(presets).map(([id, label]) => (
                        <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                    ))}
                </div>
                <small>Пароль: имя аккаунта + «-pass».</small>
            </div>
        </section>
    </main>

    const waiting = <main className="connecting">
        <h1>{connection.me ? 'Кабинет недоступен' : 'Подключаемся…'}</h1>
        <button onClick={() => connection.setToken('')}>Вернуться ко входу</button>
    </main>

    let page = entry
    if (connection.token) {
        page = waiting
        if (connection.session && connection.me?.views.includes('workspace')) {
            page = <ServiceView remote={connection.session.views.workspace} initial={initial}>
                {value => (
                    <Workspace
                        key={value.account.account}
                        value={value}
                        commands={commands}
                        resources={connection.session!.resources}
                        connected={connection.connected}
                        logout={() => connection.setToken('')}
                    />
                )}
            </ServiceView>
        }
    }

    return <>
        {banner}
        {page}
    </>
}

type WorkspaceProps = {
    value: MeteringWorkspace,
    commands: Commands,
    resources: Resources,
    connected: boolean,
    logout: () => void
}

function Workspace({value, commands, resources, connected, logout}: WorkspaceProps) {
    const [organization, setOrganization] = useState(value.organizations[0]?.id ?? '')
    const [tab, setTab] = useState('overview')
    const [period, setPeriod] = useState(value.currentPeriod)
    const [credentials, setCredentials] = useState<KeyCredentials | null>(null)
    const org = value.organizations.find(item => item.id == organization) ?? value.organizations[0]
    const busy = !connected || commands.busy
    const events = value.events.filter(event => event.orgId == org?.id && event.period == period)
    function useKey(key: KeyCredentials) {
        setCredentials(key)
        setTab('client')
    }
    function switchOrg(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrganization(event.target.value)
        setCredentials(null)
        commands.clearError()
    }

    const sidebar = <aside className="sidebar">
        <a href="#overview" className="brand" onClick={() => setTab('overview')}><span>◫</span> counter</a>
        <span className="sidebar-label">WORKSPACE</span>
        <label className="org-label">Организация
            <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrg}>
                {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </label>
        <nav aria-label="Разделы">
            {navigation.map(item => (
                <button
                    key={item.id}
                    className={tab == item.id ? 'active' : ''}
                    aria-current={tab == item.id ? 'page' : undefined}
                    onClick={() => setTab(item.id)}
                >
                    <span aria-hidden="true">{item.icon}</span>{item.title}
                </button>
            ))}
        </nav>
        <div className="sidebar-tip">
            <span>◇</span>
            <strong>Сначала резерв.<br/>Потом работа.</strong>
            <p>Освобождайте неиспользованные единицы. Неизвестный исход требует проверки.</p>
        </div>
        <div className="account">
            <span className="avatar">{value.account.name.slice(0, 1)}</span>
            <div>
                <strong>{value.account.name.split(' · ')[0]}</strong>
                <small>{org ? roles[org.role] : 'Участник'}</small>
            </div>
            <button aria-label="Выйти из аккаунта" onClick={logout}>↪</button>
        </div>
    </aside>

    return <div className="shell">
        {sidebar}
        <main className="workspace">
            <header className="topbar">
                <div>
                    <span>{org?.name ?? 'Рабочее пространство'}</span>
                    <b>/</b>
                    <strong>{navigation.find(item => item.id == tab)?.title}</strong>
                </div>
                <div>
                    <span className="test-badge">Тестовый тариф</span>
                    <span className={'connection' + (!connected ? ' offline' : '')} role="status">
                        ● {connected ? 'На связи' : 'Переподключение'}
                    </span>
                    <button className="mobile-logout" onClick={logout}>Выйти</button>
                </div>
            </header>
            <div className="page">
        {!connected && <p className="notice warning">Изменения временно недоступны. Подключение восстанавливается.</p>}
        {!org ? <div className="empty">
            <h1>Нет доступной организации</h1>
            <p>Войдите другим аккаунтом.</p>
        </div> : <React.Fragment key={org.id}>
            {tab == 'overview' && <Overview
                value={value}
                org={org}
                period={period}
                setPeriod={setPeriod}
                commands={commands}
                busy={busy}
                openKeys={() => setTab('keys')}
                openClient={() => setTab('client')}
            />}
            {tab == 'keys' && (
                <Keys value={value} org={org} resources={resources} commands={commands} busy={busy} onUse={useKey}/>
            )}
            {tab == 'client' && <Playground
                orgId={org.id}
                credentials={credentials?.orgId == org.id ? credentials : null}
                consumed={() => setCredentials(null)}
                disabled={!connected}
                openKeys={() => setTab('keys')}
            />}
            {tab == 'events' && <>
                <div className="page-heading">
                    <div>
                        <p className="eyebrow">ПРОЗРАЧНАЯ ИСТОРИЯ</p>
                        <h1>Журнал операций</h1>
                        <p>Фактическое потребление, резервы и их исходы.</p>
                    </div>
                    <label>Период
                        <input
                            aria-label="Период операций"
                            type="month"
                            value={period}
                            onChange={event => setPeriod(event.target.value || value.currentPeriod)}
                        />
                    </label>
                </div>
                <Suspense fallback={<p className="empty">Загружаем таблицу…</p>}>
                    <Ledger events={events}/>
                </Suspense>
            </>}
                {tab == 'audit' && <Audit entries={value.audit.filter(entry => entry.orgId == org.id)}/>}
                {tab == 'webhooks' && (
                    <Webhooks value={value} org={org} commands={commands} resources={resources} busy={busy}/>
                )}
            </React.Fragment>}
            </div>
        </main>
    </div>
}

type OverviewProps = {
    value: MeteringWorkspace,
    org: MeteringWorkspace['organizations'][number],
    period: string,
    setPeriod: (value: string) => void,
    commands: Commands,
    busy: boolean,
    openKeys: () => void,
    openClient: () => void
}

// Единицы по исходу: подтверждённые списываются фактом, освобождённые не стоят ничего.
function eventUnits(event: MeteringWorkspace['events'][number]) {
    if (event.status == 'committed') return event.units
    if (event.status == 'released') return 0
    return event.reservedUnits
}

function Overview({value, org, period, setPeriod, commands, busy, openKeys, openClient}: OverviewProps) {
    const [editing, setEditing] = useState(false)

    const empty = {used: 0, reserved: 0, active: 0}
    const usage = value.periods.find(item => item.orgId == org.id && item.period == period) ?? empty
    const available = Math.max(0, org.monthlyUnits - usage.used - usage.reserved)
    const keys = value.keys.filter(key => key.orgId == org.id && !key.revokedAt && key.expiresAt > Date.now())
    const events = value.events.filter(event => event.orgId == org.id && event.period == period)
    const last = events.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
    const percentages = {
        used: Math.min(100, usage.used / org.monthlyUnits * 100),
        reserved: Math.min(100, usage.reserved / org.monthlyUnits * 100)
    }

    async function saveBudget(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const input = {
            orgId: org.id,
            monthlyUnits: Number(form.get('units')),
            concurrent: Number(form.get('concurrent'))
        }
        if (await commands.run('budgetConfigure', input)) setEditing(false)
    }

    const heading = <div className="page-heading">
        <div>
            <p className="eyebrow">ВСЁ ПОД КОНТРОЛЕМ</p>
            <h1>Использование API</h1>
            <p>Понятный расход. Предсказуемые ограничения.</p>
        </div>
        <label>Расчётный период
            <input
                aria-label="Расчётный период"
                type="month"
                value={period}
                onChange={event => setPeriod(event.target.value || value.currentPeriod)}
            />
        </label>
    </div>

    const stats = <div className="stat-grid">
        <article className="stat">
            <span>Использовано</span>
            <strong>{number(usage.used)}<small>ед.</small></strong>
            <p>Подтверждённые операции</p>
            <i className="stat-icon blue">↗</i>
        </article>
        <article className="stat">
            <span>В резерве</span>
            <strong>{number(usage.reserved)}<small>ед.</small></strong>
            <p>{number(usage.active)} незавершённых операций</p>
            <i className="stat-icon amber">◷</i>
        </article>
        <article className="stat accent">
            <span>Доступно</span>
            <strong>{number(available)}<small>ед.</small></strong>
            <p>Из {number(org.monthlyUnits)} единиц тестового лимита</p>
            <i className="stat-icon">◇</i>
        </article>
    </div>

    const quotaLabel = 'Использовано ' + usage.used + ', в резерве ' + usage.reserved + ', доступно ' + available

    const breakdown = <div className="metric-breakdown">
        {Object.entries(metrics).map(([id, label]) => {
            const committed = events.filter(event => event.metric == id && event.status == 'committed')
            const used = committed.reduce((total, event) => total + event.units, 0)
            const share = usage.used ? used / usage.used * 100 : 0
            return <div key={id}>
                <span>{label}</span>
                <div><i style={{width: share + '%'}}/></div>
                <strong>{number(used)} ед.</strong>
            </div>
        })}
    </div>

    const quota = <section className="panel quota-panel">
        <div className="panel-heading">
            <div>
                <h2>Расход за период</h2>
                <p>{period} · лимит {number(org.monthlyUnits)} ед.</p>
            </div>
            <span className="soft-badge">Без денежных списаний</span>
        </div>
        <div className="quota-number">
            <strong>{number(usage.used + usage.reserved)}</strong>
            <span>из {number(org.monthlyUnits)} ед. занято</span>
        </div>
        <div className="quota-bar" role="img" aria-label={quotaLabel}>
            <span className="used" style={{width: percentages.used + '%'}}/>
            <span className="reserved" style={{width: percentages.reserved + '%'}}/>
        </div>
        <div className="quota-legend">
            <span><i className="used"/>Использовано <b>{number(usage.used)}</b></span>
            <span><i className="reserved"/>В резерве <b>{number(usage.reserved)}</b></span>
            <span><i/>Доступно <b>{number(available)}</b></span>
        </div>
        {breakdown}
    </section>

    let accessHint = 'Создайте ключ и выполните первую реальную операцию в тестовом кабинете.'
    if (keys.length) accessHint = 'Активные ключи ограничены правами и сроком действия.'

    const access = <section className="panel access-panel">
        <p className="eyebrow">ВАШ API</p>
        <div className="large-symbol">⌘</div>
        <h2>Готов к следующему запросу</h2>
        <p>{accessHint}</p>
        <div className="access-facts">
            <div><strong>{keys.length}</strong><span>активных ключей</span></div>
            <div><strong>{org.concurrent}</strong><span>операций одновременно</span></div>
        </div>
        <div className="button-row">
            <button className="primary" onClick={openKeys}>Ключи доступа →</button>
            <button onClick={openClient}>API-клиент</button>
        </div>
    </section>

    const recentList = <div className="recent-list">
        {last.map(event => (
            <div key={event.id}>
                <span className={'event-icon ' + event.status}>{event.metric == 'search' ? '⌕' : '▤'}</span>
                <div>
                    <strong>{metrics[event.metric]}</strong>
                    <small>{event.reference || event.eventId}</small>
                </div>
                <span className={'status ' + event.status}>{statuses[event.status]}</span>
                <b>{number(eventUnits(event))} ед.</b>
                <time>{date(event.updatedAt)}</time>
            </div>
        ))}
    </div>

    const recentEmpty = <div className="empty">
        <span>◫</span>
        <h3>Здесь появится первая операция</h3>
        <p>Данные не создаются автоматически. Откройте API-клиент, чтобы проверить учёт и повтор запроса.</p>
    </div>

    const recent = <section className="panel recent-panel">
        <div className="panel-heading">
            <div>
                <h2>Последние операции</h2>
                <p>Обновляются вместе с состоянием сервиса.</p>
            </div>
            <button onClick={openClient}>Выполнить запрос ↗</button>
        </div>
        {last.length ? recentList : recentEmpty}
    </section>

    const budgetForm = <form onSubmit={saveBudget}>
        <label>Единиц в месяц
            <input name="units" type="number" min={1} max={10000} defaultValue={org.monthlyUnits} required/>
        </label>
        <label>Одновременных операций
            <input name="concurrent" type="number" min={1} max={20} defaultValue={org.concurrent} required/>
        </label>
        <button className="primary" disabled={busy}>Сохранить</button>
    </form>

    const budget = <section className="budget-settings">
        <div>
            <h2>Настройки тестового лимита</h2>
            <p>Изменения действуют для организации и проверяются сервером.</p>
        </div>
        <button disabled={busy} onClick={() => setEditing(!editing)}>
            {editing ? 'Закрыть' : 'Изменить лимиты'}
        </button>
        {editing && budgetForm}
    </section>

    return <>
        {heading}
        {stats}
        <div className="overview-grid">
            {quota}
            {access}
        </div>
        {recent}
        {org.role == 'owner' && budget}
    </>
}

function Audit({entries}: {entries: MeteringWorkspace['audit']}) {
    const list = entries.slice().reverse().map((entry, index) => (
        <article key={entry.at + ':' + index}>
            <span className="audit-dot"/>
            <div>
                <h2>{auditLabels[entry.action] ?? entry.action}</h2>
                <p>{entry.actor} · {entry.id}</p>
            </div>
            <time>{date(entry.at)}</time>
        </article>
    ))

    const empty = <div className="empty">
        <h3>История пока пуста</h3>
        <p>Создание ключа и операции учёта появятся здесь.</p>
    </div>

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">ПРОВЕРЯЕМАЯ ИСТОРИЯ</p>
                <h1>Действия и доступ</h1>
                <p>Ключи, ограничения и изменения состояния операций.</p>
            </div>
        </div>
        <div className="panel audit-list">{entries.length ? list : empty}</div>
    </>
}

createRoot(document.getElementById('root')!).render(<App/>)
