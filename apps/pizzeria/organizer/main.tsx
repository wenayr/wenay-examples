import React from 'react'
import {createRoot} from 'react-dom/client'
import type {organizerDefinition} from './service'
import {Organizer} from './board'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {RenderMetrics} from './render-metrics'

const emptyWork = {
    tasks: {}, columns: [], people: [], me: '',
    manage: false, owner: false, roleOptions: [], sources: []
}

function App() {
    const connection = useServiceSession<typeof organizerDefinition>({
        url: location.origin,
        storageKey: 'organizer-token'
    })
    const {session, me, token, setToken, connected} = connection
    const loginAction = useServiceAction(token)
    const commands = useCommandAction(session?.commands)
    const busy = loginAction.busy||commands.busy
    const error = loginAction.error||commands.error
    const action = loginAction.action
    async function login(event:React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        connection.dismissError()
        await action(async function authenticate() {
            const response = await fetch('/api/organizer/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [{account: form.get('account'), password: form.get('password')}]})
            })
            const body = await response.json()
            if (!body.ok) throw new Error(body.error?.message ?? 'Вход не выполнен')
            setToken(body.value.token)
        })
    }
    const loginForm = <form className="work-form work-login work-app" onSubmit={login}>
        <h1>Работа команды<br/>на одной доске.</h1>
        <p>Любые работы, сроки и проверка результата.</p>
        <label>Логин<input name="account" required/></label>
        <label>Пароль<input type="password" name="password" required/></label>
        <button className="primary" disabled={busy}>Войти</button>
        <p>Демо: owner / owner-pass<br/>manager / manager-pass<br/>worker / worker-pass</p>
    </form>

    const board = session && <ServiceView remote={session.views.work} initial={emptyWork}>
        {value => (
            <Organizer
                resources={session.resources}
                value={value}
                busy={busy || !connected}
                run={commands.run}
            />
        )}
    </ServiceView>

    let page: React.ReactNode = loginForm
    if (token) {
        page = <p>{me ? 'Нет доступа к органайзеру' : 'Подключаемся…'}</p>
        if (session && me?.views.includes('work')) page = board
    }

    return <>
        <header>
            <b>◈ КОМАНДА</b>
            <span>
                {me?.account} · {connected ? 'На связи' : 'Не подключено'}
                {token && <button onClick={function logout() {setToken('')}}>Выйти</button>}
            </span>
        </header>
        <main>
        {(error||connection.error)&&<p role="alert" className="work-error">{error||connection.error}</p>}
        {page}
    </main></>
}
const measuring = import.meta.env.DEV && new URLSearchParams(location.search).has('measure-board')
const root = createRoot(document.getElementById('root')!)
root.render(measuring ? <RenderMetrics><App/></RenderMetrics> : <App/>)
