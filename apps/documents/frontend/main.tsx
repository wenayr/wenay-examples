import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {DocumentDefinition} from '../backend/runtime'
import type {DocumentWorkspace} from '../backend/domain'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {Studio} from './studio'
import {ProductKeys} from './product-keys'
import {type Commands, type Resources, formatDate, roleLabels} from './contracts'
import './style.css'

type tMemberRole = 'owner' | 'reviewer' | 'uploader' | 'revoked'

const initial: DocumentWorkspace = {
    account: {account: '', name: ''}, organizations: [], people: [], documents: [], audit: []
}
const tabs = [
    {id: 'documents', label: 'Документы', icon: '▤'},
    {id: 'team', label: 'Команда', icon: '◉'},
    {id: 'history', label: 'История', icon: '◷'}
] as const

const presets = {owner: 'Владелец', reviewer: 'Проверяющий', customer: 'Заказчик', outsider: 'Другая команда'}

function App() {
    const connection = useServiceSession<DocumentDefinition>({url: location.origin, storageKey: 'papertrail-token'})
    const action = useServiceAction(connection.token)
    const commands = useCommandAction(connection.session?.commands)
    const [preset, setPreset] = useState('owner')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/documents/login', {
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

    const error = connection.error || action.error || commands.error
    const banner = error ? (
        <div className="error-banner" role="alert">{error}
            <button aria-label="Закрыть сообщение" onClick={dismiss}>×</button>
        </div>
    ) : null

    const entry = <main className="login">
        <section className="login-story">
            <div className="brand"><span className="brand-mark">▱</span>papertrail</div>
            <div>
                <p className="eyebrow">ПРОВЕРКА ДОКУМЕНТОВ</p>
                <h1>Из файла —<br/>в проверенные данные.</h1>
                <p>Извлекайте таблицы из CSV, TXT и текстовых PDF. Исправляйте строки и передавайте команде подтверждённую версию.</p>
                <ol className="login-benefits">
                    <li><span>01</span><div><strong>Загрузите оригинал</strong><p>Исходный файл сохраняется отдельно от исправлений.</p></div></li>
                    <li><span>02</span><div><strong>Проверьте результат</strong><p>Сравните данные с источником и оставьте комментарий.</p></div></li>
                    <li><span>03</span><div><strong>Передайте дальше</strong><p>Подтвердите версию и выгрузите CSV или JSON.</p></div></li>
                </ol>
            </div>
            <footer className="login-footer">КАЖДОЕ ИЗМЕНЕНИЕ ОСТАЁТСЯ В ИСТОРИИ</footer>
        </section>
        <section className="login-form">
            <p className="eyebrow">СТУДИЯ ДОКУМЕНТОВ</p>
            <h2>Войти в Papertrail</h2>
            <p className="muted">Откройте документы и очередь проверки своей команды.</p>
            <form key={preset} className="stack" onSubmit={login}>
                <label>Аккаунт
                    <input name="account" autoComplete="username" required defaultValue={preset}/>
                </label>
                <label>Пароль
                    <input name="password" type="password" autoComplete="current-password" required defaultValue={preset + '-pass'}/>
                </label>
                <button className="primary" disabled={action.busy}>{action.busy ? 'Входим…' : 'Открыть студию →'}</button>
            </form>
            <div className="presets">
                <p className="muted">Попробовать демо в роли</p>
                <div className="row">
                    {Object.entries(presets).map(([id, label]) => (
                        <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                    ))}
                </div>
                <small>Демонстрационные аккаунты. Пароль — имя аккаунта + «-pass».</small>
            </div>
        </section>
    </main>

    const accessDenied = !!connection.me && !connection.me.views.includes('workspace')
    let waitingTitle = 'Открываем документы…'
    let waitingDescription = 'Проверяем доступ к рабочему пространству.'
    if (accessDenied) {
        waitingTitle = 'Нет доступа к документам'
        waitingDescription = 'Обратитесь к владельцу команды или войдите другим аккаунтом.'
    } else if (connection.error) {
        waitingTitle = 'Не удалось подключиться'
        waitingDescription = 'Проверьте соединение и повторите подключение.'
    }
    const waiting = <main className="loading">
        <h1>{waitingTitle}</h1>
        <p className="muted" role="status">{waitingDescription}</p>
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
                        resources={connection.session!.resources}
                        commands={commands}
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
    value: DocumentWorkspace,
    resources: Resources,
    commands: Commands,
    connected: boolean,
    logout: () => void
}

function Workspace({value, resources, commands, connected, logout}: WorkspaceProps) {
    const [scope, setScope] = useState(value.organizations[0]?.id ?? '')
    const [section, setSection] = useState<typeof tabs[number]['id']>('documents')
    const organization = value.organizations.find(item => item.id == scope) ?? value.organizations[0]
    const busy = !connected || commands.busy

    const sidebar = <aside className="sidebar">
        <a href="#documents" className="brand" onClick={() => setSection('documents')}>
            <span className="brand-mark">▱</span>papertrail
        </a>
        <label className="org-select">
            <span>РАБОЧЕЕ ПРОСТРАНСТВО</span>
            <select
                value={organization?.id ?? ''}
                aria-label="Организация"
                onChange={event => setScope(event.target.value)}
            >
                {value.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                {!organization && <option value="">Нет доступа</option>}
            </select>
        </label>
        <nav aria-label="Разделы студии">
            {tabs.filter(tab => tab.id != 'history' || organization?.role != 'uploader').map(tab => (
                <button
                    key={tab.id}
                    className={section == tab.id ? 'selected' : ''}
                    aria-current={section == tab.id ? 'page' : undefined}
                    onClick={() => setSection(tab.id)}
                >
                    <span aria-hidden="true">{tab.icon}</span>{tab.label}
                </button>
            ))}
        </nav>
        <div className="sidebar-note">
            <strong>Сначала проверка.</strong>
            <p>Оригинал сохраняется отдельно. Исправления и подтверждения остаются в истории документа.</p>
        </div>
        <div className="account">
            <span className="avatar">{value.account.name.slice(0, 1)}</span>
            <div>
                <strong>{value.account.name.split(' · ')[0]}</strong>
                <small>{organization ? roleLabels[organization.role] : 'Аккаунт'}</small>
            </div>
            <button aria-label="Выйти" title="Выйти" onClick={logout}>↪</button>
        </div>
    </aside>

    const team = <div className="page">
        <div className="page-heading">
            <div>
                <p className="eyebrow">ЛЮДИ И ДОСТУП</p>
                <h1>Команда студии</h1>
                <p>Владелец управляет доступом. Проверяющий подтверждает данные.</p>
            </div>
        </div>
        <div className="team-panel">
            <table className="data-table">
                <thead><tr><th>Участник</th><th>Роль</th></tr></thead>
                <tbody>
                    {value.people.filter(person => person.orgId == organization?.id).map(person => (
                        <tr key={person.account}>
                            <td style={{fontSize: 12, color: '#425875'}}>{person.name}</td>
                            <td>{organization?.role == 'owner' ? <select
                                className="role-picker"
                                aria-label={'Роль ' + person.name}
                                value={person.role}
                                disabled={busy}
                                onChange={event => void commands.run('memberRole', {
                                    orgId: organization.id,
                                    account: person.account,
                                    role: event.target.value as tMemberRole
                                })}
                            >
                                {Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                <option value="revoked">Закрыть доступ</option>
                            </select> : roleLabels[person.role]}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        {organization?.role == 'owner' && <ProductKeys key={organization.id} resources={resources}
            orgId={organization.id} orgName={organization.name}/>}
    </div>

    const history = <div className="page">
        <div className="page-heading">
            <div>
                <p className="eyebrow">ПРОЗРАЧНАЯ РАБОТА</p>
                <h1>История действий</h1>
                <p>Кто загрузил, изменил и подтвердил документы.</p>
            </div>
        </div>
        <div className="team-panel history">
            {[...value.audit].filter(item => item.orgId == organization?.id).reverse().map((item, index) => (
                <div className="history-item" key={index}>
                    <span>◷</span>
                    <div>
                        <strong>{actionLabel(item.action)}</strong>
                        <small>
                            {value.people.find(person => person.account == item.actor)?.name ?? item.actor}
                            {' · '}{formatDate(item.at)}
                        </small>
                    </div>
                </div>
            ))}
            {!value.audit.some(item => item.orgId == organization?.id) && (
                <p className="empty">Здесь появятся действия с документами.</p>
            )}
        </div>
    </div>

    const closed = <div className="empty">
        <h1>Доступ к команде закрыт</h1>
        <p>Обратитесь к владельцу рабочего пространства.</p>
        <button onClick={logout}>Сменить аккаунт</button>
    </div>

    return <div className="app">
        {sidebar}
        <main className="workspace">
            <header className="topbar">
                <span className="breadcrumbs">
                    Студия <span aria-hidden="true"> / </span><b>{tabs.find(tab => tab.id == section)?.label}</b>
                </span>
                <div className="row">
                    <span className={'connection' + (connected ? '' : ' offline')} role="status">
                        <i/>{connected ? 'Все изменения синхронизируются' : 'Восстанавливаем соединение…'}
                    </span>
                    <button className="mobile-logout" onClick={logout}>Выйти</button>
                </div>
            </header>
            {!connected && <p className="notice">Изменения станут доступны после восстановления связи.</p>}
            {!organization ? closed : <React.Fragment key={organization.id + ':' + section}>
                {section == 'documents' && (
                    <Studio value={value} org={organization} resources={resources} commands={commands} busy={busy}/>
                )}
                {section == 'team' && team}
                {section == 'history' && organization.role != 'uploader' && history}
            </React.Fragment>}
        </main>
    </div>
}

const actions: Record<string, string> = {
    'document.upload': 'Документ загружен',
    'document.row': 'Строка исправлена',
    'document.approve': 'Документ подтверждён',
    'document.reopen': 'Документ возвращён на проверку',
    'document.delete': 'Документ удалён',
    'document.extract': 'Данные извлечены'
}

function actionLabel(value: string) {
    if (actions[value]) return actions[value]
    if (value.includes('member')) return 'Права участника изменены'
    if (value.includes('complete')) return 'Обработка завершена'
    if (value.includes('start')) return 'Обработка запущена'
    if (value.includes('fail')) return 'Обработка не завершена'
    if (value.includes('cancel')) return 'Обработка отменена'
    return 'Документ обновлён'
}

createRoot(document.getElementById('root')!).render(<App/>)
