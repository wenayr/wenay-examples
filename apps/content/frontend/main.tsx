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
type Page = ContentWorkspace['pages'][number]

const contentStages = {
    draft: {label: 'Черновики', description: 'Подготовка и правки'},
    review: {label: 'На проверке', description: 'Ждут решения редактора'},
    ready: {label: 'К выпуску', description: 'Версия согласована'},
    scheduled: {label: 'По расписанию', description: 'Ожидают времени выпуска'},
    published: {label: 'Опубликованы', description: 'Актуальная версия выпущена'}
} as const
type tContentStage = keyof typeof contentStages

function stageOf(page: Page): tContentStage {
    const snapshot = page.snapshots.at(-1)
    if (!snapshot || snapshot.draftRevision != page.draftRevision) return 'draft'
    const review = page.reviews.filter(item => item.version == snapshot.version).at(-1)
    if (review?.decision == 'changes') return 'draft'
    if (page.publishedVersion == snapshot.version) return 'published'
    if (review?.decision != 'approved') return 'review'
    const scheduled = page.schedules.some(item => item.version == snapshot.version && item.status == 'pending')
    return scheduled ? 'scheduled' : 'ready'
}

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
            <div className="logo">Folio<span>РЕДАКЦИЯ И ПУБЛИКАЦИИ</span></div>
            <p className="eyebrow">ОТ ЧЕРНОВИКА ДО ВЫПУСКА</p>
            <h1>Материал готов.<br/>Команда согласовала.<br/>Можно публиковать.</h1>
            <p>Создавайте страницы из блоков, обсуждайте конкретную версию и выпускайте одобренные материалы.</p>
            <ol className="login-benefits">
                <li><span>01</span> Текст, изображения и предпросмотр</li>
                <li><span>02</span> Замечания и согласование редактора</li>
                <li><span>03</span> Публикация сразу или по расписанию</li>
            </ol>
            <div className="cover-art" aria-hidden="true"><div/><span>F.</span><i/></div>
            <small>ЧЕРНОВИКИ ОСТАЮТСЯ В РЕДАКЦИИ. ЧИТАТЕЛИ ВИДЯТ ВЫПУЩЕННУЮ ВЕРСИЮ.</small>
        </section>
        <section className="login-form">
            <span className="eyebrow">ВХОД В FOLIO</span>
            <h2>Рабочее место редакции</h2>
            <p>Войдите, чтобы писать, проверять и публиковать материалы команды.</p>
            <form onSubmit={login} key={preset}>
                <label>Аккаунт
                    <input name="account" defaultValue={preset} autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" defaultValue={preset + '-pass'} type="password" autoComplete="current-password" required/>
                </label>
                <button className="primary" disabled={action.busy}>{action.busy ? 'Входим…' : 'Войти в редакцию'}</button>
            </form>
            <p className="demo-label">Проверить пример в роли</p>
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
        <h1>{connection.me && !connection.me.views.includes('workspace') ? 'Редакция недоступна' : 'Открываем редакцию…'}</h1>
        <p>{connection.me && !connection.me.views.includes('workspace')
            ? 'У этого аккаунта нет доступа к рабочему пространству. Войдите под другим аккаунтом.'
            : 'Загружаем материалы и ваши права доступа.'}</p>
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
    const [stage, setStage] = useState<tContentStage | 'all'>('all')
    const [query, setQuery] = useState('')

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    // Читателю доступен только журнал; команда — только владельцу.
    let active = section
    if (org?.role == 'reader') active = 'journal'
    else if (section == 'team' && org?.role != 'owner') active = 'pages'

    const pages = value.pages.filter(item => item.orgId == org?.id)
    const matches = pages.filter(function visiblePage(item) {
        if (stage != 'all' && stageOf(item) != stage) return false
        return item.draft.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    })
    const page = matches.find(item => item.id == selected) ?? matches[0]
    const writer = org && ['owner', 'author', 'editor'].includes(org.role)

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setSelected('')
        setCreating(false)
        setStage('all')
        setQuery('')
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
    function chooseStage(next: tContentStage | 'all') {
        setStage(next)
        setSelected('')
        setCreating(false)
    }
    function createdPage(id: string) {
        setStage('all')
        setQuery('')
        openPage(id)
    }
    function resetList() {
        chooseStage('all')
        setQuery('')
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
                <button
                    key={item.id} className={item.id == active ? 'active' : ''}
                    aria-current={item.id == active ? 'page' : undefined} onClick={() => openSection(item.id)}
                >
                    <span>{item.icon}</span>{item.label}
                </button>
            ))}
        </nav>
        <div className="sidebar-quote">
            <span>“</span>
            <p>Сначала проверка.<br/>Затем публикация.</p>
            <small>ЧИТАТЕЛЯМ ДОСТУПЕН ТОЛЬКО ВЫПУСК</small>
        </div>
        <footer>
            <span>{value.account.name}</span>
            <small>{org ? roles[org.role] : ''}</small>
            <button aria-label="Выйти" onClick={logout}>↪</button>
        </footer>
    </aside>

    if (!value.account.account) return <main className="empty" role="status"><h1>Загружаем материалы…</h1></main>

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

    let material = <section className="empty">
        <h2>{pages.length ? 'На этом этапе материалов нет' : 'Материалов пока нет'}</h2>
        {pages.length ? <>
            <p>Выберите другой этап или измените поисковый запрос.</p>
            <button onClick={resetList}>Показать все материалы</button>
        </> : <>
            <p>{writer ? 'Начните со статьи, инструкции или новости команды. Сохраните черновик и отправьте его на проверку.'
                : 'Материалы появятся здесь, когда автор создаст страницу.'}</p>
            {writer && <button className="primary" onClick={startDraft}>Создать материал</button>}
        </>}
    </section>
    if (creating && writer) {
        material = <PageEditor
            key="new" page={null} org={org} resources={resources} commands={commands}
            assets={value.assets} account={value.account.account} created={createdPage}
        />
    } else if (page) {
        material = <PageTabs
            key={page.id} page={page} org={org} resources={resources} commands={commands}
            assets={value.assets} account={value.account.account}
        />
    }

    const shelf = <>
        <header className="page-heading">
            <div>
                <p className="eyebrow">РАБОТА НАД ПУБЛИКАЦИЯМИ</p>
                <h1>Материалы редакции</h1>
                <p>Черновики, отправленные на проверку версии и выпущенные материалы.</p>
            </div>
            {writer && <button className="primary" onClick={startDraft}>+ Новый материал</button>}
        </header>
        <nav className="publication-stages" aria-label="Этапы подготовки материалов">
            <button aria-pressed={stage == 'all'} onClick={() => chooseStage('all')}>
                <strong>{pages.length}</strong><span>Все материалы</span><small>Вся работа редакции</small>
            </button>
            {Object.entries(contentStages).map(([id, step]) => <button
                key={id} aria-pressed={stage == id} onClick={() => chooseStage(id as tContentStage)}
            >
                <strong>{pages.filter(item => stageOf(item) == id).length}</strong><span>{step.label}</span><small>{step.description}</small>
            </button>)}
        </nav>
        <div className="editorial-layout">
            <aside className="material-list" aria-label="Список материалов">
                <div className="material-list-heading">
                    <h2>{stage == 'all' ? 'Все материалы' : contentStages[stage].label}</h2><span>{matches.length}</span>
                </div>
                <label>Поиск по названию
                    <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название материала"/>
                </label>
                <div className="page-shelf">
                {matches.map(item => (
                    <button
                        key={item.id}
                        className={!creating && page?.id == item.id ? 'selected' : ''}
                        aria-pressed={!creating && page?.id == item.id}
                        onClick={() => openPage(item.id)}
                    >
                        <span className={'material-stage ' + stageOf(item)}>{contentStages[stageOf(item)].label}</span>
                        <strong>{item.draft.title}</strong>
                        <small>
                            {item.publishedVersion ? 'Опубликована версия ' + item.publishedVersion : 'Черновик'}
                            {' · '}{date(item.updatedAt)}
                        </small>
                    </button>
                ))}
                </div>
                {!matches.length && <p className="material-list-empty">Подходящих материалов нет.</p>}
                <p className="material-list-note">Этап учитывает текущий черновик. Ранее опубликованная версия остаётся у читателей до нового выпуска.</p>
            </aside>
            <section className="material-detail" aria-label="Работа с выбранным материалом">
                {material}
            </section>
        </div>
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
                    disabled={commands.busy || !connected}
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
                    <small role="status">{connected ? '● На связи' : '○ Переподключение'}</small>
                    <button className="mobile-exit" onClick={logout}>Выйти</button>
                </div>
            </header>
            {!connected && <p className="connection-notice" role="status">Связь восстанавливается. Дождитесь подключения перед сохранением.</p>}
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
    const stage = stageOf(props.page)
    const [tab, setTab] = useState(stage == 'draft' && props.org.role != 'publisher' ? 'edit' : 'review')
    const pending = props.page.schedules.filter(item => item.status == 'pending').sort((a, b) => a.dueAt - b.dueAt)[0]
    const nextSteps = {
        draft: 'Сохраните правки и отправьте текущий черновик редактору. Читатели его ещё не видят.',
        review: 'Редактор проверяет отправленную версию. Замечания и решение находятся в разделе «Проверка и выпуск».',
        ready: 'Версия согласована. Издатель может выпустить её сразу или назначить время публикации.',
        scheduled: 'Версия запланирована к выпуску. В разделе «Проверка и выпуск» можно проверить или отменить расписание.',
        published: 'Текущая версия опубликована. Новые правки пройдут отдельное согласование.'
    }
    return <>
        <header className="material-heading">
            <div><p className="eyebrow">ВЫБРАННЫЙ МАТЕРИАЛ</p><h2>{props.page.draft.title}</h2></div>
            <span className={'material-stage ' + stage}>{contentStages[stage].label}</span>
        </header>
        <div className="material-context">
            <p>{nextSteps[stage]}</p>
            <dl>
                <div><dt>Отправлено версий</dt><dd>{props.page.snapshots.length}</dd></div>
                <div><dt>У читателей</dt><dd>{props.page.publishedVersion ? 'Версия ' + props.page.publishedVersion : 'Ещё не опубликовано'}</dd></div>
                {pending && <div><dt>Ближайший выпуск</dt><dd>{date(pending.dueAt)}</dd></div>}
            </dl>
        </div>
        <div className="page-tabs">
            <button className={tab == 'edit' ? 'active' : ''} aria-pressed={tab == 'edit'} onClick={() => setTab('edit')}>
                Черновик и предпросмотр
            </button>
            <button className={tab == 'review' ? 'active' : ''} aria-pressed={tab == 'review'} onClick={() => setTab('review')}>
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
