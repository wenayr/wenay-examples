import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useAsyncAction, useClientStore, useOwnedClient} from 'wenay-react2/react'
import {createServiceClient, type ServiceClientDefinition} from 'wenay-common2/service/client'
import type {ConversationCreateInput} from 'wenay-common2/conversation'
import type {ChatDefinition} from '../backend/service'
import {authorName, errorText, messageText, type ChatSession, type ChatWorkspace, type tDelivery, type WorkspaceMemberInput} from './contracts'
import {createConversationOwner} from './conversation-owner'
import './style.css'

const storageKey = 'nearby-chat-token'

function App() {
    const [token, setToken] = useState(() => sessionStorage.getItem(storageKey) ?? '')
    const [attempt, setAttempt] = useState(0)
    const [sessionEpoch, setSessionEpoch] = useState(0)
    const epoch = useRef(0)
    const mounted = useRef(true)
    const closeConversation = useRef<(() => void) | null>(null)
    useLayoutEffect(function lifecycle() {
        mounted.current = true
        return function close() {
            mounted.current = false
            ++epoch.current
            closeConversation.current?.()
            closeConversation.current = null
        }
    }, [])
    async function connect(signal: AbortSignal) {
        const connectingEpoch = epoch.current
        const response = await fetch('/api/client', {signal})
        if (!response.ok) throw new Error('Сервис недоступен')
        const definition: ServiceClientDefinition<ChatDefinition> = await response.json()
        signal.throwIfAborted()
        return createServiceClient<ChatDefinition>({definition, url: location.origin, auth: {token}, onToken: function renew(value) {
            const current = mounted.current && !signal.aborted && epoch.current == connectingEpoch
            if (current) sessionStorage.setItem(storageKey, value)
        }})
    }
    const key = JSON.stringify([token, attempt, sessionEpoch])
    const owned = useOwnedClient({key, enabled: !!token, create: connect})
    function authenticate(value: string) {
        if (!mounted.current || epoch.current != sessionEpoch) return
        if (value) sessionStorage.setItem(storageKey, value)
        else sessionStorage.removeItem(storageKey)
        setToken(value)
    }
    function endSession() {
        ++epoch.current
        closeConversation.current?.()
        closeConversation.current = null
        owned.close()
        sessionStorage.removeItem(storageKey)
        setToken('')
        setSessionEpoch(epoch.current)
    }
    return <div className="app">
        <header className="app-header">
            <a className="brand" href="/" aria-label="Рядом, главная">◌ <span>рядом</span></a>
            <span className="header-note">Место для разговора</span>
            {token && owned.client && <AccountLabel session={owned.client}/>}
            {token && <div className="session-actions">
                <button className="quiet" onClick={endSession}>Сменить аккаунт</button>
                <button className="quiet" onClick={endSession}>Выйти</button>
            </div>}
        </header>
        {!token && <Login key={sessionEpoch} authenticate={authenticate}/>}
        {token && !!owned.error && <main className="connection-page">
            <h1>Не удалось подключиться</h1>
            <p role="alert">{errorText(owned.error)}</p>
            <button onClick={() => setAttempt(value => value + 1)}>Попробовать снова</button>
        </main>}
        {token && !owned.error && (!owned.ready || !owned.client) && <main className="connection-page" role="status">Подключаемся…</main>}
        {token && owned.ready && owned.client && <SessionWorkspace key={key} session={owned.client} closeConversation={closeConversation}/>}
    </div>
}

function AccountLabel({session}: {session: ChatSession}) {
    const identity = useClientStore(useMemo(() => ({store: session.identity.permissions}), [session]))
    return <span className="header-account">Аккаунт: {identity.state?.account ?? '…'}</span>
}

function Login({authenticate}: {authenticate: (token: string) => void}) {
    const [account, setAccount] = useState('alice')
    const action = useAsyncAction()
    const mounted = useRef(true)
    const abort = useRef<AbortController | null>(null)
    useLayoutEffect(function lifecycle() {
        mounted.current = true
        return function close() {
            mounted.current = false
            abort.current?.abort()
        }
    }, [])
    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        try {
            await action.run(async function login() {
                const controller = new AbortController()
                abort.current = controller
                const credentials = {account: form.get('account'), password: form.get('password')}
                const response = await fetch('/api/chat/login', {
                    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({args: [credentials]}), signal: controller.signal
                })
                const body = await response.json()
                if (!response.ok || !body.ok) {
                    const reason = body.error?.message
                    throw new Error(reason == 'login refused' ? 'Неверный логин или пароль' : reason ?? 'Не удалось войти')
                }
                if (mounted.current && !controller.signal.aborted) authenticate(body.value.token)
            })
        } catch {}
    }
    return <main className="login">
        <section className="login-intro">
            <p className="eyebrow">РАЗГОВОР ПРОДОЛЖАЕТСЯ</p>
            <h1>Мысли, которыми<br/>хочется поделиться.</h1>
            <p>Откройте чат, напишите сообщение и продолжайте с другого окна. История остаётся рядом.</p>
            <p className="demo-note">Демонстрация с двумя аккаунтами. Помощник отвечает только по вашему запросу и использует тестовый исполнитель.</p>
        </section>
        <section className="login-card">
            <h2>Добро пожаловать</h2>
            <p>Выберите аккаунт для знакомства с чатом.</p>
            <div className="account-options" aria-label="Демоаккаунт">
                <button aria-pressed={account == 'alice'} disabled={action.pending} onClick={() => setAccount('alice')}>Алиса</button>
                <button aria-pressed={account == 'bob'} disabled={action.pending} onClick={() => setAccount('bob')}>Боб</button>
            </div>
            <form key={account} onSubmit={submit}>
                <label>Логин<input name="account" defaultValue={account} autoComplete="username" required/></label>
                <label>Пароль<input name="password" type="password" defaultValue={account + '-pass'} autoComplete="current-password" required/></label>
                <button className="primary" disabled={action.pending}>{action.pending ? 'Входим…' : 'Открыть чаты'}</button>
                {!!action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
            </form>
            <small>Общий разговор доступен Алисе и Бобу. Личный чат Алисы виден только ей.</small>
        </section>
    </main>
}

function SessionWorkspace({session, closeConversation}: {
    session: ChatSession, closeConversation: React.RefObject<(() => void) | null>
}) {
    const view = useClientStore(session.views.workspaces)
    const [selected, setSelected] = useState('')
    const initialized = useRef(false)
    const workspaces = view.state?.workspaces ?? []
    const workspace = workspaces.find(item => item.id == selected)
    useEffect(function chooseInitial() {
        if (!view.ready || initialized.current) return
        initialized.current = true
        setSelected(workspaces[0]?.id ?? '')
    }, [view.ready, workspaces])
    function chooseWorkspace(event: React.ChangeEvent<HTMLSelectElement>) {
        if (event.target.value == selected) return
        closeConversation.current?.()
        closeConversation.current = null
        setSelected(event.target.value)
    }
    return <div className="session-workspace">
        <div className="workspace-picker">
            <label htmlFor="workspace">Рабочее пространство</label>
            <select id="workspace" value={workspace ? selected : ''} onChange={chooseWorkspace} disabled={!view.ready}>
                {!workspace && <option value="">{selected ? 'Доступ к пространству отозван' : 'Выберите пространство'}</option>}
                {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </div>
        {workspace && <Workspace key={workspace.id} session={session} workspace={workspace} closeConversation={closeConversation}/>}
        {!workspace && <main className="connection-page">
            <h1>{view.ready ? 'Выберите рабочее пространство' : 'Загружаем пространства…'}</h1>
            {selected && <p role="status">Доступ к прежнему пространству отозван. Его история закрыта.</p>}
            {view.ready && !workspaces.length && <p>Сейчас у аккаунта нет доступных рабочих пространств.</p>}
            {!!view.error && <p className="error" role="alert">{errorText(view.error)}</p>}
        </main>}
    </div>
}

function MembershipPanel({session, workspace, account}: {session: ChatSession, workspace: ChatWorkspace, account: string}) {
    const key = useMemo(() => ({session, workspaceId: workspace.id}), [session, workspace.id])
    const action = useAsyncAction({key})
    const [ticket, setTicket] = useState<{
        requestId: string, input: WorkspaceMemberInput, command: ChatWorkspace['membershipCommand']
    } | null>(null)
    const pendingTicket = useRef<typeof ticket>(null)
    const mounted = useRef(true)
    useLayoutEffect(function lifecycle() {
        mounted.current = true
        return function close() {mounted.current = false}
    }, [])
    const ownRole = workspace.members.find(member => member.account == account)?.role
    if (ownRole != 'owner') return null
    const bob = workspace.members.find(member => member.account == 'bob')
    const owners = workspace.members.filter(member => member.role == 'owner')
    const lastOwner = bob?.role == 'owner' && owners.length == 1
    async function transmit(payload: NonNullable<typeof ticket>) {
        try {
            await action.run(() => session.commands[payload.command](payload.requestId, payload.input))
            if (!mounted.current || pendingTicket.current != payload) return
            pendingTicket.current = null
            setTicket(null)
        } catch {}
    }
    async function changeBob() {
        if (pendingTicket.current) return
        const input = Object.freeze({account: 'bob', role: bob ? 'none' as const : 'member' as const})
        const payload = Object.freeze({requestId: crypto.randomUUID(), input, command: workspace.membershipCommand})
        pendingTicket.current = payload
        setTicket(payload)
        await transmit(payload)
    }
    return <details className="membership-panel">
        <summary>Участники пространства</summary>
        <ul>{workspace.members.map(member => <li key={member.account}>{member.name}
            <span>{member.role == 'owner' ? 'Владелец' : 'Участник'}</span></li>)}</ul>
        {workspace.id == 'team' && <button disabled={action.pending || !!ticket || lastOwner} onClick={() => void changeBob()}>
            {bob ? 'Отозвать доступ Боба' : 'Добавить Боба'}
        </button>}
        {lastOwner && <p>Нельзя удалить последнего владельца.</p>}
        {ticket && !action.pending && <button onClick={() => void transmit(ticket)}>Повторить изменение</button>}
        {action.pending && <p role="status">Обновляем доступ…</p>}
        {!!action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
    </details>
}

function Workspace({session, workspace, closeConversation}: {
    session: ChatSession, workspace: ChatWorkspace, closeConversation: React.RefObject<(() => void) | null>
}) {
    const identity = useClientStore(useMemo(() => ({store: session.identity.permissions}), [session]))
    const ownerKey = useMemo(() => ({session, workspaceId: workspace.id}), [session, workspace.id])
    const resource = useOwnedClient({key: ownerKey, create: () => createConversationOwner({session, resourceName: workspace.resourceName})})
    const status = useClientStore(useMemo(() => resource.client ? {store: resource.client.status} : null, [resource.client]))
    const conversation = useClientStore(resource.client)
    const current = conversation.state?.ready ? resource.client?.current() : null
    const remote = current?.remote
    const client = current?.client ?? null
    const view = useClientStore(client)
    // Resource owns its authority connection independently of lazy service views/commands.
    const connected = status.state?.phase == 'ready'
    const available = connected && !!client && !!remote && view.ready
    const account = identity.state?.account ?? ''
    const [selected, setSelected] = useState('')
    const [showList, setShowList] = useState(true)
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [delivery, setDelivery] = useState<tDelivery | null>(null)
    const [creating, setCreating] = useState(false)
    const [title, setTitle] = useState('')
    const [shared, setShared] = useState(false)
    const [createInput, setCreateInput] = useState<ConversationCreateInput | null>(null)
    const [newMessages, setNewMessages] = useState(false)
    const action = useAsyncAction({key: client})
    const creation = useAsyncAction({key: client})
    const active = useRef({mounted: true, client})
    active.current.client = client
    const history = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLTextAreaElement>(null)
    const nearEnd = useRef(true)
    const previousLast = useRef('')
    const rooms = client ? client.conversations().sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)) : []
    const room = view.state?.conversations[selected]
    const messages = room && client ? client.channelMessages(room.rootChannelId) : []
    const lastUser = [...messages].reverse().find(message => message.author.kind == 'account')
    const text = drafts[selected] ?? ''
    const otherMembers = workspace.members.filter(member => member.account != account)
    const workspaceOwner = workspace.members.some(member => member.account == account && member.role == 'owner')

    useLayoutEffect(function registerOwner() {
        function closeScope() {
            active.current.mounted = false
            resource.close()
        }
        closeConversation.current = closeScope
        return function unregisterOwner() {
            closeScope()
            if (closeConversation.current == closeScope) closeConversation.current = null
        }
    }, [resource.close, closeConversation])

    useEffect(function lifecycle() {
        active.current.mounted = true
        return function close() {active.current.mounted = false}
    }, [])
    useEffect(function openRoom() {
        nearEnd.current = true
        previousLast.current = ''
        setNewMessages(false)
        if (!showList) input.current?.focus()
    }, [selected, showList, client])
    useEffect(function incoming() {
        const last = messages.at(-1)
        if (!last || last.id == previousLast.current) return
        previousLast.current = last.id
        if (nearEnd.current || last.createdBy == account) scrollToEnd()
        else setNewMessages(true)
    }, [messages, account])
    useEffect(function acceptedReceipt() {
        if (!delivery || !view.state) return
        const requestId = delivery.kind == 'demo' ? 'demo:' + delivery.input.requestId : delivery.input.requestId
        const accepted = Object.values(view.state.messages).some(message => message.requestId == requestId && message.createdBy == account)
        if (accepted) completeDelivery(delivery)
    })

    function scrollToEnd() {
        const element = history.current
        if (element) element.scrollTop = element.scrollHeight
        nearEnd.current = true
        setNewMessages(false)
    }
    function observeScroll() {
        const element = history.current
        if (!element) return
        nearEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        if (nearEnd.current) setNewMessages(false)
    }
    function choose(id: string) {
        setSelected(id)
        setShowList(false)
        setCreating(false)
    }
    function completeDelivery(ticket: tDelivery) {
        if (!active.current.mounted) return
        setDelivery(current => current?.input.requestId == ticket.input.requestId ? null : current)
        if (ticket.kind == 'message') setDrafts(function clearMatching(current) {
            if (current[ticket.input.conversationId] != ticket.text) return current
            return {...current, [ticket.input.conversationId]: ''}
        })
        action.clearError()
    }
    async function transmit(ticket: tDelivery) {
        if (!client || !remote || !available) return
        const sendingClient = client
        try {
            await action.run(function sendTicket() {
                if (ticket.kind == 'message') return sendingClient.postMessage(ticket.input)
                return remote!.demo.reply(ticket.input)
            })
            if (active.current.client == sendingClient) completeDelivery(ticket)
        } catch {}
    }
    async function send(event: React.FormEvent) {
        event.preventDefault()
        const blocked = !!delivery || action.pending || !available
        if (!room || !text.trim() || blocked) return
        const block = Object.freeze({kind: 'text' as const, version: 1 as const, text: text.trim()})
        const blocks = [block]
        Object.freeze(blocks)
        const ticket: tDelivery = Object.freeze({kind: 'message', title: room.title, text, input: Object.freeze({
            requestId: crypto.randomUUID(), conversationId: room.id, channelId: room.rootChannelId, blocks
        })})
        setDelivery(ticket)
        await transmit(ticket)
    }
    async function requestDemo() {
        const blocked = !!delivery || action.pending || !available
        if (!room || !lastUser || blocked) return
        const ticket: tDelivery = Object.freeze({kind: 'demo', title: room.title, input: Object.freeze({
            requestId: crypto.randomUUID(), conversationId: room.id, channelId: room.rootChannelId, sourceMessageId: lastUser.id
        })})
        setDelivery(ticket)
        await transmit(ticket)
    }
    async function create(event: React.FormEvent) {
        event.preventDefault()
        if (!client || !title.trim() || !available) return
        const sendingClient = client
        const participantIds = shared ? workspace.members.map(member => member.account) : [account]
        Object.freeze(participantIds)
        const payload = createInput ?? Object.freeze({requestId: crypto.randomUUID(), title: title.trim(), participantIds})
        setCreateInput(payload)
        try {
            const result = await creation.run(() => sendingClient.createConversation(payload))
            if (!active.current.mounted || active.current.client != sendingClient) return
            setTitle('')
            setCreateInput(null)
            choose(result.conversation.id)
        } catch {}
    }
    function composeKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
        const composing = event.nativeEvent.isComposing || event.keyCode == 229
        const newline = event.key != 'Enter' || event.shiftKey || composing
        if (newline) return
        event.preventDefault()
        event.currentTarget.form?.requestSubmit()
    }

    let connectionLabel = 'Подключаемся…'
    if (status.state?.phase == 'denied') connectionLabel = 'Нет доступа к чатам'
    else if (status.state?.phase == 'offline') connectionLabel = 'Соединение потеряно · восстанавливаем'
    else if (available) connectionLabel = 'Подключено'
    const connectionError = resource.error || conversation.state?.error || conversation.error || view.error
    let createLabel = createInput ? 'Повторить создание' : 'Создать'
    if (creation.pending) createLabel = 'Создаём…'
    return <main className={'workspace' + (showList ? ' show-list' : ' show-chat')}>
        <nav className="chat-list" aria-label="Чаты">
            <div className="list-heading"><div><p className="eyebrow">ВАШИ РАЗГОВОРЫ</p><h1>Чаты</h1></div>
                <button className="new-chat" disabled={!available} onClick={() => setCreating(!creating)} aria-expanded={creating}>+ Новый</button>
            </div>
            <p className="account-label">{workspace.members.find(member => member.account == account)?.name ?? account}
                <span> · {workspace.name}</span></p>
            {workspaceOwner && <MembershipPanel key={workspace.id} session={session} workspace={workspace} account={account}/>}
            {creating && <form className="new-chat-form" onSubmit={create}>
                <label>Название чата<input required autoFocus maxLength={120} value={title} disabled={creation.pending || !!createInput}
                    onChange={event => setTitle(event.target.value)}/></label>
                {!!otherMembers.length && <label className="shared-option">
                    <input type="checkbox" checked={shared} disabled={creation.pending || !!createInput}
                        onChange={event => setShared(event.target.checked)}/>Общий чат с {otherMembers.map(member => member.name).join(', ')}
                </label>}
                <button className="primary" disabled={!available || creation.pending || !title.trim()}>
                    {createLabel}
                </button>
                {!!creation.error && <p className="error" role="alert">{errorText(creation.error)}</p>}
            </form>}
            <div className="room-buttons">
                {rooms.map(function roomButton(item) {
                    const latest = client!.channelMessages(item.rootChannelId).at(-1)
                    return <button key={item.id} className={'room-button' + (selected == item.id ? ' selected' : '')}
                        aria-current={selected == item.id ? 'page' : undefined} onClick={() => choose(item.id)}>
                        <span className="room-icon" aria-hidden="true">{item.id == 'shared' ? '◉' : '◇'}</span>
                        <span className="room-copy"><strong>{item.title}</strong><small>{latest ? messageText(latest) : 'Начните разговор'}</small></span>
                    </button>
                })}
                {available && !rooms.length && <p className="empty">Создайте первый чат.</p>}
                {!available && <p className="empty">Загружаем список разговоров…</p>}
            </div>
            <p className="list-footnote">Обычный чат. Тестовый помощник — по вашему запросу.</p>
        </nav>
        <section className="conversation" aria-label="Разговор">
            <header className="conversation-header">
                <button className="mobile-back quiet" onClick={() => setShowList(true)} aria-label="Вернуться к списку чатов">← Чаты</button>
                <div><h2>{room?.title ?? 'Ваш разговор'}</h2>
                    <p className={'connection' + (available ? ' online' : '')} role="status">{connectionLabel}</p></div>
            </header>
            <div className="history" ref={history} onScroll={observeScroll} tabIndex={0} aria-label="История сообщений">
                {!!connectionError && <p className="error" role="alert">{errorText(connectionError)}</p>}
                {!available && <div className="history-empty"><h3>Возвращаемся к разговору</h3>
                    <p>Черновик сохранён. Дождитесь восстановления соединения.</p></div>}
                {available && !room && <div className="history-empty"><h3>Выберите чат</h3><p>Откройте разговор из списка или создайте новый.</p></div>}
                {available && room && !messages.length && <div className="history-empty"><span aria-hidden="true">◌</span>
                    <h3>Начните с одного сообщения</h3><p>Здесь будет история вашего разговора.</p></div>}
                {messages.map(function renderMessage(item) {
                    const mine = item.author.kind == 'account' && item.author.account == account
                    return <article key={item.id} className={'message' + (mine ? ' mine' : '')}>
                        <div className="message-meta"><strong>{authorName(item)}</strong>
                            <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleTimeString('ru', {
                                hour: '2-digit', minute: '2-digit'
                            })}</time></div>
                        <p>{messageText(item)}</p>
                        {mine && <small className="receipt">Отправлено</small>}
                    </article>
                })}
            </div>
            <div className="compose-area">
                {newMessages && <button className="new-messages" onClick={scrollToEnd}>Новые сообщения ↓</button>}
                {delivery && <div className="delivery-status" role="status">
                    <p>{action.pending ? 'Отправляем' : 'Подтверждение ещё не получено'} · {delivery.title}</p>
                    {!!action.error && <p className="error" role="alert">{errorText(action.error)}</p>}
                    {!action.pending && <button disabled={!available} onClick={() => void transmit(delivery)}>Повторить отправку</button>}
                </div>}
                {room && <>
                    <form className="composer" onSubmit={send}>
                        <label className="visually-hidden" htmlFor="message">Сообщение</label>
                        <textarea id="message" ref={input} rows={2} maxLength={4000} value={text} placeholder="Напишите сообщение…"
                            disabled={!!delivery && delivery.input.conversationId == selected}
                            onKeyDown={composeKey} onChange={event => setDrafts({...drafts, [selected]: event.target.value})}/>
                        <button className="primary send" disabled={!available || !!delivery || action.pending || !text.trim()}>
                            Отправить <span aria-hidden="true">↑</span></button>
                    </form>
                    <div className="composer-footer"><small>Enter — отправить · Shift + Enter — новая строка</small>
                        <button className="quiet" disabled={!available || !lastUser || !!delivery || action.pending} onClick={() => void requestDemo()}>
                            Ответ тестового помощника
                        </button>
                    </div>
                </>}
            </div>
        </section>
    </main>
}

createRoot(document.getElementById('root')!).render(<App/>)
