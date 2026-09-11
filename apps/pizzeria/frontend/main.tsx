import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ServiceClient} from 'wenay-common2/service/client'
import {ServiceView as Live} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction, type tCommandCall} from '../shared/react/command-action'
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

const labels: Record<string, string> = {
    placed: 'Принят', cooking: 'В печи', ready: 'Готов', delivering: 'В пути',
    delivered: 'Доставлен', cancelled: 'Отменён',
    customer: 'Клиент', cook: 'Повар', courier: 'Курьер', manager: 'Менеджер', owner: 'Владелец'
}

const roleOptions = ['customer', 'cook', 'courier', 'manager', 'owner']

const queueTitles: Record<string, string> = {
    myOrders: 'Мои заказы',
    kitchen: 'Кухня',
    dispatch: 'Доставка'
}

// Кнопка появляется только у того, кто отвечает за этот шаг: повар закрывает свою
// выпечку, курьер — свою доставку.
const transitions = [
    ['cancelOrder', 'placed', 'Отменить'],
    ['startCooking', 'placed', 'Готовить'],
    ['markReady', 'cooking', 'Готово'],
    ['pickUp', 'ready', 'Забрать'],
    ['markDelivered', 'delivering', 'Доставлен']
] as const

const initialWork = {
    tasks: {}, columns: [], people: [], me: '', manage: false, owner: false, roleOptions: [], sources: []
}

const formatter = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR'})
const money = (value: number) => formatter.format(value)

async function serviceRequest(url: string, path: string, args?: unknown[], token?: string) {
    const headers: Record<string, string> = {'content-type': 'application/json'}
    if (token) headers.authorization = 'Bearer ' + token
    const response = await fetch(url + '/api/pizzeria' + path, {
        method: args ? 'POST' : 'GET',
        headers,
        ...(args ? {body: JSON.stringify({args})} : {})
    })
    const body = await response.json()
    if (!body.ok) throw new Error(body.error?.message ?? 'Не удалось выполнить запрос')
    return body.value
}

function App({location, network}: {location: Location, network: boolean}) {
    const storageKey = 'pizzeria-token:' + location.id
    const connection = useServiceSession<typeof serviceDefinition>({
        url: location.url,
        storageKey,
        anonymous: true
    })
    const {token, setToken, liveToken, session, me, connected} = connection
    const commands = useServiceAction(session)
    const remote = useCommandAction(session?.commands)

    const [signup, setSignup] = useState(false)
    const [workOpen, setWorkOpen] = useState(false)
    const [workSource, setWorkSource] = useState('')
    const [cart, setCart] = useState<string[]>([])
    const [notice, setNotice] = useState('')

    const busy = commands.busy || remote.busy
    const error = commands.error || remote.error || connection.error
    const can = (name: string) => me?.commands.includes(name)
    const views = token ? session?.views : null
    const staffMode = !!me?.views.includes('work')
    const disabled = busy || !connected

    function clearError() {
        commands.clearError()
        remote.clearError()
        connection.dismissError()
    }
    async function request(path: string, args?: unknown[], bearer?: string) {
        return serviceRequest(location.url, path, args, bearer)
    }
    async function action(run: () => Promise<void>) {
        setNotice('')
        connection.dismissError()
        return commands.action(run)
    }
    async function command(...args: tCommandCall<Session['commands']>) {
        if (!session) throw new Error('Нет соединения с заведением')
        await remote.execute(...args)
        setNotice('Готово — изменения сохранены')
    }
    function run(...args: tCommandCall<Session['commands']>) {
        return action(() => command(...args))
    }
    function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const data = Object.fromEntries(new FormData(event.currentTarget))
        void action(async function authenticate() {
            if (signup) await request('/signup', [crypto.randomUUID(), data])
            const result = await request('/login', [{account: data.account, password: data.password}])
            setToken(result.token)
        })
    }
    function logout() {
        setToken('')
        setCart([])
    }
    // Переход из задачи к её источнику: заказ прокручиваем в видимую часть,
    // склад — к своей панели. Уже закрытый заказ объясняем словами.
    function openSource(source: {kind: string, id: string}) {
        setWorkOpen(false)
        requestAnimationFrame(function focusSource() {
            const anchor = source.kind == 'order' ? 'order-' + source.id : 'stock-panel'
            const target = document.getElementById(anchor)
            if (target) target.scrollIntoView({behavior: 'smooth', block: 'center'})
            else setNotice('Этот заказ уже завершён или недоступен в вашей рабочей очереди')
        })
    }

    const identity = <div className="identity">
        <small className={connected ? 'online' : 'offline'}>
            {connected ? '● На связи' : '○ Соединяемся'}
        </small>
        {me && <>
            <b>{me.account}</b>
            <span>{me.roles.map(role => labels[role]).join(' · ')}</span>
            <button onClick={logout}>Выйти</button>
        </>}
    </div>

    let heroTitle = 'Хороший день начинается с пиццы.'
    if (me && !me.roles.includes('customer')) heroTitle = 'Каждый заказ — вовремя.'

    const hero = <section className={staffMode ? 'hero staff-hero' : 'hero'} hidden={staffMode && workOpen}>
        <div>
            <p className="eyebrow">
                {staffMode ? 'РАБОЧАЯ СМЕНА' : 'ПИЦЦЕРИЯ РАЙОНА · С 10:00 ДО 23:00'}
            </p>
            <h1>{heroTitle}</h1>
            <p>
                {staffMode
                    ? 'Заказы, кухня и команда вашего заведения.'
                    : 'Свежие ингредиенты, горячая печь и заказ, за которым можно следить.'}
            </p>
        </div>
        {!staffMode && <div className="pizza" aria-hidden="true">🍕</div>}
    </section>

    const loginPanel = <section className="login panel">
        <div>
            <h2>{signup ? 'Создать аккаунт' : 'Добро пожаловать'}</h2>
            <p>Войдите, чтобы оформить заказ или открыть рабочую панель.</p>
            <small>
                Демо: alice / alice-pass · chef / chef-pass · rider / rider-pass ·
                manager / manager-pass · owner / owner-pass
            </small>
        </div>
        <form onSubmit={login}>
            <label>Логин
                <input name="account" required minLength={3} maxLength={32}/>
            </label>
            {signup && <>
                <label>Имя<input name="name" required/></label>
                <label>Телефон<input name="phone" type="tel" required/></label>
            </>}
            <label>Пароль
                <input name="password" type="password" required minLength={6}/>
            </label>
            <button className="primary" disabled={busy}>{signup ? 'Зарегистрироваться' : 'Войти'}</button>
            <button type="button" onClick={() => setSignup(!signup)}>
                {signup ? 'Уже есть аккаунт' : 'Создать аккаунт'}
            </button>
        </form>
    </section>

    function openWorkScreen() {
        setWorkSource('')
        setWorkOpen(true)
    }

    const workNav = <nav className="work-nav">
        <button aria-pressed={!workOpen} onClick={function pizzaScreen() {setWorkOpen(false)}}>Пиццерия</button>
        <button aria-pressed={workOpen} onClick={openWorkScreen}>Команда и задачи</button>
    </nav>

    const organizer = views && <Live remote={views.work} initial={initialWork}>
        {value => (
            <Organizer
                resources={session?.resources}
                key={workSource}
                value={value}
                initialSource={workSource}
                busy={disabled}
                run={run}
                openSource={openSource}
            />
        )}
    </Live>

    const workload = views && <Live remote={views.work} initial={initialWork}>
        {value => <div className="work-app"><WorkloadPanel value={value}/></div>}
    </Live>

    function checkout(menu: {items: {id: string, title: string, price: number}[]}) {
        function submit(event: React.FormEvent<HTMLFormElement>) {
            event.preventDefault()
            const address = String(new FormData(event.currentTarget).get('address'))
            void action(async function place() {
                await command('placeOrder', {items: cart, address})
                setCart([])
            })
        }
        function remove(id: string) {
            const copy = [...cart]
            copy.splice(copy.indexOf(id), 1)
            setCart(copy)
        }
        const total = cart.reduce(function sum(value, id) {
            return value + (menu.items.find(item => item.id == id)?.price ?? 0)
        }, 0)
        return <form className="panel checkout" onSubmit={submit}>
            <div>
                <h3>Ваш заказ · {cart.length} шт.</h3>
                {[...new Set(cart)].map(id => (
                    <p key={id}>
                        {menu.items.find(item => item.id == id)?.title ?? id} × {cart.filter(x => x == id).length}
                        <button type="button" aria-label={'Убрать ' + id} onClick={() => remove(id)}>−</button>
                    </p>
                ))}
                <b>{money(total)}</b>
            </div>
            <label>Адрес доставки
                <input
                    name="address"
                    required
                    minLength={5}
                    maxLength={300}
                    placeholder="Улица, дом, квартира, подъезд"
                />
            </label>
            <button className="primary" disabled={busy || !cart.length || !connected}>Оформить заказ</button>
            <small>Оплата при получении. Онлайн-оплата не подключена.</small>
        </form>
    }

    const menuSection = session && <Live remote={session.views.menu} initial={{items: []}}>
        {menu => (
            <section>
                <div className="section-title">
                    <h2>Из нашей печи</h2>
                    <span>Готовим после вашего заказа</span>
                </div>
                <div className="cards">
                    {menu.items.map(item => (
                        <DishCardView key={item.id} item={item} authority={location.url}>
                            <button
                                disabled={!can('placeOrder') || cart.length >= 20}
                                onClick={() => setCart([...cart, item.id])}
                            >
                                + В корзину
                            </button>
                        </DishCardView>
                    ))}
                </div>
                {can('placeOrder') && checkout(menu)}
            </section>
        )}
    </Live>

    const queues = views && me?.views.filter(name => name in queueTitles).map(name => (
        <section key={name}>
            <h2>{queueTitles[name]}</h2>
            <Live remote={views[name as 'myOrders']} initial={{orders: {}}}>
                {value => (
                    <div className="cards">
                        {!Object.keys(value.orders).length && <p className="empty">Здесь пока нет заказов.</p>}
                        {Object.values(value.orders).map(order => {
                            function available([name, state]: (typeof transitions)[number]) {
                                if (!can(name) || order.state != state) return false
                                if (name == 'markReady' && order.cook != me?.account) return false
                                if (name == 'markDelivered' && order.courier != me?.account) return false
                                return true
                            }
                            const lines = order.lines ?? []
                            const composition = lines.some(line => line.composition)
                            return <article className="panel order" id={'order-' + order.id} key={order.id}>
                                <span className={'badge ' + order.state}>{labels[order.state]}</span>
                                <h3>Заказ #{order.id.slice(-6)}</h3>
                                {order.items && <p>{(order.lines?.map(line => line.title) ?? order.items).join(', ')}</p>}
                                {name == 'myOrders' && composition && (
                                    <details>
                                        <summary>Состав на момент заказа</summary>
                                        {lines.map((line, index) => (
                                            <p key={index}>
                                                <b>{line.title}</b>
                                                {line.portion && <> · {line.portion}</>}
                                                <br/>
                                                {line.composition}
                                            </p>
                                        ))}
                                    </details>
                                )}
                                {me?.views.includes('work') && (
                                    <button onClick={function taskForOrder() {
                                        setWorkSource(order.id)
                                        setWorkOpen(true)
                                    }}>
                                        Задача по заказу
                                    </button>
                                )}
                                {order.address && <p>⌖ {order.address}<br/>{order.phone}</p>}
                                {order.total != null && <b>{money(order.total)}</b>}
                                {order.history && <ol>
                                    {order.history.map((entry, index) => (
                                        <li key={index}>
                                            {labels[entry.state]}{' '}
                                            <small>{new Date(entry.ts).toLocaleTimeString('ru-RU')}</small>
                                        </li>
                                    ))}
                                </ol>}
                                <footer>
                                    {transitions.filter(available).map(([name, , title]) => (
                                        <button
                                            className="primary"
                                            disabled={disabled}
                                            key={name}
                                            onClick={() => void run(name, {orderId: order.id})}
                                        >
                                            {title}
                                        </button>
                                    ))}
                                </footer>
                            </article>
                        })}
                    </div>
                )}
            </Live>
        </section>
    ))

    const inventory = views && me?.views.includes('inventory') && (
        <Live remote={views.inventory} initial={{ingredients: {}, batches: {}, movements: [], waiting: []}}>
            {stock => <>
                {me.views.includes('catalog') && (
                    <Live remote={views.catalog} initial={{items: []}}>
                        {catalog => (
                            <Catalog
                                authority={location.url}
                                token={liveToken}
                                items={catalog.items}
                                ingredients={stock.ingredients}
                                busy={disabled}
                                run={run}
                            />
                        )}
                    </Live>
                )}
                <Stock value={stock} manage={!!can('receiveStock')} busy={disabled} run={run}/>
            </>}
        </Live>
    )

    type tRoles = Parameters<Session['commands']['setRoles']>[1]['roles']

    const staff = views && me?.views.includes('staff') && (
        <section>
            <h2>Команда и клиенты</h2>
            <Live remote={views.staff} initial={{accounts: {}}}>
                {value => (
                    <div className="cards">
                        {Object.values(value.accounts).map(person => {
                            function save(event: React.FormEvent<HTMLFormElement>) {
                                event.preventDefault()
                                const selected = new FormData(event.currentTarget).getAll('roles')
                                const roles = selected.map(String) as tRoles
                                void run('setRoles', {account: person.account, roles})
                            }
                            return <article className="panel" key={person.account + ':' + person.roles.join(',')}>
                                <h3>{person.name} <small>@{person.account}</small></h3>
                                <p>{person.phone}</p>
                                {can('setRoles') ? <form onSubmit={save}>
                                    {roleOptions.map(role => (
                                        <label className="check" key={role}>
                                            <input
                                                type="checkbox"
                                                name="roles"
                                                value={role}
                                                defaultChecked={person.roles.some(item => item == role)}
                                            />
                                            {labels[role]}
                                        </label>
                                    ))}
                                    <button disabled={busy}>Сохранить роли</button>
                                </form> : <p>{person.roles.map(role => labels[role]).join(', ')}</p>}
                            </article>
                        })}
                    </div>
                )}
            </Live>
        </section>
    )

    const revenue = views && me?.views.includes('revenue') && (
        <section className="panel">
            <h2>Выручка</h2>
            <Live remote={views.revenue} initial={{delivered: 0, total: 0, byDay: {}}}>
                {value => <>
                    <h1>{money(value.total)}</h1>
                    <p>Доставлено заказов: {value.delivered}</p>
                    {Object.entries(value.byDay).map(([day, total]) => <p key={day}>{day} · {money(total)}</p>)}
                </>}
            </Live>
        </section>
    )

    return <>
        <header>
            <a className="brand" href="/">◉ ПЕЧЬ<span>Пицца. Люди. Тёплые встречи.</span></a>
            {identity}
        </header>
        <main>
            <p className="eyebrow">{location.title}</p>
            {network && me?.roles.includes('owner') && <>
                <NetworkOwner location={location} token={liveToken}/>
                <OwnerOverview/>
            </>}
            {hero}
            {token && !me && <button onClick={function resetLogin() {setToken('')}}>Сменить аккаунт</button>}
            {error && <div className="alert" role="alert">{error}
                <button onClick={clearError}>Закрыть</button>
            </div>}
            {notice && <p role="status" className="notice">{notice}</p>}
            {!token && loginPanel}
            {views && me?.views.includes('work') && <>
                {workNav}
                {workOpen && organizer}
            </>}
            <div hidden={workOpen && staffMode}>
                {staffMode && workload}
                {!staffMode && menuSection}
                {queues}
                {inventory}
                {staff}
                {revenue}
            </div>
        </main>
        <footer className="bottom">
            ПЕЧЬ · Учебное приложение на wenay-common2 + wenay-react2 · Цены в евро
        </footer>
    </>
}

createRoot(document.getElementById('root')!).render(
    <Locations>
        {(location, network) => <App key={location.id} location={location} network={network}/>}
    </Locations>
)
