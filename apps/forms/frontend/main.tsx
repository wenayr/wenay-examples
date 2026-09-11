import React, {useState, useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import type {FormsDefinition} from '../backend/runtime'
import type {FormsWorkspace} from '../backend/domain'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {ServiceView} from '../shared/react/service-view'
import {Respondent, authenticate} from './respondent'
import {FormEditor} from './editor'
import {Results} from './results'
import {roles, type Commands, type Resources} from './contracts'
import './style.css'

type Organization = FormsWorkspace['organizations'][number]
type Form = FormsWorkspace['forms'][number]
type tMemberRole = 'none' | keyof typeof roles

const initial: FormsWorkspace = {me: null, organizations: [], forms: [], people: [], aggregates: []}

function StaffApp() {
    const connection = useServiceSession<FormsDefinition>({url: location.origin, storageKey: 'petal-staff-session'})
    const commands = useCommandAction(connection.session?.commands)
    const action = useServiceAction(connection.token)
    const [preset, setPreset] = useState('owner')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authorize() {
            const token = await authenticate(String(form.get('account')), String(form.get('password')))
            connection.setToken(token)
        })
    }
    function dismiss() {
        connection.dismissError()
        action.clearError()
        commands.clearError()
    }

    const error = connection.error || action.error || commands.error
    const banner = error ? (
        <div className="error-banner" role="alert">{error}
            <button aria-label="Закрыть ошибку" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login">
        <section className="login-cover">
            <a className="brand">✳ petal</a>
            <p className="eyebrow">СНАЧАЛА — ХОРОШИЙ ВОПРОС</p>
            <h1>Больше слушать.<br/>Лучше понимать.</h1>
            <p>Небольшие опросы, из которых<br/>вырастают большие идеи.</p>
            <div className="petal-art"><i/><i/><i/><i/><span>✳</span></div>
            <small>Место для любопытства и честных ответов.</small>
        </section>
        <section className="login-form">
            <span className="eyebrow">ВАША МАСТЕРСКАЯ</span>
            <h2>Давайте начнём разговор</h2>
            <p>Войдите, чтобы создать опрос и услышать свою аудиторию.</p>
            <form onSubmit={login} key={preset}>
                <label>Аккаунт
                    <input name="account" autoComplete="username" defaultValue={preset} required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" autoComplete="current-password" defaultValue={preset + '-pass'} required/>
                </label>
                <button className="primary" disabled={action.busy}>Войти в мастерскую →</button>
            </form>
            <div className="presets">
                {Object.entries({...roles, outsider: 'Другая команда'}).map(([id, label]) => (
                    <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                ))}
            </div>
            <small>Тестовые аккаунты. Пароль: аккаунт + «-pass».</small>
        </section>
    </main>

    const waiting = <main className="loading">
        <h1>Открываем мастерскую…</h1>
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
    value: FormsWorkspace,
    commands: Commands,
    resources: Resources,
    connected: boolean,
    logout: () => void
}

function Workspace({value, commands, resources, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [selected, setSelected] = useState('')
    const [section, setSection] = useState('forms')
    const [creating, setCreating] = useState(false)

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const forms = value.forms.filter(item => item.orgId == org?.id)
    const row = forms.find(item => item.id == selected) ?? forms[0]
    // Роль могли понизить при открытом разделе команды: возвращаем к опросам.
    const effective = section == 'team' && org?.role != 'owner' ? 'forms' : section

    useEffect(function revokeSection() {
        if (effective != section) setSection(effective)
        if (org?.role == 'analyst') setCreating(false)
    }, [effective, section, org?.role])

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setSelected('')
        setCreating(false)
        commands.clearError()
    }
    function startDraft() {
        setCreating(true)
        setSelected('')
    }
    function openForm(id: string) {
        setSelected(id)
        setCreating(false)
    }

    const header = <header className="studio-header">
        <a className="brand" href="#" onClick={() => setSection('forms')}>✳ petal</a>
        <div className="header-org">
            <label>Мастерская
                <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
                    {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>
        </div>
        <nav aria-label="Разделы мастерской">
            <button className={effective == 'forms' ? 'active' : ''} onClick={() => setSection('forms')}>Опросы</button>
            {org?.role == 'owner' && (
                <button className={effective == 'team' ? 'active' : ''} onClick={() => setSection('team')}>Команда</button>
            )}
        </nav>
        <span className="connection">{connected ? '● На связи' : '○ Переподключение'}</span>
        <button className="logout" onClick={logout}>Выйти</button>
    </header>

    if (!org) {
        return <div className="studio">
            {header}
            <main className="empty">
                <h1>Нет доступной мастерской</h1>
                <p>Попросите владельца проверить вашу роль.</p>
            </main>
        </div>
    }

    const team = <section className="team-page">
        <span className="eyebrow">ЛЮДИ ЗА ВОПРОСАМИ</span>
        <h1>Команда мастерской</h1>
        <p>
            Автор редактирует и публикует. Аналитик читает ответы и готовит выгрузки.
            Только владелец исправляет и удаляет ответы.
        </p>
        {value.people.filter(person => person.orgId == org.id).map(person => (
            <article className="person" key={person.account}>
                <strong>{person.account}</strong>
                <select
                    aria-label={'Роль ' + person.account}
                    value={person.role}
                    disabled={commands.busy}
                    onChange={event => void commands.run('memberRole', {
                        orgId: org.id, revision: org.revision, account: person.account,
                        role: event.target.value as tMemberRole
                    })}
                >
                    <option value="none">Отозвать доступ</option>
                    {Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
            </article>
        ))}
    </section>

    let detail = <section className="empty">
        <h2>Здесь начинается разговор</h2>
        <p>Создайте свой первый опрос.</p>
    </section>
    if (creating) {
        function created(id: string) {
            setSelected(id)
            setCreating(false)
        }
        detail = <FormEditor key="new" resources={resources} commands={commands} org={org} row={null} created={created}/>
    } else if (row) {
        detail = <FormPage key={row.id + ':' + org.role} resources={resources} commands={commands} org={org} row={row} value={value}/>
    }

    const shelf = <>
        <aside className="form-shelf">
            <div className="shelf-title">
                <h1>Ваши опросы</h1>
                <span>{forms.length}</span>
            </div>
            <p>Один вопрос может<br/>многое изменить.</p>
            {org.role != 'analyst' && <button className="primary" onClick={startDraft}>+ Новый опрос</button>}
            <div className="form-cards">
                {forms.map(form => (
                    <button
                        key={form.id}
                        className={!creating && form.id == row?.id ? 'selected' : ''}
                        onClick={() => openForm(form.id)}
                    >
                        <span className="form-icon">{form.enabled ? '✳' : '▤'}</span>
                        <strong>{form.title}</strong>
                        <small>{form.fields} вопросов · {form.enabled ? 'Принимает ответы' : 'Черновик'}</small>
                    </button>
                ))}
            </div>
            <footer>{value.me?.name} · {roles[org.role]}</footer>
        </aside>
        <main className="form-workspace">{detail}</main>
    </>

    return <div className="studio">
        {header}
        <div key={org.id + ':' + org.role} className="studio-body">
            {effective == 'team' ? team : shelf}
        </div>
    </div>
}

type PageProps = {
    resources: Resources,
    commands: Commands,
    org: Organization,
    row: Form,
    value: FormsWorkspace
}

function FormPage({resources, commands, org, row, value}: PageProps) {
    const [tab, setTab] = useState(org.role == 'analyst' ? 'results' : 'editor')
    return <>
        <div className="form-tabs">
            <button className={tab == 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>
                Вопросы и публикации
            </button>
            <button className={tab == 'results' ? 'active' : ''} onClick={() => setTab('results')}>
                Ответы и итоги
            </button>
            <span>{row.enabled ? '● Ссылка открыта' : '○ Ссылка закрыта'}</span>
        </div>
        {tab == 'editor'
            ? <FormEditor resources={resources} commands={commands} org={org} row={row} created={() => {}}/>
            : <Results resources={resources} commands={commands} org={org} row={row} workspace={value}/>}
    </>
}

const publicToken = new URLSearchParams(location.hash.slice(1)).get('respond')
const root = createRoot(document.getElementById('root')!)
root.render(publicToken ? <Respondent token={publicToken}/> : <StaffApp/>)
