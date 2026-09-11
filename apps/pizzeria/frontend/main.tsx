import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ServiceClient} from 'wenay-common2/service/client'
import {ServiceView as Live} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction,type tCommandCall} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {Locations, NetworkOwner, OwnerOverview, type Location} from './locations'
import type {serviceDefinition} from '../backend/service'
import './style.css'
import {Stock} from './stock'
import {Catalog} from './catalog'
import {DishCardView} from './dish-card'
import {Organizer} from '../organizer/board'
import {WorkloadPanel} from '../organizer/workload'

type Session = ServiceClient<typeof serviceDefinition>
const labels: Record<string,string> = {placed:'Принят',cooking:'В печи',ready:'Готов',delivering:'В пути',delivered:'Доставлен',cancelled:'Отменён',customer:'Клиент',cook:'Повар',courier:'Курьер',manager:'Менеджер',owner:'Владелец'}
const money = (n: number) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'EUR'}).format(n)
async function serviceRequest(url: string, path: string, args?: unknown[], token?: string) {
    const response = await fetch(url+'/api/pizzeria'+path,{method:args ? 'POST':'GET',headers:{'content-type':'application/json',...(token ? {authorization:'Bearer '+token}: {})},...(args ? {body:JSON.stringify({args})}: {})})
    const body = await response.json()
    if (!body.ok) throw new Error(body.error?.message ?? 'Не удалось выполнить запрос')
    return body.value
}
function App({location, network}:{location:Location,network:boolean}) {
    const storageKey = 'pizzeria-token:' + location.id
    const connection=useServiceSession<typeof serviceDefinition>({url:location.url,storageKey,anonymous:true})
    const {token,setToken,liveToken,session,me,connected}=connection
    const commands=useServiceAction(session)
    const remote=useCommandAction(session?.commands)
    const busy=commands.busy||remote.busy
    function clearError() {commands.clearError();remote.clearError()}
    const error=commands.error||remote.error||connection.error
    async function request(path:string,args?:unknown[],bearer?:string) {
        return serviceRequest(location.url,path,args,bearer)
    }
    const [signup,setSignup] = useState(false)
    const [workOpen,setWorkOpen] = useState(false)
    const [workSource,setWorkSource] = useState('')
    const [cart,setCart] = useState<string[]>([])
    const [notice,setNotice] = useState('')
    async function action(run:()=>Promise<void>) {
        setNotice('')
        connection.dismissError()
        return commands.action(run)
    }
    async function command(...args:tCommandCall<Session['commands']>) {
        if (!session) throw new Error('Нет соединения с заведением')
        await remote.execute(...args)
        setNotice('Готово — изменения сохранены')
    }
    function login(event:React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget))
        void action(async()=>{if(signup)await request('/signup',[crypto.randomUUID(),data]);const result=await request('/login',[{account:data.account,password:data.password}]);setToken(result.token)})
    }
    const can = (name:string) => me?.commands.includes(name)
    const views = token ? session?.views : null
    const staffMode = !!me?.views.includes('work')
    return <><header><a className="brand" href="/">◉ ПЕЧЬ<span>Пицца. Люди. Тёплые встречи.</span></a><div className="identity"><small className={connected?'online':'offline'}>{connected?'● На связи':'○ Соединяемся'}</small>{me && <><b>{me.account}</b><span>{me.roles.map(r=>labels[r]).join(' · ')}</span><button onClick={()=>{setToken('');setCart([])}}>Выйти</button></>}</div></header>
    <main><p className="eyebrow">{location.title}</p>{network && me?.roles.includes('owner') && <><NetworkOwner location={location} token={liveToken}/><OwnerOverview/></>}<section className={staffMode?'hero staff-hero':'hero'} hidden={staffMode&&workOpen}><div><p className="eyebrow">{staffMode?'РАБОЧАЯ СМЕНА':'ПИЦЦЕРИЯ РАЙОНА · С 10:00 ДО 23:00'}</p><h1>{me && !me.roles.includes('customer')?'Каждый заказ — вовремя.':'Хороший день начинается с пиццы.'}</h1><p>{staffMode?'Заказы, кухня и команда вашего заведения.':'Свежие ингредиенты, горячая печь и заказ, за которым можно следить.'}</p></div>{!staffMode&&<div className="pizza" aria-hidden="true">🍕</div>}</section>
    {token && !me && <button onClick={function resetLogin() {setToken('')}}>Сменить аккаунт</button>}
    {error && <div className="alert" role="alert">{error}<button onClick={function dismissError() {clearError();connection.dismissError()}}>Закрыть</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
    {!token && <section className="login panel"><div><h2>{signup?'Создать аккаунт':'Добро пожаловать'}</h2><p>Войдите, чтобы оформить заказ или открыть рабочую панель.</p><small>Демо: alice / alice-pass · chef / chef-pass · rider / rider-pass · manager / manager-pass · owner / owner-pass</small></div><form onSubmit={login}><label>Логин<input name="account" required minLength={3} maxLength={32}/></label>{signup && <><label>Имя<input name="name" required/></label><label>Телефон<input name="phone" type="tel" required/></label></>}<label>Пароль<input name="password" type="password" required minLength={6}/></label><button className="primary" disabled={busy}>{signup?'Зарегистрироваться':'Войти'}</button><button type="button" onClick={()=>setSignup(!signup)}>{signup?'Уже есть аккаунт':'Создать аккаунт'}</button></form></section>}
    {views && me?.views.includes('work') && <><nav className="work-nav"><button aria-pressed={!workOpen} onClick={function pizzaScreen() {setWorkOpen(false)}}>Пиццерия</button><button aria-pressed={workOpen} onClick={function workScreen() {setWorkSource('');setWorkOpen(true)}}>Команда и задачи</button></nav>{workOpen && <Live remote={views.work} initial={{tasks:{},columns:[],people:[],me:'',manage:false,owner:false,roleOptions:[],sources:[]}}>{value=><Organizer resources={session?.resources} key={workSource} value={value} initialSource={workSource} busy={busy||!connected} run={(...args)=>action(()=>command(...args))} openSource={function openSource(source) {setWorkOpen(false);requestAnimationFrame(function focusSource() {const target=document.getElementById(source.kind=='order'?'order-'+source.id:'stock-panel');if(target)target.scrollIntoView({behavior:'smooth',block:'center'});else setNotice('Этот заказ уже завершён или недоступен в вашей рабочей очереди')})}}/>}</Live>}</>}
    <div hidden={workOpen && staffMode}>
    {views && staffMode && <Live remote={views.work} initial={{tasks:{},columns:[],people:[],me:'',manage:false,owner:false,roleOptions:[],sources:[]}}>{value=><div className="work-app"><WorkloadPanel value={value}/></div>}</Live>}
    {session && !staffMode && <Live remote={session.views.menu} initial={{items:[]}}>{menu=><section><div className="section-title"><h2>Из нашей печи</h2><span>Готовим после вашего заказа</span></div><div className="cards">{menu.items.map(item=><DishCardView key={item.id} item={item} authority={location.url}><button disabled={!can('placeOrder') || cart.length>=20} onClick={()=>setCart([...cart,item.id])}>+ В корзину</button></DishCardView>)}</div>{can('placeOrder') && <form className="panel checkout" onSubmit={e=>{e.preventDefault();const address=String(new FormData(e.currentTarget).get('address'));void action(async()=>{await command('placeOrder',{items:cart,address});setCart([])})}}><div><h3>Ваш заказ · {cart.length} шт.</h3>{[...new Set(cart)].map(id=><p key={id}>{menu.items.find(i=>i.id==id)?.title ?? id} × {cart.filter(x=>x==id).length} <button type="button" aria-label={'Убрать '+id} onClick={()=>{const copy=[...cart];copy.splice(copy.indexOf(id),1);setCart(copy)}}>−</button></p>)}<b>{money(cart.reduce((n,id)=>n+(menu.items.find(i=>i.id==id)?.price ?? 0),0))}</b></div><label>Адрес доставки<input name="address" required minLength={5} maxLength={300} placeholder="Улица, дом, квартира, подъезд"/></label><button className="primary" disabled={busy || !cart.length || !connected}>Оформить заказ</button><small>Оплата при получении. Онлайн-оплата не подключена.</small></form>}</section>}</Live>}
    {views && me?.views.filter(v=>['myOrders','kitchen','dispatch'].includes(v)).map(name=><section key={name}><h2>{{myOrders:'Мои заказы',kitchen:'Кухня',dispatch:'Доставка'}[name]}</h2><Live remote={views[name as 'myOrders']} initial={{orders:{}}}>{value=><div className="cards">{!Object.keys(value.orders).length && <p className="empty">Здесь пока нет заказов.</p>}{Object.values(value.orders).map(order=><article className="panel order" id={'order-'+order.id} key={order.id}><span className={'badge '+order.state}>{labels[order.state]}</span><h3>Заказ #{order.id.slice(-6)}</h3>{order.items && <p>{(order.lines?.map(line=>line.title) ?? order.items).join(', ')}</p>}{name=='myOrders' && order.lines?.some(line=>line.composition) && <details><summary>Состав на момент заказа</summary>{order.lines.map((line,index)=><p key={index}><b>{line.title}</b>{line.portion && <> · {line.portion}</>}<br/>{line.composition}</p>)}</details>}{me?.views.includes('work') && <button onClick={function taskForOrder() {setWorkSource(order.id);setWorkOpen(true)}}>Задача по заказу</button>}{order.address && <p>⌖ {order.address}<br/>{order.phone}</p>}{order.total != null && <b>{money(order.total)}</b>}{order.history && <ol>{order.history.map((h,i)=><li key={i}>{labels[h.state]} <small>{new Date(h.ts).toLocaleTimeString('ru-RU')}</small></li>)}</ol>}<footer>{([['cancelOrder','placed','Отменить'],['startCooking','placed','Готовить'],['markReady','cooking','Готово'],['pickUp','ready','Забрать'],['markDelivered','delivering','Доставлен']] as const).filter(([cmd,state])=>can(cmd)&&order.state==state&&(cmd!='markReady'||order.cook==me?.account)&&(cmd!='markDelivered'||order.courier==me?.account)).map(([cmd,,title])=><button className="primary" disabled={busy||!connected} key={cmd} onClick={()=>void action(()=>command(cmd,{orderId:order.id}))}>{title}</button>)}</footer></article>)}</div>}</Live></section>)}
    {views && me?.views.includes('inventory') && <Live remote={views.inventory} initial={{ingredients:{},batches:{},movements:[],waiting:[]}}>{stock=><>
        {me.views.includes('catalog') && <Live remote={views.catalog} initial={{items:[]}}>{catalog=><Catalog authority={location.url} token={liveToken} items={catalog.items} ingredients={stock.ingredients} busy={busy||!connected} run={(...args)=>action(()=>command(...args))}/>}</Live>}
        <Stock value={stock} manage={!!can('receiveStock')} busy={busy||!connected} run={(...args)=>action(()=>command(...args))}/>
    </>}</Live>}
    {views && me?.views.includes('staff') && <section><h2>Команда и клиенты</h2><Live remote={views.staff} initial={{accounts:{}}}>{v=><div className="cards">{Object.values(v.accounts).map(a=><article className="panel" key={a.account+':'+a.roles.join(',')}><h3>{a.name} <small>@{a.account}</small></h3><p>{a.phone}</p>{can('setRoles')?<form onSubmit={e=>{e.preventDefault();void action(()=>command('setRoles',{account:a.account,roles:new FormData(e.currentTarget).getAll('roles').map(String) as Parameters<Session['commands']['setRoles']>[1]['roles']}))}}>{Object.keys(labels).filter(r=>['customer','cook','courier','manager','owner'].includes(r)).map(r=><label className="check" key={r}><input type="checkbox" name="roles" value={r} defaultChecked={a.roles.some(role=>role==r)}/>{labels[r]}</label>)}<button disabled={busy}>Сохранить роли</button></form>:<p>{a.roles.map(r=>labels[r]).join(', ')}</p>}</article>)}</div>}</Live></section>}
    {views && me?.views.includes('revenue') && <section className="panel"><h2>Выручка</h2><Live remote={views.revenue} initial={{delivered:0,total:0,byDay:{}}}>{v=><><h1>{money(v.total)}</h1><p>Доставлено заказов: {v.delivered}</p>{Object.entries(v.byDay).map(([day,total])=><p key={day}>{day} · {money(total)}</p>)}</>}</Live></section>}
    </div></main><footer className="bottom">ПЕЧЬ · Учебное приложение на wenay-common2 + wenay-react2 · Цены в евро</footer></>
}
createRoot(document.getElementById('root')!).render(<Locations>{(location,network)=><App key={location.id} location={location} network={network}/>}</Locations>)
