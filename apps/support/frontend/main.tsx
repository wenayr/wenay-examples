import React, {useEffect, useState} from 'react'
import type {createServiceClient} from 'wenay-common2/service/client'
import {createRoot} from 'react-dom/client'
import type {SupportDefinition} from '../backend/runtime'
import type {SupportWorkspace} from '../backend/domain'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {Inbox} from './inbox'
import {Tasks} from './tasks'
import {Notifications} from './notifications'
import type {NotificationView} from '../backend/notifications'
import type {TaskBoards} from '../backend/organizer'
import {Knowledge, Team, Audit} from './workspace'
import {Avatar, roleLabels, type CommandController, type SupportResources} from './contracts'
import './style.css'
import {OidcLogin} from './oidc-login'
import {ContentKnowledge} from './content-knowledge'
import {ProductKeys} from './product-keys'

const sections = [
    {id: 'inbox', title: 'Обращения', icon: '▤'},
    {id: 'tasks', title: 'Задачи команды', icon: '▦'},
    {id: 'notifications', title: 'Уведомления', icon: '♧'},
    {id: 'knowledge', title: 'База знаний', icon: '▥'},
    {id: 'team', title: 'Команда', icon: '◉'},
    {id: 'keys', title: 'Ключи интеграций', icon: '⚿'},
    {id: 'audit', title: 'История действий', icon: '◷'}
] as const

const initial: SupportWorkspace = {
    account: {account: '', name: ''}, organizations: [], people: [],
    tickets: [], articles: [], audit: [], invites: []
}

const presets = {
    owner: 'Владельца', lead: 'Руководителя', agent: 'Специалиста',
    customer: 'Клиента', outsider: 'Другой команды'
}
const initialBoards: TaskBoards = {boards: []}
type BoardsRemote = ReturnType<typeof createServiceClient<SupportDefinition>>['views']['taskBoards']
type NoticesRemote = ReturnType<typeof createServiceClient<SupportDefinition>>['views']['notifications']
const initialNotices: NotificationView = {preferences: [], notices: []}

function App() {
    const connection = useServiceSession<SupportDefinition>({url: location.origin, storageKey: 'support-token'})
    const loginAction = useServiceAction(connection.token)
    const commands = useCommandAction(connection.session?.commands)
    const [preset, setPreset] = useState('owner')
    const error = connection.error || loginAction.error || commands.error

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        connection.dismissError()
        await loginAction.action(async function authenticate() {
            const response = await fetch('/api/support/login', {
                method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [{account: form.get('account'), password: form.get('password')}]})
            })
            const body = await response.json()
            if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            connection.setToken(body.value.token)
        })
    }

    function dismiss() {
        connection.dismissError()
        loginAction.clearError()
        commands.clearError()
    }

    const banner = error ? (
        <div className="error-banner" role="alert">
            <strong>Действие не завершено.</strong> {error}
            <button aria-label="Закрыть сообщение об ошибке" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login-layout">
        <section className="login-story">
            <div className="brand">
                <span className="brand-mark">✳</span> northstar<span className="brand-tag">SUPPORT</span>
            </div>
            <p className="eyebrow">ОБРАЩЕНИЯ И РАБОТА КОМАНДЫ</p>
            <h1>От обращения<br/>до решения.</h1>
            <p className="login-description">
                Отвечайте клиентам, назначайте ответственных и сохраняйте решения в общей базе знаний.
            </p>
            <ol className="login-benefits">
                <li><span>01</span><div><strong>Соберите обращения</strong><p>Переписка и вложения доступны в одной карточке.</p></div></li>
                <li><span>02</span><div><strong>Распределите работу</strong><p>Ответственный, приоритет и срок первого ответа.</p></div></li>
                <li><span>03</span><div><strong>Сохраните решение</strong><p>Публичный ответ клиенту и заметки для команды.</p></div></li>
            </ol>
            <footer>Northstar · рабочее пространство поддержки</footer>
        </section>
        <section className="login-form-wrap">
            <div className="login-heading">
                <p className="eyebrow">ВАШЕ РАБОЧЕЕ МЕСТО</p>
                <h2>Войти в поддержку</h2>
                <p>Откройте обращения и задачи своей команды.</p>
            </div>
            <form key={preset} onSubmit={login} className="stack">
                <label>Аккаунт
                    <input name="account" autoComplete="username" defaultValue={preset} required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" autoComplete="current-password" defaultValue={preset + '-pass'} required/>
                </label>
                <button className="primary" disabled={loginAction.busy}>
                    {loginAction.busy ? 'Входим…' : 'Войти в рабочее пространство →'}
                </button>
            </form>
            <OidcLogin onToken={connection.setToken}/>
            <div className="demo-presets">
                <p>Попробовать демо в роли</p>
                <div>
                    {Object.entries(presets).map(([id, label]) => (
                        <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                    ))}
                </div>
                <small>Демонстрационные аккаунты. Пароль: имя аккаунта + «-pass».</small>
            </div>
        </section>
    </main>

    const accessDenied = !!connection.me && !connection.me.views.includes('workspace')
    let waitingTitle = 'Подключаемся к команде…'
    let waitingDescription = 'Загружаем обращения и проверяем доступ к рабочему пространству.'
    if (accessDenied) {
        waitingTitle = 'Нет доступа к рабочему пространству'
        waitingDescription = 'Обратитесь к владельцу команды или войдите другим аккаунтом.'
    } else if (connection.error) {
        waitingTitle = 'Не удалось подключиться'
        waitingDescription = 'Проверьте соединение и повторите подключение. Введённый аккаунт сохранён.'
    }
    const waiting = <main className="connection-state">
        <span className="brand-mark">✳</span>
        <h1>{waitingTitle}</h1>
        <p role="status">{waitingDescription}</p>
        {connection.error && !accessDenied && (
            <button className="primary" onClick={() => connection.setToken(connection.liveToken)}>Повторить подключение</button>
        )}
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
                        taskBoards={connection.session!.views.taskBoards}
                        notifications={connection.session!.views.notifications}
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
    value: SupportWorkspace,
    commands: CommandController,
    resources: SupportResources,
    taskBoards: BoardsRemote,
    notifications: NoticesRemote,
    connected: boolean,
    logout: () => void
}

function Workspace({value, commands, resources, taskBoards, notifications, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState(value.organizations[0]?.id ?? '')
    const [section, setSection] = useState<string>('inbox')
    const organization = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const scope = organization?.id ?? ''
    const open = value.tickets.filter(ticket => ticket.orgId == scope && ticket.status != 'resolved').length
    const manage = organization && (organization.role == 'owner' || organization.role == 'lead')
    const staff = !!organization && organization.role != 'customer'
    // Роль могли понизить при открытом разделе: возвращаем в общий inbox.
    const owner = organization?.role == 'owner'
    const closedForRole = (section == 'audit' && !manage) || (section == 'tasks' && !staff) || (section == 'keys' && !owner)
    const activeSection = closedForRole ? 'inbox' : section
    useEffect(function revokeSection() {
        if (activeSection != section) setSection(activeSection)
    }, [activeSection, section])
    const busy = commands.busy || !connected
    const visibleSections = sections.filter(function shown(item) {
        if (item.id == 'keys') return owner
        if (item.id == 'audit') return !!manage
        if (item.id == 'tasks') return staff
        return true
    })

    function switchOrg(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        commands.clearError()
    }

    return <div className="app-shell">
        <aside className="sidebar">
            <a className="brand" href="#inbox" onClick={() => setSection('inbox')}>
                <span className="brand-mark">✳</span> northstar
            </a>
            <span className="brand-tag sidebar-tag">CUSTOMER CARE</span>
            <label className="org-picker">
                <span>Рабочее пространство</span>
                <select value={scope} onChange={switchOrg} aria-label="Организация">
                    {value.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                    {!organization && <option value="">Нет организаций</option>}
                </select>
            </label>
            <nav aria-label="Разделы поддержки">
                {visibleSections.map(item => (
                    <button
                        className={activeSection == item.id ? 'selected' : ''}
                        aria-current={activeSection == item.id ? 'page' : undefined}
                        key={item.id}
                        onClick={() => setSection(item.id)}
                    >
                        <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                        {item.title}
                        {item.id == 'inbox' && <span className="nav-count">{open}</span>}
                    </button>
                ))}
            </nav>
            <div className="sidebar-note">
                <span>✧</span>
                <strong>Каждый ответ важен</strong>
                <p>Сохраняйте полезные решения в базе знаний команды.</p>
                <button onClick={() => setSection('knowledge')}>Открыть знания ↗</button>
            </div>
            <div className="account-block">
                <Avatar name={value.account.name}/>
                <div>
                    <strong>{value.account.name.split(' · ')[0]}</strong>
                    <small>{organization ? roleLabels[organization.role] : 'Участник'}</small>
                </div>
                <button title="Выйти" aria-label="Выйти из аккаунта" onClick={logout}>↪</button>
            </div>
        </aside>
        <main className="main-workspace">
            <header className="topbar">
                <div>
                    <span className="breadcrumb">Рабочее пространство <span>/</span></span>
                    <strong>{sections.find(item => item.id == activeSection)?.title}</strong>
                </div>
                <div>
                    <span className={'connection-pill' + (connected ? '' : ' offline')} role="status">
                        <i/>{connected ? 'На связи' : 'Переподключение…'}
                    </span>
                    <button className="mobile-logout" onClick={logout}>Выйти</button>
                </div>
            </header>
            {!connected && <p className="connection-notice" role="status">Связь восстанавливается. Изменения станут доступны после подключения.</p>}
            {organization ? <React.Fragment key={scope + ':' + activeSection}>
                {activeSection == 'inbox' && <Inbox value={value} org={organization} commands={commands} resources={resources} busy={busy}/>}
                {activeSection == 'tasks' && staff && <ServiceView remote={taskBoards} initial={initialBoards}>
                    {state => {
                        const board = state.boards.find(item => item.orgId == scope)
                        if (!board) return <p className="empty">Доска недоступна для текущей роли.</p>
                        return <Tasks board={board} commands={commands} busy={busy}/>
                    }}
                </ServiceView>}
                {activeSection == 'notifications' && <ServiceView remote={notifications} initial={initialNotices}>
                    {state => <Notifications value={state} orgId={scope} commands={commands} busy={busy}/>}
                </ServiceView>}
                {activeSection == 'knowledge' && <>
                    <Knowledge value={value} org={organization} commands={commands} busy={busy}/>
                    <ContentKnowledge resources={resources} orgId={scope} disabled={busy}/>
                </>}
                {activeSection == 'team' && <Team value={value} org={organization} commands={commands} busy={busy}/>}
                {activeSection == 'keys' && owner && <ProductKeys
                    resources={resources} commands={commands} orgId={scope} orgName={organization.name} disabled={busy}
                />}
                {activeSection == 'audit' && manage && <Audit value={value} orgId={scope}/>}
            </React.Fragment> : <section className="page-content">
                <h1>Присоединитесь к команде</h1>
                <p>Создайте организацию или примите приглашение.</p>
                <Team value={value} commands={commands} busy={busy}/>
            </section>}
        </main>
    </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
