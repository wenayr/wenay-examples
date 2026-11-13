import React, {lazy, useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {ServiceClient} from 'wenay-common2/service/client'
import {ServiceView as Live} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction, type tCommandCall} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {DeferredPanel} from '../shared/react/deferred-panel'
import {Locations, NetworkOwner, OwnerOverview, type Location} from './locations'
import type {serviceDefinition} from '../backend/service'
import './style.css'
import {Stock} from './stock'
import {Catalog} from './catalog'
import {DishCardView} from './dish-card'
import {WorkloadPanel} from '../organizer/workload'

type Session = ServiceClient<typeof serviceDefinition>

const Organizer = lazy(() => import('../organizer/board').then(module => ({default: module.Organizer})))

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

const orderStages = ['placed', 'cooking', 'ready', 'delivering', 'delivered'] as const

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

    let heroTitle = 'Выберите пиццу. Мы займёмся ужином.'
    if (staffMode) heroTitle = 'Заказы вашей смены'

    const hero = <section className={staffMode ? 'hero staff-hero' : 'hero'} hidden={staffMode && workOpen}>
        <div>
            <p className="eyebrow">
                {staffMode ? 'КУХНЯ · ДОСТАВКА · КОМАНДА' : 'ПЕЧЬ · МЕНЮ И ДОСТАВКА'}
            </p>
            <h1>{heroTitle}</h1>
            <p>
                {staffMode
                    ? 'Возьмите заказ в работу, отметьте готовность и передайте его курьеру.'
                    : 'Состав и цена — в меню. Добавьте блюда в заказ и следите за приготовлением и доставкой в своём аккаунте.'}
            </p>
            {!staffMode && <a className="hero-link" href="#menu">Выбрать пиццу <span aria-hidden="true">↓</span></a>}
        </div>
        {!staffMode && <figure className="pizza">
            <img src="/dish-photos/margherita.png" alt="Маргарита с томатами, сыром и базиликом"/>
            <figcaption>Маргарита · пример подачи</figcaption>
        </figure>}
    </section>

    const loginPanel = <section className="login panel" id="order-account">
        <div>
            <h2>{signup ? 'Создать аккаунт' : 'Войти для заказа'}</h2>
            <p>Меню доступно без входа. Аккаунт нужен для оформления и отслеживания заказа. Сотрудники здесь открывают свою смену.</p>
            <details className="demo-accounts"><summary>Аккаунты для знакомства с примером</summary><small>
                Демо: alice / alice-pass · chef / chef-pass · rider / rider-pass ·
                manager / manager-pass · owner / owner-pass
            </small></details>
        </div>
        <form onSubmit={login}>
            <label>Логин
                <input name="account" autoComplete="username" required minLength={3} maxLength={32}/>
            </label>
            {signup && <>
                <label>Имя<input name="name" required/></label>
                <label>Телефон<input name="phone" type="tel" required/></label>
            </>}
            <label>Пароль
                <input name="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={6}/>
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
        return <form className="panel checkout order-cart" id="order-cart" onSubmit={submit}>
            <div>
                <p className="eyebrow">КОРЗИНА</p>
                <h3>Ваш заказ <span>{cart.length} шт.</span></h3>
                {cart.length == 0 && <p className="cart-empty">Добавьте пиццу из меню. Здесь появятся состав заказа и итоговая сумма.</p>}
                {[...new Set(cart)].map(id => (
                    <div className="cart-line" key={id}>
                        <strong>{menu.items.find(item => item.id == id)?.title ?? id}</strong>
                        <span>{money(menu.items.find(item => item.id == id)?.price ?? 0)} за шт.</span>
                        <div className="cart-quantity">
                            <button type="button" disabled={busy} aria-label={'Убрать одну ' + (menu.items.find(item => item.id == id)?.title ?? id)}
                                onClick={() => remove(id)}>−</button>
                            <span aria-label="Количество">{cart.filter(x => x == id).length}</span>
                            <button type="button" disabled={busy || cart.length >= 20}
                                aria-label={'Добавить одну ' + (menu.items.find(item => item.id == id)?.title ?? id)}
                                onClick={() => setCart([...cart, id])}>+</button>
                        </div>
                    </div>
                ))}
                <div className="cart-total"><span>Итого</span><b>{money(total)}</b></div>
            </div>
            <label>Адрес доставки
                <input
                    name="address"
                    disabled={busy}
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
            <section id="menu">
                <div className="section-title">
                    <div><p className="eyebrow">ВЫБЕРИТЕ БЛЮДА</p><h2>Из нашей печи</h2></div>
                    <span>Блюд в меню: {menu.items.length} · цены в евро</span>
                </div>
                <div className="menu-workspace">
                <div>
                <div className="cards">
                    {menu.items.map(item => (
                        <DishCardView key={item.id} item={item} authority={location.url}>
                            {can('placeOrder') && <button
                                disabled={busy || cart.length >= 20}
                                onClick={() => setCart([...cart, item.id])}
                            >
                                + В корзину
                            </button>}
                            {!can('placeOrder') && !token && <a href="#order-account" className="menu-order-link">Войти для заказа</a>}
                            {!can('placeOrder') && token && <span className="order-unavailable">Заказ недоступен для этой роли</span>}
                        </DishCardView>
                    ))}
                </div>
                {menu.items.length == 0 && <p className="empty">В этом заведении пока нет доступных блюд. Загляните позже или выберите другое заведение.</p>}
                </div>
                <aside className="order-sidebar" aria-label="Оформление заказа">
                    {can('placeOrder') ? checkout(menu) : <section className="order-guide panel">
                        <p className="eyebrow">ОТ МЕНЮ ДО ДВЕРИ</p>
                        <h3>Заказ в три шага</h3>
                        <ol>
                            <li><strong>Выберите пиццу</strong><p>Сравните состав, порцию и цену в карточках меню.</p></li>
                            <li><strong>Укажите адрес</strong><p>Войдите в аккаунт, добавьте блюда в корзину и оформите заказ.</p></li>
                            <li><strong>Следите за заказом</strong><p>Приготовление, готовность и доставка появятся в истории.</p></li>
                        </ol>
                        {!token && <a href="#order-account" className="hero-link">Войти для заказа →</a>}
                        {token && <p className="order-payment">Чтобы оформить заказ, войдите с аккаунтом клиента.</p>}
                        <p className="order-payment">Оплата при получении. Онлайн-оплата не подключена.</p>
                    </section>}
                    <div className="order-location"><span>Ваше заведение</span><strong>{location.title}</strong>
                        <p>Меню и рабочая очередь относятся к выбранному заведению.</p></div>
                </aside>
                </div>
            </section>
        )}
    </Live>

    const queues = views && me?.views.filter(name => name in queueTitles).map(name => (
        <section key={name} id={'queue-' + name}>
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
                                {name == 'myOrders' && order.state != 'cancelled' && <ol className="order-progress" aria-label="Ход заказа">
                                    {orderStages.map((stage, index) => {
                                        const position = orderStages.findIndex(item => item == order.state)
                                        let progress = ''
                                        if (index < position) progress = 'complete'
                                        if (index == position) progress = 'current'
                                        return <li key={stage} className={progress} aria-current={index == position ? 'step' : undefined}>
                                            {labels[stage]}
                                        </li>
                                    })}
                                </ol>}
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
                                {order.history && <details className="order-history"><summary>История заказа</summary><ol>
                                    {order.history.map((entry, index) => (
                                        <li key={index}>
                                            {labels[entry.state]}{' '}
                                            <small>{new Date(entry.ts).toLocaleTimeString('ru-RU')}</small>
                                        </li>
                                    ))}
                                </ol></details>}
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
            <a className="brand" href="/">◉ ПЕЧЬ<span>Пицца с доставкой</span></a>
            {!staffMode && <nav className="customer-nav" aria-label="Заказ пиццы">
                <a href="#menu">Меню</a>
                {!token && <a href="#order-account">Вход</a>}
                {can('placeOrder') && <a href="#order-cart">Корзина · {cart.length}</a>}
                {me?.views.includes('myOrders') && <a href="#queue-myOrders">Мои заказы</a>}
            </nav>}
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
            {views && me?.views.includes('work') && <>
                {workNav}
                {workOpen && <DeferredPanel className="notice" loadingLabel="Загружаем команду и задачи…">
                    {organizer}
                </DeferredPanel>}
            </>}
            <div hidden={workOpen && staffMode}>
                {staffMode && workload}
                {!staffMode && menuSection}
                {!token && loginPanel}
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
