import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ContentDefinition} from '../backend/runtime'
import type {ContentWorkspace, PublishedPage} from '../backend/domain'
import {useServiceSession} from '../shared/react/service-session'
import {useServiceAction} from '../shared/react/service-action'
import {useCommandAction} from '../shared/react/command-action'
import {ServiceView} from '../shared/react/service-view'
import {PageEditor} from './editor'
import {ReviewDesk} from './review'
import {MediaLibrary} from './media'
import {PublicJournal} from './article'
import {roles, date, publicUrl, type Commands, type Resources} from './contracts'
import './style.css'

type tMemberRole = keyof typeof roles | 'revoked'

const initial: ContentWorkspace = {
    account: {account: '', name: ''}, organizations: [], people: [], pages: [], assets: [], audit: []
}
const publicInitial: {pages: PublishedPage[]} = {pages: []}

const navigation = [
    {id: 'pages', label: 'Материалы', icon: '▤'},
    {id: 'media', label: 'Медиатека', icon: '◈'},
    {id: 'journal', label: 'Для читателей', icon: '↗'},
    {id: 'team', label: 'Команда', icon: '◉'}
]

const titles: Record<string, string> = {
    pages: 'Материалы', media: 'Медиатека', team: 'Команда', journal: 'Для читателей'
}

// Ключ публикаций меняется, когда выходит новая версия любой страницы:
// по нему читательская часть понимает, что пора перечитать материал.
function revisionKeyOf(pages: PublishedPage[]) {
    return JSON.stringify(pages.map(page => [page.id, page.publicationRevision]))
}

function AnonymousJournal({orgId, slug}: {orgId: string, slug: string}) {
    const connection = useServiceSession<ContentDefinition>({
        url: location.origin, storageKey: 'folio-public-session', anonymous: true
    })
    if (!connection.session) return <PublicJournal orgId={orgId} initialSlug={slug}/>
    return <ServiceView remote={connection.session.views.published} initial={publicInitial}>
        {value => <PublicJournal orgId={orgId} initialSlug={slug} revisionKey={revisionKeyOf(value.pages)}/>}
    </ServiceView>
}

function App() {
    const connection = useServiceSession<ContentDefinition>({url: location.origin, storageKey: 'folio-staff-session'})
    const action = useServiceAction(connection.token)
    const commands = useCommandAction(connection.session?.commands)
    const [preset, setPreset] = useState('author')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const credentials = {account: form.get('account'), password: form.get('password')}
            const response = await fetch('/api/content/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [credentials]})
            })
            const data = await response.json()
            if (!response.ok || !data.ok) throw new Error(data.error?.message ?? 'Не удалось войти')
            connection.setToken(data.value.token)
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
            <a className="logo">Folio<span>CONTENT STUDIO</span></a>
            <p className="eyebrow">НАЧНИТЕ С ЧИСТОГО ЛИСТА</p>
            <h1>У каждой истории<br/>есть свой читатель.</h1>
            <p>Место, где черновик становится<br/>материалом, которому доверяют.</p>
            <div className="cover-art"><div/><span>F.</span><i/></div>
            <small>НАПИСАТЬ · ОБСУДИТЬ · ОПУБЛИКОВАТЬ</small>
        </section>
        <section className="login-form">
            <span className="eyebrow">ДОБРО ПОЖАЛОВАТЬ В РЕДАКЦИЮ</span>
            <h2>Хороший день<br/>для хорошего текста.</h2>
            <form onSubmit={login} key={preset}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" defaultValue={preset + '-pass'} type="password" autoComplete="current-password" required/>
                </label>
                <button className="primary" disabled={action.busy}>Открыть редакцию →</button>
            </form>
            <div className="presets">
                {Object.entries({...roles, outsider: 'Другая редакция'}).map(([id, label]) => (
                    <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                ))}
            </div>
            <small>Тестовые аккаунты. Пароль: аккаунт + «-pass».</small>
            <a className="public-login" href={publicUrl('northstar')}>Почитать журнал без входа ↗</a>
        </section>
    </main>

    const waiting = <main className="empty">
        <h1>Открываем редакцию…</h1>
        <button onClick={() => connection.setToken('')}>Вернуться ко входу</button>
    </main>

    let page = entry
    if (connection.token) {
        page = waiting
        if (connection.session && connection.me?.views.includes('workspace')) {
            page = <ServiceView remote={connection.session.views.workspace} initial={initial}>
                {value => (
                    <ServiceView remote={connection.session!.views.published} initial={publicInitial}>
                        {published => (
                            <Workspace
                                value={value}
                                publicRevision={revisionKeyOf(published.pages)}
                                resources={connection.session!.resources}
                                commands={commands}
                                connected={connection.connected}
                                logout={() => connection.setToken('')}
                            />
                        )}
                    </ServiceView>
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
    value: ContentWorkspace,
    publicRevision: string,
    resources: Resources,
    commands: Commands,
    connected: boolean,
    logout: () => void
}

function Workspace({value, publicRevision, resources, commands, connected, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [section, setSection] = useState('pages')
    const [selected, setSelected] = useState('')
    const [creating, setCreating] = useState(false)

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    // Читателю доступен только журнал; команда — только владельцу.
    let active = section
    if (org?.role == 'reader') active = 'journal'
    else if (section == 'team' && org?.role != 'owner') active = 'pages'

    const pages = value.pages.filter(item => item.orgId == org?.id)
    const page = pages.find(item => item.id == selected) ?? pages[0]
    const writer = org && ['owner', 'author', 'editor'].includes(org.role)

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setSelected('')
        setCreating(false)
        commands.clearError()
    }
    function openSection(id: string) {
        setSection(id)
        setCreating(false)
    }
    function openPage(id: string) {
        setSelected(id)
        setCreating(false)
    }
    function startDraft() {
        setCreating(true)
        setSelected('')
    }

    const visible = navigation.filter(function shown(item) {
        if (org?.role == 'reader') return item.id == 'journal'
        return item.id != 'team' || org?.role == 'owner'
    })

    const sidebar = <aside className="sidebar">
        <a className="logo" href="#" onClick={() => setSection('pages')}>Folio<span>CONTENT STUDIO</span></a>
        <label className="org-switch">Ваша редакция
            <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
                {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </label>
        <nav aria-label="Разделы редакции">
            {visible.map(item => (
                <button key={item.id} className={item.id == active ? 'active' : ''} onClick={() => openSection(item.id)}>
                    <span>{item.icon}</span>{item.label}
                </button>
            ))}
        </nav>
        <div className="sidebar-quote">
            <span>“</span>
            <p>История начинается<br/>с внимания к деталям.</p>
            <small>ВАША РЕДАКЦИЯ FOLIO</small>
        </div>
        <footer>
            <span>{value.account.name}</span>
            <small>{org ? roles[org.role] : ''}</small>
            <button aria-label="Выйти" onClick={logout}>↪</button>
        </footer>
    </aside>

    if (!org) {
        return <div className="studio">
            {sidebar}
            <main className="workspace">
                <section className="empty">
                    <h1>Нет доступной редакции</h1>
                    <p>Попросите владельца проверить вашу роль.</p>
                </section>
            </main>
        </div>
    }

    const shelf = <>
        <header className="page-heading">
            <div>
                <p className="eyebrow">МЕСТО ДЛЯ ВАШИХ ИСТОРИЙ</p>
                <h1>Редакционный портфель</h1>
                <p>От первой мысли до опубликованного материала.</p>
            </div>
            {writer && <button className="primary" onClick={startDraft}>+ Новый материал</button>}
        </header>
        <div className="page-shelf">
            {pages.map(item => (
                <button
                    key={item.id}
                    className={!creating && selected == item.id ? 'selected' : ''}
                    onClick={() => openPage(item.id)}
                >
                    <strong>{item.draft.title}</strong>
                    <small>
                        {item.publishedVersion ? 'В эфире · v' + item.publishedVersion : 'Черновик'}
                        {' · '}{date(item.updatedAt)}
                    </small>
                </button>
            ))}
        </div>
        {creating && writer ? <PageEditor
            key="new"
            page={null}
            org={org}
            resources={resources}
            commands={commands}
            assets={value.assets}
            account={value.account.account}
            created={openPage}
        /> : page ? <PageTabs
            key={page.id}
            page={page}
            org={org}
            resources={resources}
            commands={commands}
            assets={value.assets}
            account={value.account.account}
        /> : <p className="empty">Создайте первый материал своей редакции.</p>}
    </>

    const team = <section className="team">
        <p className="eyebrow">КТО ДЕЛАЕТ ЭТОТ ЖУРНАЛ</p>
        <h1>Команда редакции</h1>
        <p>Автор пишет, редактор согласовывает, издатель отвечает за выпуск.</p>
        {value.people.filter(person => person.orgId == org.id).map(person => (
            <article key={person.account}>
                <div>
                    <strong>{person.name}</strong>
                    <small>{person.account}</small>
                </div>
                <select
                    aria-label={'Роль ' + person.account}
                    value={person.role}
                    disabled={commands.busy}
                    onChange={event => void commands.run('memberRole', {
                        orgId: org.id, account: person.account, role: event.target.value as tMemberRole
                    })}
                >
                    {Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    <option value="revoked">Отозвать доступ</option>
                </select>
            </article>
        ))}
    </section>

    return <div className="studio">
        {sidebar}
        <main className="workspace">
            <header className="topbar">
                <span>{org.name} <i>/</i> {titles[active]}</span>
                <div>
                    <small>{connected ? '● На связи' : '○ Переподключение'}</small>
                    <button className="mobile-exit" onClick={logout}>Выйти</button>
                </div>
            </header>
            <div className="workspace-body" key={org.id + ':' + org.role + ':' + active}>
                {active == 'pages' && shelf}
                {active == 'media' && (
                    <MediaLibrary resources={resources} org={org} assets={value.assets} commands={commands}/>
                )}
                {active == 'journal' && <PublicJournal orgId={org.id} revisionKey={publicRevision}/>}
                {active == 'team' && team}
            </div>
        </main>
    </div>
}

type TabsProps = Omit<React.ComponentProps<typeof PageEditor>, 'created'> & {
    page: NonNullable<React.ComponentProps<typeof PageEditor>['page']>
}

function PageTabs(props: TabsProps) {
    const [tab, setTab] = useState(props.org.role == 'publisher' ? 'review' : 'edit')
    return <>
        <div className="page-tabs">
            <button className={tab == 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
                Черновик и предпросмотр
            </button>
            <button className={tab == 'review' ? 'active' : ''} onClick={() => setTab('review')}>
                Проверка и выпуск <span>{props.page.snapshots.length}</span>
            </button>
        </div>
        {tab == 'edit'
            ? <PageEditor {...props} created={() => {}}/>
            : <ReviewDesk page={props.page} org={props.org} resources={props.resources} commands={props.commands}/>}
    </>
}

const read = new URLSearchParams(location.hash.slice(1)).get('read')
const root = createRoot(document.getElementById('root')!)
if (read) root.render(<AnonymousJournal orgId={read.split('/')[0]} slug={read.split('/').slice(1).join('/')}/>)
else root.render(<App/>)
