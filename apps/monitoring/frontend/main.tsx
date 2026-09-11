import React, {useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Overlay} from 'wenay-react2/ui'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {MonitoringDefinition} from '../backend/runtime'
import type {MonitoringWorkspace} from '../backend/domain'
import type {Monitor} from '../backend/model'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {ServiceView} from '../shared/react/service-view'
import {Tasks} from './tasks'
import {Assistant} from './assistant'
import {date, roles, type Commands, type Organization, type PublicStatus} from './contracts'
import './style.css'

type tMemberRole = 'owner' | 'oncall' | 'observer' | 'none'
type Observation = {outcome: string}
type Signal = {status: string, paused: boolean, lastAt: number, intervalMs: number, history: Observation[]}

const initial: MonitoringWorkspace = {
    account: '', organizations: [], presets: [], people: [],
    monitors: [], incidents: [], notices: [], quiet: [], audit: []
}

const sections = [
    ['overview', '◉', 'Сервисы'],
    ['incidents', '△', 'Инциденты'],
    ['tasks', '▤', 'Задачи'],
    ['notices', '◌', 'Уведомления'],
    ['team', '♧', 'Команда']
]

const headlines: Record<string, string> = {
    overview: 'Ясная картина.',
    incidents: 'От сигнала к решению.',
    tasks: 'Что нужно проверить.',
    notices: 'Ничего важного мимо.',
    team: 'Команда на связи.'
}

function useClock() {
    const [now, setNow] = useState(Date.now)
    useEffect(function clock() {
        const timer = window.setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [])
    return now
}

function outcomeTitle(point: string) {
    if (point == 'up') return 'Успешное измерение'
    if (point == 'down') return 'Сбой измерения'
    return 'Нет подтверждённых данных'
}

function outcomeLabel(outcome: string) {
    if (outcome == 'up') return 'Успех'
    if (outcome == 'down') return 'Ошибка'
    return 'Нет данных'
}

type TimelineProps = {history: {at: number, outcome: string}[], intervalMs: number, now: number}

function Timeline({history, intervalMs, now}: TimelineProps) {
    const points = Array.from({length: 50}, function interval(_value, index) {
        const from = now - (50 - index) * intervalMs
        const to = from + intervalMs
        return history.filter(point => point.at > from && point.at <= to).at(-1)?.outcome ?? 'unknown'
    })
    const label = 'Последние 50 интервалов; серый означает отсутствие подтверждённых данных'
    return <div className="timeline" aria-label={label}>
        {points.map((point, index) => <span key={index} className={point} title={outcomeTitle(point)}/>)}
    </div>
}

// Свежесть важнее последнего записанного статуса: молчащая проверка
// не считается работающей, даже если последнее измерение было успешным.
function signalStatus(monitor: Signal, now: number) {
    if (monitor.paused) return {id: 'paused', label: 'На паузе'}
    const silent = !monitor.lastAt || now - monitor.lastAt > monitor.intervalMs + 17000
    if (silent || monitor.history.at(-1)?.outcome == 'unknown') return {id: 'unknown', label: 'Нет свежих данных'}
    if (monitor.status == 'up') return {id: monitor.status, label: 'Работает'}
    if (monitor.status == 'down') return {id: monitor.status, label: 'Есть проблема'}
    return {id: monitor.status, label: 'Ожидаем измерения'}
}

function incidentLabel(status: string) {
    if (status == 'resolved') return 'Восстановлено'
    if (status == 'acknowledged') return 'Команда занимается проблемой'
    return 'Проверяем проблему'
}

// Короткие подписи для рабочего пространства; на публичной странице они длиннее.
function workLabel(status: string) {
    if (status == 'resolved') return 'Восстановлено'
    if (status == 'acknowledged') return 'В работе'
    return 'Нужна проверка'
}

function PublicPage({value, login}: {value: PublicStatus, login: () => void}) {
    const now = useClock()
    const statuses = value.services.map(service => signalStatus(service, now))
    const healthy = statuses.length > 0 && statuses.every(status => status.id == 'up')
    return <main className="public-page">
        <header>
            <a className="brand" href="#">◒ signal</a>
            <button onClick={login}>Вход для команды</button>
        </header>
        <p className="eyebrow">ОТКРЫТЫЙ СТАТУС СЕРВИСОВ</p>
        <h1>{healthy ? 'Всё работает.' : 'Знать, что происходит.'}</h1>
        <p className="lead">Последние подтверждённые измерения. Серые интервалы — время, за которое нет данных.</p>
        <div className="public-services">
            {value.services.map(function service(item) {
                const status = signalStatus(item, now)
                return <article key={item.id}>
                    <div>
                        <h2>{item.name}</h2>
                        <span className={'status ' + status.id}>● {status.label}</span>
                    </div>
                    <Timeline history={item.history} intervalMs={item.intervalMs} now={now}/>
                    <small>Последняя проверка: {date(item.lastAt)}</small>
                </article>
            })}
            {value.services.length == 0 && <div className="empty">Команда ещё не добавила публичные проверки.</div>}
        </div>
        <h2>История инцидентов</h2>
        {value.incidents.slice().reverse().map(incident => (
            <article className="incident" key={incident.id}>
                <span className={'status ' + (incident.status == 'resolved' ? 'up' : 'down')}>
                    {incidentLabel(incident.status)}
                </span>
                <h3>{incident.title}</h3>
                <small>{date(incident.openedAt)}{incident.closedAt ? ' → ' + date(incident.closedAt) : ''}</small>
            </article>
        ))}
        {value.incidents.length == 0 && <p className="muted">Опубликованных инцидентов пока нет.</p>}
        <footer>Signal · только наблюдаемые факты</footer>
    </main>
}

function App() {
    const session = useServiceSession<MonitoringDefinition>({
        url: location.origin, storageKey: 'signal-token', anonymous: true
    })
    const commands = useCommandAction(session.session?.commands)
    const action = useServiceAction(session.token)
    const [loginOpen, setLoginOpen] = useState(false)
    const [preset, setPreset] = useState('owner')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/monitoring/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [credentials]})
            })
            const body = await response.json()
            if (!body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            session.setToken(body.value.token)
            setLoginOpen(false)
        })
    }
    function dismiss() {
        session.dismissError()
        commands.clearError()
        action.clearError()
    }

    const error = session.error || commands.error || action.error
    const notice = error ? (
        <div className="error" role="alert">{error}
            <button aria-label="Закрыть ошибку" onClick={dismiss}>×</button>
        </div>
    ) : null

    const staff = session.token && session.me?.views.includes('workspace')
    let page = <main className="public-page">
        <h1>◒ signal</h1>
        <p>Подключаемся к текущему состоянию…</p>
        <button onClick={() => session.setToken(session.token)}>Повторить подключение</button>
        {session.token && <button onClick={() => session.setToken('')}>Выйти и открыть публичный статус</button>}
        <button onClick={() => setLoginOpen(true)}>Войти в команду</button>
    </main>
    if (session.session && staff) {
        page = <ServiceView remote={session.session.views.workspace} initial={initial}>
            {value => (
                <Workspace
                    key={value.account}
                    value={value}
                    session={session.session!}
                    commands={commands}
                    connected={session.connected}
                    logout={() => session.setToken('')}
                />
            )}
        </ServiceView>
    } else if (session.session) {
        const empty = {services: [], incidents: []} as PublicStatus
        page = <ServiceView remote={session.session.views.status} initial={empty}>
            {value => <PublicPage value={value} login={() => setLoginOpen(true)}/>}
        </ServiceView>
    }

    return <>
        {notice}
        {page}
        {loginOpen && <Overlay
            scrimClassName="scrim"
            outsideClassName="modal"
            ariaLabel="Вход в Signal"
            onEscape={() => setLoginOpen(false)}
        >
            <button className="close" aria-label="Закрыть вход" onClick={() => setLoginOpen(false)}>×</button>
            <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
            <h2>Спокойнее, когда знаешь.</h2>
            <form key={preset} onSubmit={login}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} required autoComplete="username"/>
                </label>
                <label>Пароль
                    <input name="password" type="password" defaultValue={preset + '-pass'} required autoComplete="current-password"/>
                </label>
                <button className="primary" disabled={action.busy}>Войти</button>
            </form>
            <div className="presets">
                {['owner', 'oncall', 'observer', 'outsider'].map(account => (
                    <button key={account} onClick={() => setPreset(account)}>
                        {account == 'outsider' ? 'Другая команда' : roles[account as keyof typeof roles]}
                    </button>
                ))}
            </div>
        </Overlay>}
    </>
}

type FormProps = {
    monitor?: Monitor,
    value: MonitoringWorkspace,
    org: Organization,
    commands: Commands,
    close: () => void
}

function MonitorForm({monitor, value, org, commands, close}: FormProps) {
    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const saved = await commands.run('monitorSave', {
            orgId: org.id,
            id: monitor?.id ?? '',
            revision: monitor?.revision ?? 0,
            name: String(form.get('name')),
            presetId: String(form.get('presetId')),
            preferred: String(form.get('preferred')),
            public: form.get('public') == 'on',
            paused: form.get('paused') == 'on',
            intervalMs: Number(form.get('interval')) * 1000,
            timeoutMs: Number(form.get('timeout')) * 1000,
            downThreshold: Number(form.get('down')),
            upThreshold: Number(form.get('up'))
        })
        if (saved) close()
    }

    const probes = value.people.filter(person => person.orgId == org.id && person.role == 'probe')
    return <Overlay
        scrimClassName="scrim"
        outsideClassName="modal"
        ariaLabel="Настройка проверки"
        onEscape={close}
    >
        <button className="close" aria-label="Закрыть настройки" onClick={close}>×</button>
        <p className="eyebrow">НЕБОЛЬШАЯ ПРОВЕРКА. БОЛЬШЕ ЯСНОСТИ.</p>
        <h2>{monitor ? 'Настройка проверки' : 'Новая проверка'}</h2>
        <form onSubmit={save}>
            <fieldset disabled={commands.busy}>
                <label>Название
                    <input name="name" defaultValue={monitor?.name} required maxLength={120}/>
                </label>
                <label>Сервис
                    <select name="presetId" defaultValue={monitor?.presetId} required>
                        {value.presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                </label>
                <label>Основной обработчик
                    <select name="preferred" defaultValue={monitor?.preferred ?? 'probe-a'}>
                        {probes.map(person => <option key={person.account} value={person.account}>{person.name}</option>)}
                    </select>
                </label>
                <div className="form-row">
                    <label>Интервал, секунд
                        <input name="interval" type="number" min="15" max="86400" defaultValue={(monitor?.intervalMs ?? 15000) / 1000} required/>
                    </label>
                    <label>Ждать ответ, секунд
                        <input name="timeout" type="number" min="0.1" max="10" step="0.1" defaultValue={(monitor?.timeoutMs ?? 3000) / 1000} required/>
                    </label>
                </div>
                <div className="form-row">
                    <label>Ошибок до инцидента
                        <input name="down" type="number" min="1" max="10" defaultValue={monitor?.downThreshold ?? 2} required/>
                    </label>
                    <label>Успехов до восстановления
                        <input name="up" type="number" min="1" max="10" defaultValue={monitor?.upThreshold ?? 2} required/>
                    </label>
                </div>
                <label className="inline">
                    <input name="public" type="checkbox" defaultChecked={monitor?.public}/>
                    Показывать на открытой странице статуса
                </label>
                <label className="inline">
                    <input name="paused" type="checkbox" defaultChecked={monitor?.paused}/>
                    Приостановить проверку
                </label>
                <button className="primary">Сохранить проверку</button>
            </fieldset>
        </form>
        <small>Адреса настраивает оператор. Здесь доступны только разрешённые сервисы.</small>
    </Overlay>
}

type WorkspaceProps = {
    value: MonitoringWorkspace,
    session: ServiceClient<MonitoringDefinition>,
    commands: Commands,
    connected: boolean,
    logout: () => void
}

function Workspace({value, session, commands, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [section, setSection] = useState('overview')
    const [editing, setEditing] = useState<Monitor | 'new' | null>(null)
    const [selected, setSelected] = useState('')
    const now = useClock()

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const staff = org?.role == 'owner' || org?.role == 'oncall'
    const owner = org?.role == 'owner'
    const monitors = value.monitors.filter(item => item.orgId == org?.id)
    const incidents = value.incidents.filter(item => item.orgId == org?.id)
    const notices = value.notices.filter(item => item.orgId == org?.id)
    const detail = monitors.find(item => item.id == selected)
    const active = staff ? section : 'overview'
    const counted = (id: string) => monitors.filter(item => signalStatus(item, now).id == id).length

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setSelected('')
        setEditing(null)
    }
    function acknowledge(incident: {id: string, revision: number}, event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        void commands.run('incidentAcknowledge', {
            orgId: org.id, id: incident.id, revision: incident.revision, body: String(form.get('body'))
        })
    }

    const sidebar = <aside className="sidebar">
        <a className="brand" href="#">◒ signal</a>
        <span className="caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
            {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <nav>
            {sections.filter(([id]) => staff || id == 'overview').map(([id, icon, label]) => (
                <button key={id} className={active == id ? 'active' : ''} onClick={() => setSection(id)}>
                    <span>{icon}</span>{label}
                </button>
            ))}
        </nav>
        <div className="sidebar-note">Тишина — это хорошо.<br/>Свежие данные — ещё лучше.</div>
        <button onClick={logout}>Выйти · {org ? roles[org.role] : 'Участник'}</button>
    </aside>

    const overview = <>
        <div className="metrics">
            <article>
                <span>Под наблюдением</span><strong>{monitors.length}</strong>
                <small>сервисов в этой команде</small>
            </article>
            <article>
                <span>Есть проблема</span><strong>{counted('down')}</strong>
                <small>подтверждено измерениями</small>
            </article>
            <article>
                <span>Нет свежих данных</span><strong>{counted('unknown')}</strong>
                <small>не означает, что всё работает</small>
            </article>
        </div>
        <div className="monitor-list">
            {monitors.map(function card(monitor) {
                const status = signalStatus(monitor, now)
                const known = monitor.history.filter(item => item.outcome != 'unknown')
                const passed = known.filter(item => item.outcome == 'up').length
                return <article key={monitor.id}>
                    <div className="monitor-heading">
                        <button className="title-button" onClick={() => setSelected(monitor.id)}>{monitor.name}</button>
                        <span className={'status ' + status.id}>● {status.label}</span>
                    </div>
                    <Timeline history={monitor.history} intervalMs={monitor.intervalMs} now={now}/>
                    <div className="monitor-foot">
                        <span>{passed} из {known.length} измерений успешны</span>
                        <span>{date(monitor.lastAt)}</span>
                        {owner && <button onClick={() => setEditing(monitor)}>Настроить</button>}
                    </div>
                </article>
            })}
            {monitors.length == 0 && <div className="empty">
                <h2>Начните с одного сервиса</h2>
                <p>Выберите его из разрешённых целей. Проверки и история появятся здесь.</p>
            </div>}
        </div>
        <p className="legend">
            <i className="up"/>Успех <i className="down"/>Ошибка <i className="unknown"/>Нет подтверждённых данных · 50 интервалов
        </p>
    </>

    const incidentList = <div className="incident-list">
        {incidents.slice().reverse().map(incident => (
            <article className="incident" key={incident.id}>
                <div className="monitor-heading">
                    <span className={'status ' + (incident.status == 'resolved' ? 'up' : 'down')}>
                        {workLabel(incident.status)}
                    </span>
                    <small>{date(incident.openedAt)}</small>
                </div>
                <h2>{incident.title}</h2>
                {incident.notes.map(note => (
                    <p className="note" key={note.id}>{note.body}
                        <small>{note.account} · {date(note.at)}</small>
                    </p>
                ))}
                {incident.status != 'resolved' && <form onSubmit={event => acknowledge(incident, event)}>
                    <label>Что проверяете?
                        <input name="body" required maxLength={2000} placeholder="Зафиксируйте следующий шаг"/>
                    </label>
                    <button disabled={commands.busy || !connected}>Взять в работу / добавить заметку</button>
                </form>}
            </article>
        ))}
        {incidents.length == 0 && <div className="empty">Инцидентов пока нет.</div>}
    </div>

    const noticeList = <>
        <label className="inline quiet">
            <input
                type="checkbox"
                checked={value.quiet.find(item => item.orgId == org.id)?.enabled ?? false}
                onChange={event => void commands.run('notificationSettings', {orgId: org.id, quiet: event.target.checked})}
            />
            Тихий режим: не создавать новые уведомления для меня
        </label>
        {notices.slice().reverse().map(item => (
            <article className={'notice ' + (item.read ? 'read' : '')} key={item.id}>
                <div>
                    <strong>{item.title}</strong>
                    <p>{incidents.find(incident => incident.id == item.incidentId)?.title}</p>
                    <small>{date(item.at)}</small>
                </div>
                {!item.read && (
                    <button onClick={() => void commands.run('noticeRead', {orgId: org.id, id: item.id})}>Прочитано</button>
                )}
            </article>
        ))}
        {notices.length == 0 && <p className="empty">Всё спокойно. Новые события появятся здесь.</p>}
    </>

    const team = <div className="people">
        {value.people.filter(item => item.orgId == org.id && item.role != 'probe').map(person => (
            <article key={person.account}>
                <div>
                    <strong>{person.name}</strong>
                    <small>{person.account}</small>
                </div>
                {owner ? <select
                    aria-label={'Роль ' + person.account}
                    value={person.role}
                    onChange={event => void commands.run('memberRole', {
                        orgId: org.id, revision: org.revision, account: person.account,
                        role: event.target.value as tMemberRole
                    })}
                >
                    {['owner', 'oncall', 'observer'].map(role => (
                        <option key={role} value={role}>{roles[role as keyof typeof roles]}</option>
                    ))}
                    <option value="none">Закрыть доступ</option>
                </select> : <span>{roles[person.role]}</span>}
            </article>
        ))}
    </div>

    return <div className="app">
        {sidebar}
        <main className="work">
            <header className="topbar">
                <span>{org?.name ?? 'Нет доступных организаций'}</span>
                <span className={connected ? 'online' : 'offline'}>
                    ● {connected ? 'На связи' : 'Переподключаемся'}
                </span>
            </header>
            {org && <div className="page">
                <div className="page-title">
                    <div>
                        <p className="eyebrow">ДЕРЖИМ РУКУ НА ПУЛЬСЕ</p>
                        <h1>{headlines[active]}</h1>
                        <p className="lead">
                            {active == 'overview'
                                ? 'Последние измерения и изменения, требующие внимания.'
                                : 'Общий контекст для спокойной работы.'}
                        </p>
                    </div>
                    {owner && active == 'overview' && (
                        <button className="primary" disabled={!connected} onClick={() => setEditing('new')}>
                            + Добавить сервис
                        </button>
                    )}
                </div>
                {active == 'overview' && overview}
                {active == 'incidents' && incidentList}
                {active == 'tasks' && <ServiceView remote={session.views.taskBoards} initial={{boards: []}}>
                    {data => {
                        const board = data.boards.find(item => item.orgId == org.id)
                        if (!board) return <p>Доска недоступна.</p>
                        return <Tasks board={board} commands={commands} busy={commands.busy || !connected}/>
                    }}
                </ServiceView>}
                {active == 'notices' && noticeList}
                {active == 'team' && team}
            </div>}
        </main>
        {org && editing && owner && <MonitorForm
            key={editing == 'new' ? 'new' : editing.id + ':' + editing.revision}
            monitor={editing == 'new' ? undefined : editing}
            value={value}
            org={org}
            commands={commands}
            close={() => setEditing(null)}
        />}
        {detail && <Overlay
            scrimClassName="scrim"
            outsideClassName="modal detail"
            ariaLabel={'Сервис ' + detail.name}
            onEscape={() => setSelected('')}
        >
            <button className="close" aria-label="Закрыть сервис" onClick={() => setSelected('')}>×</button>
            <p className="eyebrow">НАБЛЮДЕНИЯ</p>
            <h2>{detail.name}</h2>
            <Timeline history={detail.history} intervalMs={detail.intervalMs} now={now}/>
            <p className="muted">Последнее подтверждение: {date(detail.lastAt)}</p>
            {staff && <Assistant
                resources={session.resources}
                monitor={detail}
                incidentRevision={incidents.find(item => item.id == detail.incidentId)?.revision ?? 0}
            />}
            <div className="observations">
                {detail.history.slice(-20).reverse().map(item => (
                    <div key={item.attempt}>
                        <span className={'status ' + item.outcome}>{outcomeLabel(item.outcome)}</span>
                        <small>{date(item.at)}</small>
                        <span>{item.latencyMs} мс</span>
                        {staff && <small>{item.detail}</small>}
                    </div>
                ))}
            </div>
        </Overlay>}
    </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
