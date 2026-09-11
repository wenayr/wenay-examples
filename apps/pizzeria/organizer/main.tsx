import React from 'react'
import {createRoot} from 'react-dom/client'
import type {organizerDefinition} from './service'
import {Organizer} from './board'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {RenderMetrics} from './render-metrics'

function App() {
    const connection=useServiceSession<typeof organizerDefinition>({url:location.origin,storageKey:'organizer-token'})
    const {session,me,token,setToken,connected}=connection
    const loginAction=useServiceAction(token)
    const commands=useCommandAction(session?.commands)
    const busy=loginAction.busy||commands.busy
    const error=loginAction.error||commands.error
    const action=loginAction.action
    async function login(event:React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form=new FormData(event.currentTarget)
        connection.dismissError()
        await action(async function authenticate() {
            const response=await fetch('/api/organizer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[{account:form.get('account'),password:form.get('password')}]})})
            const body=await response.json()
            if(!body.ok)throw new Error(body.error?.message ?? 'Вход не выполнен')
            setToken(body.value.token)
        })
    }
    return <><header><b>◈ КОМАНДА</b><span>{me?.account} · {connected?'На связи':'Не подключено'} {token&&<button onClick={function logout() {setToken('')}}>Выйти</button>}</span></header><main>
        {(error||connection.error)&&<p role="alert" className="work-error">{error||connection.error}</p>}
        {!token?<form className="work-form work-login work-app" onSubmit={login}><h1>Работа команды<br/>на одной доске.</h1><p>Любые работы, сроки и проверка результата.</p><label>Логин<input name="account" required/></label><label>Пароль<input type="password" name="password" required/></label><button className="primary" disabled={busy}>Войти</button><p>Демо: owner / owner-pass<br/>manager / manager-pass<br/>worker / worker-pass</p></form>:session&&me?.views.includes('work')?<ServiceView remote={session.views.work} initial={{tasks:{},columns:[],people:[],me:'',manage:false,owner:false,roleOptions:[],sources:[]}}>{value=><Organizer resources={session.resources} value={value} busy={busy||!connected} run={commands.run}/>}</ServiceView>:<p>{me?'Нет доступа к органайзеру':'Подключаемся…'}</p>}
    </main></>
}
createRoot(document.getElementById('root')!).render(import.meta.env.DEV && new URLSearchParams(location.search).has('measure-board') ? <RenderMetrics><App/></RenderMetrics> : <App/>)
