import React, {useMemo, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useOwnedClient, useClientStore, useAsyncAction, useServiceCommands} from 'wenay-react2/react'
import {createServiceClient, type ServiceClientDefinition, type ServiceClient} from 'wenay-common2/service/client'
import type {HostingDefinition} from '../backend/service'
import {Machines} from './machines'
import './style.css'

function message(error: unknown) {return error instanceof Error ? error.message : error ? String(error) : ''}
const statuses = {queued: 'В очереди', running: 'Выполняется', succeeded: 'Завершено', failed: 'Ошибка', cancelled: 'Отменено'}

function App() {
    const [token, setToken] = useState(sessionStorage.getItem('hosting-token') ?? '')
    function authenticate(value: string) {
        if (value) sessionStorage.setItem('hosting-token', value)
        else sessionStorage.removeItem('hosting-token')
        setToken(value)
    }
    const owned = useOwnedClient({key: token, enabled: !!token, create: async function connect(signal) {
        const response = await fetch('/api/client', {signal})
        if (!response.ok) throw new Error('Сервис недоступен')
        const definition: ServiceClientDefinition<HostingDefinition> = await response.json()
        return createServiceClient<HostingDefinition>({definition, url: window.location.origin, auth: {token}, onToken: value=>sessionStorage.setItem('hosting-token', value)})
    }})
    return <><header><a href="/">◈ ХОСТИНГ</a><span>Проекты · Окружения · Версии</span>{token && <button onClick={function logout() {authenticate('')}}>Выйти</button>}</header>
        {!token ? <Login authenticate={authenticate}/> : owned.error ? <main role="alert">{message(owned.error)}</main> : owned.ready && owned.client ? <Dashboard key={token} client={owned.client}/> : <main role="status">Подключаемся к проектам…</main>}
    </>
}

function Login({authenticate}: {authenticate: (token: string)=>void}) {
    const action = useAsyncAction()
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        try {
            await action.run(async function login() {
                const response = await fetch('/api/hosting/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [{account: data.get('account'), password: data.get('password')}]})})
                const body = await response.json()
                if (!body.ok) throw new Error('Проверьте логин и пароль')
                authenticate(body.value.token)
            })
        } catch {}
    }
    return <main className="login"><p className="eyebrow">ВАША ИНФРАСТРУКТУРА</p><h1>От версии<br/>к работающему сервису.</h1><p>Управляйте окружениями и следите за каждым развёртыванием.</p><form onSubmit={submit}><fieldset disabled={action.pending}><label>Логин<input name="account" autoComplete="username" required/></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required/></label><button className="primary">Войти</button></fieldset>{!!action.error && <p role="alert">{message(action.error)}</p>}</form></main>
}

function Dashboard({client}: {client: ServiceClient<HostingDefinition>}) {
    const permissions = useClientStore(useMemo(()=>({store: client.identity.permissions}), [client]))
    const health = useClientStore(useMemo(()=>({store: client.health}), [client]))
    const canRead = permissions.state?.views.includes('dashboard') ?? false
    const dashboard = useClientStore(canRead ? client.views.dashboard : null)
    const [project, setProject] = useState('')
    const state = dashboard.state
    if (!canRead) return <main><h1>Доступ к панели отсутствует</h1><p>Учётная запись исполнителя подключается через отдельный агент.</p></main>
    if (!health.state?.connected) return <main role="status">Восстанавливаем соединение…</main>
    if (!state?.projects || !dashboard.ready) return <main role="status">Загружаем актуальные данные…</main>
    const selected = state.projects.find(item=>item.id == project) ?? state.projects[0]
    const allowed = permissions.state?.commands ?? []
    return <main><div className="page-title"><div><p className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</p><h1>Ваши проекты</h1></div><span className="connected">● На связи · {permissions.state?.account}</span></div>
        {allowed.includes('createProject') && <details><summary>Создать проект</summary><CommandForm client={client} kind="project" project=""/></details>}
        {state.projects.length ? <><label className="project-select">Проект<select value={selected.id} onChange={function choose(event) {setProject(event.target.value)}}>{state.projects.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <Project key={selected.id} client={client} project={selected.id} state={state} allowed={allowed}/>
            {permissions.state?.views.includes('machineDashboard') && <Machines key={'machines-'+selected.id} client={client} project={selected.id} allowed={allowed}/>}</> : <section><h2>Пока нет проектов</h2><p>Администратор создаёт проект и назначает доступ участникам.</p></section>}
    </main>
}

type DashboardState = ServiceClient<HostingDefinition>['views']['dashboard']['store']['state']
function Project({client, project, state, allowed}: {client: ServiceClient<HostingDefinition>, project: string, state: DashboardState, allowed: string[]}) {
    const commands = useServiceCommands(client.commands)
    const releases = state.releases.filter(item=>item.project == project)
    async function deploy(event: React.FormEvent<HTMLFormElement>, environment: DashboardState['environments'][number]) {
        event.preventDefault()
        const release = String(new FormData(event.currentTarget).get('release'))
        try {await commands.run('deploy', {environment: environment.id, release, revision: environment.revision})} catch {}
    }
    async function rollback(environment: DashboardState['environments'][number], release: string) {
        try {await commands.run('rollback', {environment: environment.id, release, revision: environment.revision})} catch {}
    }
    async function cancel(operation: DashboardState['operations'][number]) {
        try {await commands.run('cancelQueued', {operation: operation.id, revision: operation.revision})} catch {}
    }
    return <><div className="stats"><article><b>{state.environments.filter(item=>item.project == project).length}</b><span>Окружений</span></article><article><b>{releases.length}</b><span>Версий</span></article><article><b>{state.operations.filter(item=>item.project == project && ['queued', 'running'].includes(item.status)).length}</b><span>Операций в работе</span></article></div>
        <section><h2>Окружения</h2><div className="cards">{state.environments.filter(item=>item.project == project).map(environment=><article key={environment.id}><div className="card-heading"><h3>{environment.id}</h3><span className="badge">{environment.kind}</span></div><p>Работает: <b>{releases.find(item=>item.id == environment.active)?.version ?? 'Ещё не развёрнуто'}</b></p><p>Исполнитель: {environment.agent}</p>{environment.route ? <p><a href={environment.route} target="_blank" rel="noreferrer">Открыть приложение ↗</a><br/><small>Постоянный адрес: {environment.route}</small></p> : environment.endpoint && <a href={environment.endpoint} target="_blank" rel="noreferrer">Открыть прежний адрес ↗</a>}
            {environment.pending ? <p className="muted">{statuses[state.operations.find(item=>item.id == environment.pending)?.status ?? 'queued']}</p> : allowed.includes('deploy') && <form onSubmit={event=>deploy(event, environment)}><fieldset disabled={commands.pending || !releases.length}><label>Версия<select name="release" defaultValue={environment.active || releases[0]?.id}>{releases.map(item=><option key={item.id} value={item.id}>{item.version}</option>)}</select></label><button className="primary">Развернуть</button></fieldset></form>}
            {!environment.pending && allowed.includes('rollback') && [...new Set(state.operations.filter(item=>item.environment == environment.id && item.status == 'succeeded' && item.release != environment.active).map(item=>item.release))].map(release=><button key={release} disabled={commands.pending} onClick={function restore() {void rollback(environment, release)}}>Вернуть {releases.find(item=>item.id == release)?.version}</button>)}
        </article>)}</div>{allowed.includes('createEnvironment') && <details><summary>Добавить окружение</summary><CommandForm client={client} kind="environment" project={project}/></details>}</section>
        <section><h2>Версии приложения</h2>{releases.map(release=><div className="release" key={release.id}><b>{release.version}</b><code>{release.artifact}</code></div>)}{allowed.includes('publishRelease') && <details><summary>Добавить версию</summary><CommandForm client={client} kind="release" project={project}/></details>}</section>
        <section><h2>История развёртываний</h2>{state.operations.filter(item=>item.project == project).toReversed().map(operation=><article className="operation" key={operation.id}><div><b>{operation.environment}</b> · {releases.find(item=>item.id == operation.release)?.version} · {operation.action == 'rollback' ? 'Откат' : 'Развёртывание'}<p>{operation.detail || (operation.status == 'queued' ? 'Ожидаем исполнителя' : '')}</p>{operation.cleaned && <p>Контейнер удалён · версия сохранена в истории</p>}{operation.status == 'queued' && allowed.includes('cancelQueued') && <button disabled={commands.pending} onClick={function cancelWaiting() {void cancel(operation)}}>Отменить заявку</button>}</div><span className={'badge '+operation.status}>{statuses[operation.status]}</span></article>)}</section>
        {!!commands.error && <p role="alert">{message(commands.error)}</p>}
    </>
}

function CommandForm({client, project, kind}: {client: ServiceClient<HostingDefinition>, project: string, kind: 'project' | 'environment' | 'release'}) {
    const action = useServiceCommands(client.commands)
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const id = String(data.get('id'))
        try {
            if (kind == 'project') await action.run('createProject', {id, title: String(data.get('title'))})
            else if (kind == 'environment') await action.run('createEnvironment', {id, project, kind: 'docker', agent: String(data.get('agent'))})
            else await action.run('publishRelease', {id, project, version: String(data.get('version')), artifact: String(data.get('artifact')), port: Number(data.get('port')), healthPath: String(data.get('healthPath')), dataVersion: String(data.get('dataVersion') ?? '')})
            form.reset()
        } catch {}
    }
    return <form onSubmit={submit}><fieldset disabled={action.pending}><label>Идентификатор<input name="id" pattern="[a-z][a-z0-9-]{0,62}" required/></label>
        {kind == 'project' && <label>Название<input name="title" required/></label>}
        {kind == 'environment' && <><p>Окружение Docker. Образ должен быть заранее загружен на хост исполнителя.</p><label>Аккаунт исполнителя<input name="agent" required/></label></>}
        {kind == 'release' && <><label>Версия<input name="version" placeholder="1.0.0" required/></label><label>Образ с digest<input name="artifact" placeholder="registry/app@sha256:…" required/></label><div className="two"><label>Порт приложения<input name="port" type="number" defaultValue="8080" min="1" max="65535" required/></label><label>Проверка готовности<input name="healthPath" defaultValue="/healthz" required/></label></div></>}
        {kind == 'release' && <><label>Формат постоянных данных<input name="dataVersion" placeholder="organizer-2"/></label><p>Оставьте пустым, если приложение не хранит данные. При заданном формате том /data сохраняется; замена версии проходит с простоем. Для обновления и отката требуется тот же формат.</p></>}
        <button className="primary">{action.pending ? 'Сохраняем…' : 'Создать'}</button></fieldset>{!!action.error && <p role="alert">{message(action.error)}</p>}
    </form>
}

createRoot(document.getElementById('root')!).render(<App/>)
