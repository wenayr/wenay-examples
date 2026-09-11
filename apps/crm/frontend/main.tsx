import React, {useEffect, useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {CrmDefinition} from '../backend/runtime'
import type {CrmWorkspace} from '../backend/domain'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {ServiceView} from '../shared/react/service-view'
import {Deals} from './deals'
import {Tasks} from './tasks'
import {Imports} from './imports'
import type {TaskBoards} from '../backend/organizer'
import type {ImportView} from '../backend/imports'
import {Directory, Team} from './workspace'
import {roles, date, type Commands, type Resources} from './contracts'
import './style.css'

const initial: CrmWorkspace = {me: {account: '', name: ''}, organizations: [], people: [], companies: [], contacts: [], deals: [], columns: [], audit: []}
const initialBoards: TaskBoards = {boards: []}
const initialImports: ImportView = {imports: []}
const sections = [{id:'deals',label:'Сделки',icon:'◈'}, {id:'tasks',label:'Задачи',icon:'▤'}, {id:'imports',label:'Импорт CSV',icon:'↓'}, {id:'contacts',label:'Контакты',icon:'◉'}, {id:'companies',label:'Компании',icon:'▦'}, {id:'team',label:'Команда',icon:'♧'}, {id:'audit',label:'История',icon:'◷'}] as const

function App() {
    const connection = useServiceSession<CrmDefinition>({url:location.origin,storageKey:'orbit-token'})
    const commands = useCommandAction(connection.session?.commands)
    const action = useServiceAction(connection.token)
    const [preset,setPreset] = useState('owner')
    async function login(event:React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const response = await fetch('/api/crm/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[{account:form.get('account'),password:form.get('password')}]})})
            const body = await response.json()
            if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            connection.setToken(body.value.token)
        })
    }
    const error = connection.error || commands.error || action.error
    return <>{error && <div className="error" role="alert">{error}<button aria-label="Закрыть ошибку" onClick={() => {connection.dismissError();commands.clearError();action.clearError()}}>×</button></div>}
        {!connection.token ? <main className="login"><section className="login-story"><a className="brand"><span>◎</span> orbit<span className="brand-caption">CRM STUDIO</span></a><span className="eyebrow">СЛЕДУЮЩИЙ ХОРОШИЙ РАЗГОВОР</span><h1>У каждого контакта<br/>есть будущее.</h1><p>Обсуждайте. Предлагайте. Договаривайтесь.<br/>От первого знакомства до общего результата.</p><div className="orbit-art"><i/><i/><i/><span>●</span><strong>Всё начинается<br/>с доверия.</strong></div><small>Ваша команда. Ваши отношения с клиентами.</small></section><section className="login-form"><p className="eyebrow">ВАШ КРУГ ВОЗМОЖНОСТЕЙ</p><h2>Продолжим разговор</h2><p>Войдите в рабочее пространство команды.</p><form key={preset} onSubmit={login}><label>Аккаунт<input name="account" defaultValue={preset} autoComplete="username" required/></label><label>Пароль<input name="password" type="password" defaultValue={preset+'-pass'} autoComplete="current-password" required/></label><button className="primary" disabled={action.busy}>Войти в Orbit →</button></form><div className="presets"><p>Посмотреть от лица</p>{Object.entries({...roles,outsider:'Другой команды'}).map(([id,label]) => <button key={id} aria-pressed={preset==id} onClick={() => setPreset(id)}>{label}</button>)}<small>Демонстрационный пароль: аккаунт + «-pass».</small></div></section></main>
        : connection.session && connection.me?.views.includes('workspace') ? <ServiceView remote={connection.session.views.workspace} initial={initial}>{value => <Workspace key={value.me!.account} value={value} commands={commands} resources={connection.session!.resources} views={connection.session!.views} connected={connection.connected} logout={() => connection.setToken('')}/>}</ServiceView>
        : <main className="loading"><span className="brand">◎ orbit</span><h1>Подключаемся к команде…</h1><button onClick={() => connection.setToken('')}>Вернуться ко входу</button></main>}</>
}

function Workspace({value,commands,resources,views,connected,logout}:{value:CrmWorkspace,commands:Commands,resources:Resources,views:ServiceClient<CrmDefinition>['views'],connected:boolean,logout:()=>void}) {
    const [orgId,setOrgId] = useState('')
    const [section,setSection] = useState('deals')
    const org = value.organizations.find(item => item.id==orgId) ?? value.organizations[0]
    const staff = org && org.role!='customer'
    const manage = org && (org.role=='owner'||org.role=='lead')
    const active = (!staff && section!='deals') || (!manage && section=='audit') ? 'deals' : section
    useEffect(function clearForbidden() {if (active!=section) setSection(active)},[active,section])
    return <div className="app"><aside className="sidebar"><a className="brand" href="#deals" onClick={() => setSection('deals')}><span>◎</span> orbit<span className="brand-caption">CRM STUDIO</span></a><label className="org-select">Рабочее пространство<select aria-label="Организация" value={org?.id??''} onChange={event => {setOrgId(event.target.value);commands.clearError()}}>{value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><nav aria-label="Разделы CRM">{sections.filter(item => (staff||item.id=='deals')&&(manage||item.id!='audit')).map(item => <button key={item.id} className={active==item.id?'active':''} aria-current={active==item.id?'page':undefined} onClick={() => setSection(item.id)}><span>{item.icon}</span>{item.label}{item.id=='deals'&&<b>{value.deals.filter(deal => deal.orgId==org?.id&&!deal.archived).length}</b>}</button>)}</nav><div className="sidebar-card"><span>✦</span><strong>Хорошие связи<br/>становятся сильнее.</strong><p>Записывайте договорённости и сохраняйте общий контекст.</p></div><div className="account"><span className="avatar">{value.me!.name.slice(0,1)}</span><div><strong>{value.me!.name.split(' · ')[0]}</strong><small>{org?roles[org.role]:'Участник'}</small></div><button aria-label="Выйти" onClick={logout}>↪</button></div></aside><main className="workspace"><header className="topbar"><span>Рабочее пространство <i>/</i> <strong>{sections.find(item=>item.id==active)?.label}</strong></span><div><span className={'connection '+(!connected?'offline':'')}>● {connected?'На связи':'Переподключение'}</span><button className="mobile-exit" onClick={logout}>Выйти</button></div></header>{org?<div key={org.id+':'+active} className="page">
        {active=='deals'&&<Deals value={value} org={org} commands={commands} resources={resources} busy={commands.busy||!connected}/>}
        {(active=='contacts'||active=='companies')&&staff&&<Directory kind={active} value={value} org={org} commands={commands} busy={commands.busy||!connected}/>}
        {active=='tasks'&&staff&&<ServiceView remote={views.taskBoards} initial={initialBoards}>{state=>{const board=state.boards.find(item=>item.orgId==org.id);return board?<Tasks board={board} commands={commands} busy={commands.busy||!connected}/>:<p>Доска недоступна</p>}}</ServiceView>}
        {active=='imports'&&staff&&<ServiceView remote={views.imports} initial={initialImports}>{imports=><Imports value={imports} workspace={value} org={org} resources={resources} commands={commands} busy={commands.busy||!connected}/>}</ServiceView>}
        {active=='team'&&staff&&<Team value={value} org={org} commands={commands} busy={commands.busy||!connected}/>}
        {active=='audit'&&manage&&<><div className="page-title"><p className="eyebrow">ПРОЗРАЧНЫЕ ДОГОВОРЁННОСТИ</p><h1>История команды</h1></div><div className="timeline">{value.audit.filter(item=>item.orgId==org.id).slice().reverse().map(item=><article key={item.id}><span>{date(item.at)}</span><strong>{item.action}</strong><p>{item.actor} · {item.target}</p></article>)}</div></>}
        </div>:<div className="page"><h1>Нет доступных организаций</h1><p>Попросите владельца восстановить доступ.</p></div>}</main></div>
}

createRoot(document.getElementById('root')!).render(<App/> )
