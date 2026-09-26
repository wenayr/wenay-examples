import React, {useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {BookingDefinition} from '../backend/runtime'
import type {BookingWorkspace} from '../backend/domain'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {Calendar} from './calendar'
import {Reservations} from './reservations'
import {Settings} from './settings'
import {roles, type Commands, type Resources} from './contracts'
import './style.css'

const initial: BookingWorkspace = {
    account: {account: '', name: ''}, organizations: [], people: [], resources: [],
    services: [], bookings: [], waitlist: [], notices: [], audit: []
}

const sections = [
    {id: 'calendar', label: 'Выбрать время', icon: '▦'},
    {id: 'bookings', label: 'Мои встречи', icon: '◷'},
    {id: 'settings', label: 'Услуги и расписание', icon: '☷'}
]

const presets = {
    customer: 'Клиент', customer2: 'Другой клиент', staff: 'Специалист',
    owner: 'Владелец', outsider: 'Другая команда'
}

function App() {
    const connection = useServiceSession<BookingDefinition>({url: location.origin, storageKey: 'daylight-token'})
    const commands = useCommandAction(connection.session?.commands)
    const action = useServiceAction(connection.token)
    const [preset, setPreset] = useState('customer')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/booking/login', {
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
        <div className="error-banner" role="alert">{error}
            <button aria-label="Закрыть ошибку" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login">
        <section className="login-story">
            <a className="brand"><span>◒</span> daylight<span>BOOKING STUDIO</span></a>
            <p className="eyebrow">ОСТАВЬТЕ ВРЕМЯ ДЛЯ ВАЖНОГО</p>
            <h1>Хорошая встреча<br/>начинается<br/>с удобного времени.</h1>
            <p>Запись к специалисту, спокойное планирование<br/>и чуть больше внимания к вашему дню.</p>
            <div className="sun-art"><i/><i/><span/></div>
            <small>Найдём время, которое подходит вам.</small>
        </section>
        <section className="login-form">
            <p className="eyebrow">РАДЫ НОВОЙ ВСТРЕЧЕ</p>
            <h2>Ваш день начинается здесь</h2>
            <p>Войдите, чтобы выбрать время или управлять расписанием.</p>
            <form key={preset} onSubmit={login}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" defaultValue={preset + '-pass'} autoComplete="current-password" required/>
                </label>
                <button className="primary" disabled={action.busy}>Продолжить →</button>
            </form>
            <div className="presets">
                {Object.entries(presets).map(([id, label]) => (
                    <button key={id} aria-pressed={id == preset} onClick={() => setPreset(id)}>{label}</button>
                ))}
                <small>Тестовые аккаунты. Пароль: аккаунт + «-pass».</small>
            </div>
        </section>
    </main>

    const waiting = <main className="loading">
        <h1>Подключаем календарь…</h1>
        <button onClick={() => connection.setToken('')}>Вернуться ко входу</button>
    </main>

    let page = entry
    if (connection.token) {
        page = waiting
        if (connection.session && connection.me?.views.includes('workspace')) {
            page = <ServiceView remote={connection.session.views.workspace} initial={initial}>
                {value => (
                    <Workspace
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
    value: BookingWorkspace,
    commands: Commands,
    resources: Resources,
    connected: boolean,
    logout: () => void
}

function Workspace({value, commands, resources, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [section, setSection] = useState('calendar')
    const [moving, setMoving] = useState('')

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const staff = org && org.role != 'customer'
    // Настройки закрываются вместе с ролью: клиента возвращаем в календарь.
    const active = section == 'settings' && !staff ? 'calendar' : section
    const busy = commands.busy || !connected

    useEffect(function revokeSection() {
        if (active != section) setSection(active)
    }, [active, section])

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setMoving('')
        commands.clearError()
    }
    function openSection(id: string) {
        setSection(id)
        setMoving('')
    }
    function moveBooking(id: string) {
        setMoving(id)
        setSection('calendar')
    }
    function moved() {
        setMoving('')
        setSection('bookings')
    }
    function cancelMove() {
        commands.clearError()
        moved()
    }

    const sidebar = <aside className="sidebar">
        <a className="brand" href="#calendar" onClick={() => setSection('calendar')}>
            <span>◒</span> daylight<span>BOOKING STUDIO</span>
        </a>
        <label className="org-switch">Рабочее пространство
            <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
                {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </label>
        <nav aria-label="Разделы записи">
            {sections.filter(item => staff || item.id != 'settings').map(item => (
                <button
                    key={item.id}
                    className={active == item.id ? 'active' : ''}
                    aria-current={active == item.id ? 'page' : undefined}
                    onClick={() => openSection(item.id)}
                >
                    <span>{item.icon}</span>
                    {item.id == 'bookings' && staff ? 'Встречи команды' : item.label}
                </button>
            ))}
        </nav>
        <div className="sidebar-note">
            <span>☀</span>
            <strong>Время — тоже забота.</strong>
            <p>Если планы изменились, перенесите запись. Освободившееся время пригодится другому.</p>
        </div>
        <div className="account">
            <span className="avatar">{value.account.name.slice(0, 1)}</span>
            <div>
                <strong>{value.account.name.split(' · ')[0]}</strong>
                <small>{org ? roles[org.role] : 'Участник'}</small>
            </div>
            <button aria-label="Выйти" onClick={logout}>↪</button>
        </div>
    </aside>

    const closed = <div className="page">
        <h1>Нет доступной организации</h1>
        <p>Попросите владельца проверить доступ.</p>
    </div>

    return <div className="app">
        {sidebar}
        <main className="workspace">
            <header className="topbar">
                <span>Daylight <i>/</i> {sections.find(item => item.id == active)?.label}</span>
                <div>
                    <span className={connected ? 'connection' : 'connection offline'}>
                        ● {connected ? 'На связи' : 'Переподключение'}
                    </span>
                    <button className="mobile-exit" onClick={logout}>Выйти</button>
                </div>
            </header>
            {org ? <div className="page" key={org.id + ':' + active + ':' + org.role}>
                {active == 'calendar' && <Calendar
                    value={value}
                    org={org}
                    resources={resources}
                    commands={commands}
                    busy={busy}
                    moving={moving}
                    done={moved}
                    cancelMove={cancelMove}
                />}
                {active == 'bookings' && (
                    <Reservations value={value} org={org} commands={commands} busy={busy} move={moveBooking}/>
                )}
                {active == 'settings' && staff && (
                    <Settings value={value} org={org} commands={commands} busy={busy}/>
                )}
            </div> : closed}
        </main>
    </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
