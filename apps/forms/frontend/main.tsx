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

function publicationLabel(form: Form) {
    if (form.enabled) return 'Принимает ответы'
    if (form.publishedVersion) return 'Ссылка закрыта'
    return 'Черновик'
}

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
            <div className="brand">✳ petal</div>
            <p className="eyebrow">ФОРМЫ И ОБРАТНАЯ СВЯЗЬ</p>
            <h1>Соберите ответы.<br/>Увидьте результат.</h1>
            <p>Создавайте опросы, делитесь ссылкой с участниками и изучайте ответы в одном рабочем пространстве.</p>
            <ol className="login-benefits">
                <li><span>01</span> Вопросы с условиями показа</li>
                <li><span>02</span> Публикации с сохранением версий</li>
                <li><span>03</span> Итоги и выгрузка ответов</li>
            </ol>
            <div className="petal-art" aria-hidden="true"><i/><i/><i/><i/><span>✳</span></div>
            <small>Доступ к результатам и срок хранения задаёт команда опроса.</small>
        </section>
        <section className="login-form">
            <span className="eyebrow">ВХОД В PETAL</span>
            <h2>Опросы вашей команды</h2>
            <p>Войдите, чтобы редактировать формы, публиковать версии и работать с ответами.</p>
            <form onSubmit={login} key={preset}>
                <label>Аккаунт
                    <input name="account" autoComplete="username" defaultValue={preset} required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" autoComplete="current-password" defaultValue={preset + '-pass'} required/>
                </label>
                <button className="primary" disabled={action.busy}>{action.busy ? 'Входим…' : 'Войти в рабочее пространство'}</button>
            </form>
            <p className="demo-label">Проверить пример в роли</p>
            <div className="presets">
                {Object.entries({...roles, outsider: 'Другая команда'}).map(([id, label]) => (
                    <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>
                ))}
            </div>
            <small>Тестовые аккаунты. Пароль: аккаунт + «-pass».</small>
        </section>
    </main>

    const waiting = <main className="loading">
        <h1>{connection.me && !connection.me.views.includes('workspace') ? 'Опросы недоступны' : 'Открываем рабочее пространство…'}</h1>
        <p>{connection.me && !connection.me.views.includes('workspace')
            ? 'У этого аккаунта нет доступа к опросам команды. Войдите под другим аккаунтом.'
            : 'Загружаем список форм и ваши права доступа.'}</p>
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
    const [query, setQuery] = useState('')

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const forms = value.forms.filter(item => item.orgId == org?.id)
    const matchingForms = forms.filter(item => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    const row = matchingForms.find(item => item.id == selected) ?? matchingForms[0]
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
        setQuery('')
        commands.clearError()
    }
    function startDraft() {
        setCreating(true)
        setSelected('')
        setQuery('')
    }
    function openForm(id: string) {
        setSelected(id)
        setCreating(false)
    }

    const header = <header className="studio-header">
        <a className="brand" href="#" onClick={() => setSection('forms')}>✳ petal</a>
        <div className="header-org">
            <label>Рабочее пространство
                <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
                    {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>
        </div>
        <nav aria-label="Разделы опросов">
            <button
                className={effective == 'forms' ? 'active' : ''}
                aria-current={effective == 'forms' ? 'page' : undefined}
                onClick={() => setSection('forms')}
            >Опросы</button>
            {org?.role == 'owner' && (
                <button
                    className={effective == 'team' ? 'active' : ''}
                    aria-current={effective == 'team' ? 'page' : undefined}
                    onClick={() => setSection('team')}
                >Команда</button>
            )}
        </nav>
        <span className="connection" role="status">{connected ? '● На связи' : '○ Переподключение'}</span>
        <button className="logout" onClick={logout}>Выйти</button>
    </header>

    if (!value.me) return <main className="loading" role="status"><h1>Загружаем опросы…</h1></main>

    if (!org) {
        return <div className="studio">
            {header}
            <main className="empty">
                <h1>Нет доступной команды</h1>
                <p>Попросите владельца проверить вашу роль.</p>
            </main>
        </div>
    }

    const team = <section className="team-page">
        <span className="eyebrow">ДОСТУП К ОПРОСАМ</span>
        <h1>Участники и роли</h1>
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
                    disabled={commands.busy || !connected}
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
        <h2>{query ? 'Опрос не найден' : 'Опросов пока нет'}</h2>
        {query ? <>
            <p>Попробуйте другое название или вернитесь к полному списку.</p>
            <button onClick={() => setQuery('')}>Показать все опросы</button>
        </> : <>
            <p>{org.role == 'analyst' ? 'Опросы и их результаты появятся здесь, когда автор создаст форму.' : 'Создайте форму и добавьте вопросы.'}</p>
            <div className="form-use-cases"><span>Отзыв о встрече</span><span>Заявка на участие</span><span>Опрос команды</span></div>
            {org.role != 'analyst' && <button className="primary" onClick={startDraft}>Создать первый опрос</button>}
        </>}
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
            <p>Формы, публикации и ответы команды.</p>
            <div className="shelf-summary"><strong>{forms.filter(form => form.enabled).length}</strong> принимают ответы</div>
            {org.role != 'analyst' && <button className="primary" onClick={startDraft}>+ Новый опрос</button>}
            <label className="form-search">Найти опрос
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Название формы" type="search"/>
            </label>
            <div className="form-cards">
                {matchingForms.map(form => (
                    <button
                        key={form.id}
                        className={!creating && form.id == row?.id ? 'selected' : ''}
                        aria-pressed={!creating && form.id == row?.id}
                        onClick={() => openForm(form.id)}
                    >
                        <span className="form-icon">{form.enabled ? '✳' : '▤'}</span>
                        <strong>{form.title}</strong>
                        <small>Вопросов: {form.fields} · {publicationLabel(form)}</small>
                    </button>
                ))}
            </div>
            <footer>{value.me?.name} · {roles[org.role]}</footer>
        </aside>
        <main className="form-workspace">{detail}</main>
    </>

    return <div className="studio">
        {header}
        {!connected && <p className="connection-notice" role="status">Связь восстанавливается. Дождитесь подключения перед сохранением.</p>}
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
    const aggregates = value.aggregates.filter(item => item.formId == row.id)
    const answers = aggregates.reduce((count, item) => count + item.count, 0)
    const currentAnswers = aggregates.find(item => item.version == row.publishedVersion)?.count ?? 0
    let nextStep = 'Проверьте вопросы и сохраните изменения. Затем создайте публикацию для участников.'
    if (row.enabled) nextStep = 'Форма принимает ответы. Изучайте результаты; новая публикация заменит действующую ссылку.'
    else if (row.publishedVersion) nextStep = 'Приём ответов закрыт. История доступна, а для нового сбора нужна новая публикация.'
    if (org.role == 'analyst') nextStep = 'Смотрите результаты по версиям, сравнивайте ответы и готовьте выгрузку для команды.'
    return <>
        <header className="form-overview">
            <div>
                <p className="eyebrow">ОПРОС КОМАНДЫ</p>
                <h1>{row.title}</h1>
                {row.description && <p>{row.description}</p>}
            </div>
            <span className={'form-availability ' + (row.enabled ? 'open' : '')}>{publicationLabel(row)}</span>
        </header>
        <nav className="form-process" aria-label="Этапы работы с опросом">
            <button className={tab == 'editor' ? 'active' : ''} aria-pressed={tab == 'editor'} onClick={() => setTab('editor')}>
                <span className="process-index">01</span><strong>Вопросы</strong><small>{row.fields} в сохранённом черновике</small>
            </button>
            <button className={tab == 'publication' ? 'active' : ''} aria-pressed={tab == 'publication'} onClick={() => setTab('publication')}>
                <span className="process-index">02</span><strong>Публикация</strong>
                <small>{row.publishedVersion ? 'Последняя версия: ' + row.publishedVersion : 'Ещё не публиковали'}</small>
            </button>
            <button className={tab == 'results' ? 'active' : ''} aria-pressed={tab == 'results'} onClick={() => setTab('results')}>
                <span className="process-index">03</span><strong>Ответы</strong><small>{answers} по всем версиям · {currentAnswers} по последней</small>
            </button>
        </nav>
        <p className="form-next-step">{nextStep}</p>
        {tab == 'results'
            ? <Results resources={resources} commands={commands} org={org} row={row} workspace={value}/>
            : <FormEditor
                resources={resources} commands={commands} org={org} row={row} created={() => {}}
                section={tab == 'publication' ? 'publication' : 'questions'}
            />}
    </>
}

const publicToken = new URLSearchParams(location.hash.slice(1)).get('respond')
const root = createRoot(document.getElementById('root')!)
root.render(publicToken ? <Respondent token={publicToken}/> : <StaffApp/>)
