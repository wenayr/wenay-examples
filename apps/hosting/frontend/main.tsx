import React, {useEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useOwnedClient, useClientStore, useAsyncAction, useServiceCommands} from 'wenay-react2/react'
import {createServiceClient, type ServiceClientDefinition, type ServiceClient} from 'wenay-common2/service/client'
import type {HostingRuntimeDefinition as HostingDefinition} from '../backend/runtime'
import {Machines} from './machines'
import {PublicOrigin} from './public-origin'
import './style.css'

function message(error: unknown) {
    if (error instanceof Error) return error.message
    return error ? String(error) : ''
}

const statuses = {
    queued: 'В очереди',
    running: 'Выполняется',
    succeeded: 'Завершено',
    failed: 'Ошибка',
    cancelled: 'Отменено'
}

function App() {
    const [token, setToken] = useState(sessionStorage.getItem('hosting-token') ?? '')
    const epoch = useRef(0)

    function authenticate(value: string) {
        epoch.current++
        owned.close()
        if (value) sessionStorage.setItem('hosting-token', value)
        else sessionStorage.removeItem('hosting-token')
        setToken(value)
    }
    async function connect(signal: AbortSignal) {
        const generation = epoch.current
        const response = await fetch('/api/client', {signal})
        if (!response.ok) throw new Error('Сервис недоступен')
        const definition: ServiceClientDefinition<HostingDefinition> = await response.json()
        return createServiceClient<HostingDefinition>({
            definition,
            url: window.location.origin,
            auth: {token},
            onToken: value => {
                if (!signal.aborted && generation == epoch.current) sessionStorage.setItem('hosting-token', value)
            }
        })
    }

    const owned = useOwnedClient({key: token, enabled: !!token, create: connect})

    let page = <Login authenticate={authenticate}/>
    if (token) {
        page = <main role="status">Подключаемся к проектам…</main>
        if (owned.error) page = <main role="alert">{message(owned.error)}</main>
        else if (owned.ready && owned.client) page = <Dashboard key={token} client={owned.client}/>
    }

    return <>
        <header>
            <a href="/">◈ ХОСТИНГ</a>
            <span>Проекты · Окружения · Версии</span>
            {token && <button onClick={function logout() {authenticate('')}}>Выйти</button>}
        </header>
        {page}
    </>
}

function Login({authenticate}: {authenticate: (token: string) => void}) {
    const action = useAsyncAction()
    const abort = useMemo(() => new AbortController(), [])
    useEffect(() => () => {abort.abort()}, [abort])

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        try {
            await action.run(async function login() {
                const credentials = {account: data.get('account'), password: data.get('password')}
                const response = await fetch('/api/hosting/login', {
                    method: 'POST',
                    signal: abort.signal,
                    headers: {'content-type': 'application/json'},
                    body: JSON.stringify({args: [credentials]})
                })
                const body = await response.json()
                if (!body.ok) throw new Error('Проверьте логин и пароль')
                abort.signal.throwIfAborted()
                authenticate(body.value.token)
            })
        } catch {}
    }

    return <main className="login">
        <section className="login-story">
            <p className="eyebrow">РАЗМЕЩЕНИЕ ПРИЛОЖЕНИЙ</p>
            <h1>Выпускайте версии.<br/>Сохраняйте контроль.</h1>
            <p>Разверните приложение на своём сервере, проверьте результат и при необходимости верните предыдущую версию.</p>
            <ol className="login-steps">
                <li><strong>Подключите сервер</strong><span>Исполнитель запускает приложения в выбранном окружении.</span></li>
                <li><strong>Выберите версию</strong><span>История сохраняет результат каждого развёртывания.</span></li>
                <li><strong>Проверьте сервис</strong><span>Рабочий адрес и состояние доступны в карточке окружения.</span></li>
            </ol>
        </section>
        <form className="login-card" onSubmit={submit}>
            <h2>Войти в панель</h2>
            <p className="muted">Используйте аккаунт, которому открыт доступ к проектам.</p>
            <fieldset disabled={action.pending}>
                <label>Логин
                    <input name="account" autoComplete="username" required/>
                </label>
                <label>Пароль
                    <input name="password" type="password" autoComplete="current-password" required/>
                </label>
                <button className="primary">{action.pending ? 'Входим…' : 'Открыть проекты'}</button>
            </fieldset>
            {!!action.error && <p role="alert">{message(action.error)}</p>}
        </form>
    </main>
}

function Dashboard({client}: {client: ServiceClient<HostingDefinition>}) {
    const permissions = useClientStore(useMemo(() => ({store: client.identity.permissions}), [client]))
    const health = useClientStore(useMemo(() => ({store: client.health}), [client]))
    const canRead = permissions.state?.views.includes('dashboard') ?? false
    const dashboard = useClientStore(canRead ? client.views.dashboard : null)
    const [project, setProject] = useState('')

    const state = dashboard.state
    if (!permissions.ready) return <main className="connection-state" role="status">Проверяем доступ к проектам…</main>
    if (!canRead) {
        return <main className="connection-state">
            <h1>Доступ к панели отсутствует</h1>
            <p>Учётная запись исполнителя подключается через отдельный агент.</p>
        </main>
    }
    if (!health.state?.connected) return <main className="connection-state" role="status">Восстанавливаем соединение с сервером…</main>
    if (!state?.projects || !dashboard.ready) return <main className="connection-state" role="status">Загружаем проекты и окружения…</main>

    const selected = state.projects.find(item => item.id == project) ?? state.projects[0]
    const allowed = permissions.state?.commands ?? []

    const empty = <section className="empty-state">
        <h2>Пока нет проектов</h2>
        <p>{allowed.includes('createProject')
            ? 'Создайте первый проект, затем добавьте окружение и версию приложения.'
            : 'Попросите владельца добавить вас в проект. Доступные окружения появятся здесь.'}</p>
    </section>

    const projects = selected && <>
        <label className="project-select">Проект
            <select value={selected.id} onChange={function choose(event) {setProject(event.target.value)}}>
                {state.projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
        </label>
        <Project key={selected.id} client={client} project={selected.id} state={state} allowed={allowed}
            canSetOrigin={permissions.state?.roles.some(role => role == 'admin' || role == 'owner') ?? false}/>
        {permissions.state?.views.includes('machineDashboard') && (
            <Machines key={'machines-' + selected.id} client={client} project={selected.id} allowed={allowed}/>
        )}
    </>

    return <main>
        <div className="page-title">
            <div>
                <p className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</p>
                <h1>Проекты и окружения</h1>
                <p className="muted">Выберите проект, чтобы развернуть версию или проверить работающий сервис.</p>
            </div>
            <span className="connected">● На связи · {permissions.state?.account}</span>
        </div>
        {allowed.includes('createProject') && (
            <details>
                <summary>Создать проект</summary>
                <CommandForm client={client} kind="project" project=""/>
            </details>
        )}
        {state.projects.length ? projects : empty}
    </main>
}

type DashboardState = ServiceClient<HostingDefinition>['views']['dashboard']['store']['state']
type Environment = DashboardState['environments'][number]
type Operation = DashboardState['operations'][number]

type ProjectProps = {
    client: ServiceClient<HostingDefinition>,
    project: string,
    state: DashboardState,
    allowed: string[]
    canSetOrigin: boolean
}

function Project({client, project, state, allowed, canSetOrigin}: ProjectProps) {
    const commands = useServiceCommands(client.commands)

    const releases = state.releases.filter(item => item.project == project)
    const environments = state.environments.filter(item => item.project == project)
    const operations = state.operations.filter(item => item.project == project)
    const working = operations.filter(item => item.status == 'queued' || item.status == 'running')
    const active = environments.filter(item => item.active)
    const failed = operations.filter(item => item.status == 'failed')
    const canCreateEnvironment = allowed.includes('createEnvironment')
    const canPublishRelease = allowed.includes('publishRelease')
    const canDeploy = allowed.includes('deploy')

    let next = {
        title: canDeploy ? 'Выберите версию для развёртывания' : 'Проверьте состояние окружений',
        description: canDeploy
            ? 'Укажите версию в карточке окружения. Результат появится в истории операций.'
            : 'Вам доступны версии и история проекта. Для запуска приложения обратитесь к оператору или владельцу.',
        href: '#project-environments'
    }
    if (!environments.length) {
        next = {
            title: canCreateEnvironment ? 'Подготовьте первое окружение' : 'Окружения ещё не подготовлены',
            description: canCreateEnvironment
                ? 'Нужны сервер и аккаунт исполнителя. Создание записи окружения само по себе не запускает приложение.'
                : 'Попросите владельца проекта добавить окружение и подключить исполнителя. Здесь появятся состояние и адрес приложения.',
            href: '#project-environments'
        }
    } else if (!releases.length) {
        next = {
            title: canPublishRelease ? 'Добавьте версию приложения' : 'Версии приложения ещё не опубликованы',
            description: canPublishRelease
                ? 'Укажите подготовленный образ, порт и адрес проверки готовности. Затем вернитесь к окружению.'
                : 'Попросите владельца проекта опубликовать подготовленную версию. После этого она появится в списке.',
            href: '#project-releases'
        }
    } else if (working.length) {
        next = {
            title: 'Операции в работе: ' + working.length,
            description: 'Дождитесь отчёта исполнителя. Для окружения с незавершённой операцией новый запуск недоступен.',
            href: '#deployment-history'
        }
    } else if (active.length) {
        next = {
            title: 'Активная версия назначена: ' + active.length + ' окруж.',
            description: 'Откройте рабочий адрес, проверьте приложение и историю перед следующим обновлением.',
            href: '#project-environments'
        }
    }

    async function deploy(event: React.FormEvent<HTMLFormElement>, environment: Environment) {
        event.preventDefault()
        const release = String(new FormData(event.currentTarget).get('release'))
        try {
            await commands.run('deploy', {environment: environment.id, release, revision: environment.revision})
        } catch {}
    }
    async function rollback(environment: Environment, release: string) {
        try {
            await commands.run('rollback', {environment: environment.id, release, revision: environment.revision})
        } catch {}
    }
    async function cancel(operation: Operation) {
        try {
            await commands.run('cancelQueued', {operation: operation.id, revision: operation.revision})
        } catch {}
    }
    // Вернуть можно только на успешно развёрнутую ранее и сейчас неактивную версию.
    function restorable(environment: Environment) {
        const succeeded = state.operations.filter(function suitable(item) {
            if (item.environment != environment.id) return false
            if (item.status != 'succeeded') return false
            return item.release != environment.active
        })
        return [...new Set(succeeded.map(item => item.release))]
    }
    function version(release: string | undefined) {
        return releases.find(item => item.id == release)?.version
    }

    const workflow = <section className="deployment-workflow">
        <div className="deployment-next">
            <div><p className="eyebrow">ПРОЕКТ → ОКРУЖЕНИЕ → ВЕРСИЯ</p><h2>{next.title}</h2><p>{next.description}</p></div>
            <a className="workflow-link" href={next.href}>Открыть раздел →</a>
        </div>
        <nav className="deployment-stages" aria-label="Шаги размещения проекта">
            <a href="#project-environments"><span>01 / Окружения</span><strong>{environments.length}</strong>
                <small>{active.length} с назначенной активной версией</small></a>
            <a href="#project-releases"><span>02 / Версии</span><strong>{releases.length}</strong>
                <small>Подготовлены для этого проекта</small></a>
            <a href="#deployment-history"><span>03 / Результат</span><strong>{working.length} в работе</strong>
                <small>{failed.length} ошибок в истории</small></a>
        </nav>
    </section>

    function address(environment: Environment) {
        if (environment.route) {
            return <p>
                <a href={environment.route} target="_blank" rel="noreferrer">Открыть приложение ↗</a>
                <br/>
                <small>Постоянный адрес: {environment.route}</small>
            </p>
        }
        if (!environment.endpoint) return null
        return <a href={environment.endpoint} target="_blank" rel="noreferrer">Открыть прежний адрес ↗</a>
    }

    function deployForm(environment: Environment) {
        return <form onSubmit={event => deploy(event, environment)}>
            <fieldset disabled={commands.pending || !releases.length}>
                <label>Версия
                    <select name="release" defaultValue={environment.active || releases[0]?.id}>
                        {releases.map(item => <option key={item.id} value={item.id}>{item.version}</option>)}
                    </select>
                </label>
                <button className="primary">Развернуть</button>
            </fieldset>
        </form>
    }

    function pendingStatus(environment: Environment) {
        const operation = state.operations.find(item => item.id == environment.pending)
        return <p className="muted">{statuses[operation?.status ?? 'queued']}</p>
    }

    const cards = <div className="cards">
        {environments.map(environment => (
            <article key={environment.id}>
                <div className="card-heading">
                    <h3>{environment.id}</h3>
                    <span className="badge">{environment.kind}</span>
                </div>
                <p>Работает: <b>{version(environment.active) ?? 'Ещё не развёрнуто'}</b></p>
                <p>Исполнитель: {environment.agent}</p>
                {address(environment)}
                {environment.pending && pendingStatus(environment)}
                {!environment.pending && canDeploy && deployForm(environment)}
                {!environment.pending && allowed.includes('rollback') && restorable(environment).map(release => (
                    <button
                        key={release}
                        disabled={commands.pending}
                        onClick={function restore() {void rollback(environment, release)}}
                    >
                        Вернуть {version(release)}
                    </button>
                ))}
            </article>
        ))}
    </div>

    function operationDetail(operation: Operation) {
        if (operation.detail) return operation.detail
        return operation.status == 'queued' ? 'Ожидаем исполнителя' : ''
    }

    const history = <section id="deployment-history">
        <h2>История развёртываний</h2>
        <p className="muted">Успешная операция фиксирует выпущенную версию. Ошибка сохраняет детали для разбора и повторного решения.</p>
        {operations.length == 0 && <p className="empty-state">Развёртываний пока нет. После запуска здесь появится результат исполнителя.</p>}
        {operations.toReversed().map(operation => (
            <article className="operation" key={operation.id}>
                <div>
                    <b>{operation.environment}</b> · {version(operation.release)} ·{' '}
                    {operation.action == 'rollback' ? 'Откат' : 'Развёртывание'}
                    <p>{operationDetail(operation)}</p>
                    {operation.cleaned && <p>Контейнер удалён · версия сохранена в истории</p>}
                    {operation.status == 'queued' && allowed.includes('cancelQueued') && (
                        <button
                            disabled={commands.pending}
                            onClick={function cancelWaiting() {void cancel(operation)}}
                        >
                            Отменить заявку
                        </button>
                    )}
                </div>
                <span className={'badge ' + operation.status}>{statuses[operation.status]}</span>
            </article>
        ))}
    </section>

    return <>
        {workflow}
        <div className="deployment-workspace">
        <section id="project-environments">
            <h2>Окружения</h2>
            <p className="muted">Где работает приложение: версия, исполнитель и адрес каждого окружения.</p>
            {environments.length == 0 && <p className="empty-state">{canCreateEnvironment
                ? 'Добавьте окружение и укажите подключённого исполнителя.'
                : 'Владелец проекта ещё не добавил окружения.'}</p>}
            {cards}
            {canSetOrigin && <PublicOrigin client={client} environments={environments} operations={operations}/>}
            {canCreateEnvironment && (
                <details>
                    <summary>Добавить окружение</summary>
                    <CommandForm client={client} kind="environment" project={project}/>
                </details>
            )}
        </section>
        <section id="project-releases">
            <h2>Версии приложения</h2>
            <p className="muted">Неизменяемые образы для запуска. Формат постоянных данных должен быть совместим с текущей версией.</p>
            {releases.length == 0 && <p className="empty-state">{canPublishRelease
                ? 'Добавьте подготовленный образ приложения, чтобы начать развёртывание.'
                : 'Ожидается публикация версии владельцем проекта.'}</p>}
            {releases.map(release => (
                <div className="release" key={release.id}>
                    <b>{release.version}</b>
                    <code>{release.artifact}</code>
                </div>
            ))}
            {canPublishRelease && (
                <details>
                    <summary>Добавить версию</summary>
                    <CommandForm client={client} kind="release" project={project}/>
                </details>
            )}
        </section>
        </div>
        {history}
        {!!commands.error && <p role="alert">{message(commands.error)}</p>}
    </>
}

type FormProps = {
    client: ServiceClient<HostingDefinition>,
    project: string,
    kind: 'project' | 'environment' | 'release'
}

function CommandForm({client, project, kind}: FormProps) {
    const action = useServiceCommands(client.commands)

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const id = String(data.get('id'))
        try {
            if (kind == 'project') {
                await action.run('createProject', {id, title: String(data.get('title'))})
            } else if (kind == 'environment') {
                const agent = String(data.get('agent'))
                await action.run('createEnvironment', {id, project, kind: 'docker', agent})
            } else {
                await action.run('publishRelease', {
                    id,
                    project,
                    version: String(data.get('version')),
                    artifact: String(data.get('artifact')),
                    port: Number(data.get('port')),
                    healthPath: String(data.get('healthPath')),
                    dataVersion: String(data.get('dataVersion') ?? '')
                })
            }
            form.reset()
        } catch {}
    }

    const environmentFields = <>
        <p>Окружение Docker. Образ должен быть заранее загружен на хост исполнителя.</p>
        <label>Аккаунт исполнителя
            <input name="agent" required/>
        </label>
    </>

    const releaseFields = <>
        <label>Версия
            <input name="version" placeholder="1.0.0" required/>
        </label>
        <label>Образ с digest
            <input name="artifact" placeholder="registry/app@sha256:…" required/>
        </label>
        <div className="two">
            <label>Порт приложения
                <input name="port" type="number" defaultValue="8080" min="1" max="65535" required/>
            </label>
            <label>Проверка готовности
                <input name="healthPath" defaultValue="/healthz" required/>
            </label>
        </div>
        <label>Формат постоянных данных
            <input name="dataVersion" placeholder="organizer-2"/>
        </label>
        <p>
            Оставьте пустым, если приложение не хранит данные. При заданном формате том /data сохраняется;
            замена версии проходит с простоем. Для обновления и отката требуется тот же формат.
        </p>
    </>

    return <form onSubmit={submit}>
        <fieldset disabled={action.pending}>
            <label>Идентификатор
                <input name="id" pattern="[a-z][a-z0-9-]{0,62}" required/>
            </label>
            {kind == 'project' && <label>Название<input name="title" required/></label>}
            {kind == 'environment' && environmentFields}
            {kind == 'release' && releaseFields}
            <button className="primary">{action.pending ? 'Сохраняем…' : 'Создать'}</button>
        </fieldset>
        {!!action.error && <p role="alert">{message(action.error)}</p>}
    </form>
}

createRoot(document.getElementById('root')!).render(<App/>)
