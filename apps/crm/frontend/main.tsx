import React, {useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {CrmDefinition} from '../backend/runtime'
import type {CrmWorkspace} from '../backend/domain'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {ServiceView} from '../shared/react/service-view'
import {Deals} from './deals'
import {Tasks} from './tasks'
import {Imports} from './imports'
import type {TaskBoards} from '../backend/organizer'
import type {ImportView} from '../backend/imports'
import {Directory, Team} from './workspace'
import {roles, date, type Commands, type Resources} from './contracts'
import './style.css'

const initial: CrmWorkspace = {
    me: {account: '', name: ''}, organizations: [], people: [],
    companies: [], contacts: [], deals: [], columns: [], audit: []
}

const initialBoards: TaskBoards = {boards: []}
const initialImports: ImportView = {imports: []}

const sections = [
    {id: 'deals', label: 'Сделки', icon: '◈'},
    {id: 'tasks', label: 'Задачи', icon: '▤'},
    {id: 'imports', label: 'Импорт CSV', icon: '↓'},
    {id: 'contacts', label: 'Контакты', icon: '◉'},
    {id: 'companies', label: 'Компании', icon: '▦'},
    {id: 'team', label: 'Команда', icon: '♧'},
    {id: 'audit', label: 'История', icon: '◷'}
] as const

function App() {
    const connection = useServiceSession<CrmDefinition>({url: location.origin, storageKey: 'orbit-token'})
    const commands = useCommandAction(connection.session?.commands)
    const action = useServiceAction(connection.token)
    const [preset, setPreset] = useState('owner')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/crm/login', {
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
        commands.clearError()
        action.clearError()
    }

    const error = connection.error || commands.error || action.error
    const banner = error ? (
        <div className="error" role="alert">{error}
            <button aria-label="Закрыть ошибку" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login">
        <section className="login-story">
            <div className="brand"><span>◎</span> orbit<span className="brand-caption">ПРОДАЖИ И КЛИЕНТЫ</span></div>
            <span className="eyebrow">ОТ ПЕРВОГО КОНТАКТА ДО СОГЛАСОВАНИЯ</span>
            <h1>Ведите сделки.<br/>Сохраняйте договорённости.</h1>
            <p>Следите за этапами продаж, готовьте предложения и получайте решение клиента в карточке сделки.</p>
            <ol className="login-benefits">
                <li><span>01</span><div><strong>Воронка продаж</strong><p>Этап, стоимость и ответственный по каждой сделке.</p></div></li>
                <li><span>02</span><div><strong>Предложения клиенту</strong><p>Отдельные версии с решением и комментариями.</p></div></li>
                <li><span>03</span><div><strong>Работа команды</strong><p>Контакты, история общения и связанные задачи.</p></div></li>
            </ol>
            <small>Orbit · продажи и согласование предложений</small>
        </section>
        <section className="login-form">
            <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО ПРОДАЖ</p>
            <h2>Войти в Orbit</h2>
            <p>Войдите в рабочее пространство команды.</p>
            <form key={preset} onSubmit={login}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" defaultValue={preset + '-pass'} autoComplete="current-password" required/>
                </label>
                <button className="primary" disabled={action.busy}>{action.busy ? 'Входим…' : 'Открыть сделки →'}</button>
            </form>
            <div className="presets">
                <p>Попробовать демо в роли</p>
                {Object.entries({...roles, outsider: 'Другой команды'}).map(([id, label]) => (
                    <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                ))}
                <small>Демонстрационный пароль: аккаунт + «-pass».</small>
            </div>
        </section>
    </main>

    const accessDenied = !!connection.me && !connection.me.views.includes('workspace')
    let waitingTitle = 'Подключаемся к команде…'
    let waitingDescription = 'Загружаем сделки и проверяем доступ к рабочему пространству.'
    if (accessDenied) {
        waitingTitle = 'Нет доступа к сделкам'
        waitingDescription = 'Обратитесь к владельцу команды или войдите другим аккаунтом.'
    } else if (connection.error) {
        waitingTitle = 'Не удалось подключиться'
        waitingDescription = 'Проверьте соединение и повторите подключение.'
    }
    const waiting = <main className="loading">
        <span className="brand">◎ orbit</span>
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
                        key={value.me!.account}
                        value={value}
                        commands={commands}
                        resources={connection.session!.resources}
                        views={connection.session!.views}
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
    value: CrmWorkspace,
    commands: Commands,
    resources: Resources,
    views: ServiceClient<CrmDefinition>['views'],
    connected: boolean,
    logout: () => void
}

function Workspace({value, commands, resources, views, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [section, setSection] = useState('deals')

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const staff = org && org.role != 'customer'
    const manage = org && (org.role == 'owner' || org.role == 'lead')
    const busy = commands.busy || !connected
    // Роль могли понизить при открытом разделе: недоступное закрываем, возвращая к сделкам.
    const forbidden = (!staff && section != 'deals') || (!manage && section == 'audit')
    const active = forbidden ? 'deals' : section

    useEffect(function clearForbidden() {
        if (active != section) setSection(active)
    }, [active, section])

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        commands.clearError()
    }
    function visible(item: (typeof sections)[number]) {
        if (!staff && item.id != 'deals') return false
        if (!manage && item.id == 'audit') return false
        return true
    }

    const sidebar = <aside className="sidebar">
        <a className="brand" href="#deals" onClick={() => setSection('deals')}>
            <span>◎</span> orbit<span className="brand-caption">CRM STUDIO</span>
        </a>
        <label className="org-select">Рабочее пространство
            <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
                {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </label>
        <nav aria-label="Разделы CRM">
            {sections.filter(visible).map(item => (
                <button
                    key={item.id}
                    className={active == item.id ? 'active' : ''}
                    aria-current={active == item.id ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                >
                    <span>{item.icon}</span>
                    {item.label}
                    {item.id == 'deals' && <b>{openDeals(value, org?.id)}</b>}
                </button>
            ))}
        </nav>
        <div className="sidebar-card">
            <span>✦</span>
            <strong>Следующий шаг по сделке</strong>
            <p>Откройте карточку, чтобы добавить заметку, обновить этап или подготовить предложение.</p>
        </div>
        <div className="account">
            <span className="avatar">{value.me!.name.slice(0, 1)}</span>
            <div>
                <strong>{value.me!.name.split(' · ')[0]}</strong>
                <small>{org ? roles[org.role] : 'Участник'}</small>
            </div>
            <button aria-label="Выйти" onClick={logout}>↪</button>
        </div>
    </aside>

    const audit = <>
        <div className="page-title">
            <p className="eyebrow">ПРОЗРАЧНЫЕ ДОГОВОРЁННОСТИ</p>
            <h1>История команды</h1>
        </div>
        <div className="timeline">
            {value.audit.filter(item => item.orgId == org?.id).slice().reverse().map(item => (
                <article key={item.id}>
                    <span>{date(item.at)}</span>
                    <strong>{item.action}</strong>
                    <p>{item.actor} · {item.target}</p>
                </article>
            ))}
        </div>
    </>

    const closed = <div className="page">
        <h1>Нет доступных организаций</h1>
        <p>Попросите владельца восстановить доступ.</p>
    </div>

    return <div className="app">
        {sidebar}
        <main className="workspace">
            <header className="topbar">
                <span>
                    Рабочее пространство <i>/</i> <strong>{sections.find(item => item.id == active)?.label}</strong>
                </span>
                <div>
                    <span className={'connection ' + (!connected ? 'offline' : '')}>
                        ● {connected ? 'На связи' : 'Переподключение'}
                    </span>
                    <button className="mobile-exit" onClick={logout}>Выйти</button>
                </div>
            </header>
            {org ? <div key={org.id + ':' + active} className="page">
                {active == 'deals' && (
                    <Deals value={value} org={org} commands={commands} resources={resources} busy={busy}/>
                )}
                {(active == 'contacts' || active == 'companies') && staff && (
                    <Directory kind={active} value={value} org={org} commands={commands} busy={busy}/>
                )}
                {active == 'tasks' && staff && (
                    <ServiceView remote={views.taskBoards} initial={initialBoards}>
                        {state => {
                            const board = state.boards.find(item => item.orgId == org.id)
                            if (!board) return <p>Доска недоступна</p>
                            return <Tasks board={board} commands={commands} busy={busy}/>
                        }}
                    </ServiceView>
                )}
                {active == 'imports' && staff && (
                    <ServiceView remote={views.imports} initial={initialImports}>
                        {imports => <Imports
                            value={imports}
                            workspace={value}
                            org={org}
                            resources={resources}
                            commands={commands}
                            busy={busy}
                        />}
                    </ServiceView>
                )}
                {active == 'team' && staff && (
                    <Team value={value} org={org} commands={commands} busy={busy}/>
                )}
                {active == 'audit' && manage && audit}
            </div> : closed}
        </main>
    </div>
}

// Счётчик в навигации: интересны только незаархивированные сделки текущей организации.
function openDeals(value: CrmWorkspace, orgId: string | undefined) {
    return value.deals.filter(deal => deal.orgId == orgId && !deal.archived).length
}

createRoot(document.getElementById('root')!).render(<App/>)
