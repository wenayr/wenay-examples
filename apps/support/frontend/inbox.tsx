import React, {useEffect, useRef, useState} from 'react'
import type {SupportWorkspace} from '../backend/domain'
import type {Ticket} from '../backend/model'
import {AssistantPanel} from './assistant'
import {Attachments} from './attachments'
import {ConversationHistory} from './conversation-history'
import {
    Avatar, dateLabel, priorityLabels, statusLabels,
    type CommandController, type SupportResources
} from './contracts'

type Organization = SupportWorkspace['organizations'][number]

type InboxProps = {
    value: SupportWorkspace,
    org: Organization,
    commands: CommandController,
    resources: SupportResources,
    busy: boolean
}

export function Inbox({value, org, commands, resources, busy}: InboxProps) {
    const [selected, setSelected] = useState('')
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState('active')
    const [creating, setCreating] = useState(false)
    const [now, setNow] = useState(Date.now)
    const inboxRef = useRef<HTMLDivElement>(null)

    useEffect(function refreshDeadlines() {
        const timer = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(timer)
    }, [])

    const staff = org.role != 'customer'
    const mine = value.tickets.filter(item => item.orgId == org.id)
    const all = mine.sort((a, b) => b.updatedAt - a.updatedAt)

    function unanswered(item: Ticket) {
        return item.status != 'resolved' && item.firstResponseAt == undefined
    }
    function overdue(item: Ticket) {
        return unanswered(item) && item.dueAt != undefined && item.dueAt <= now
    }

    // Фильтр и поиск независимы: список — пересечение того и другого.
    function inFilter(item: SupportWorkspace['tickets'][number]) {
        if (filter == 'all') return true
        if (filter == 'mine') return item.assignee == value.account.account
        if (filter == 'unanswered') return unanswered(item)
        if (filter == 'overdue') return overdue(item)
        if (filter == 'unassigned') return item.status != 'resolved' && !item.assignee
        if (filter == 'waiting') return item.status == 'waiting'
        if (filter == 'resolved') return item.status == 'resolved'
        return item.status != 'resolved'
    }
    const needle = query.toLocaleLowerCase('ru')
    function matches(item: SupportWorkspace['tickets'][number]) {
        const text = item.subject + ' ' + item.messages.map(message => message.body).join(' ')
        return text.toLocaleLowerCase('ru').includes(needle)
    }

    const tickets = all.filter(item => inFilter(item) && matches(item))
    const ticket = tickets.find(item => item.id == selected) ?? tickets[0]

    function name(account: string) {
        const person = value.people.find(function same(item) {
            return item.orgId == org.id && item.account == account
        })
        return person?.name.split(' · ')[0] ?? account
    }

    async function createTicket(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const ok = await commands.run('ticketCreate', {
            orgId: org.id,
            subject: String(form.get('subject')),
            body: String(form.get('body')),
            priority: String(form.get('priority')) as Ticket['priority']
        })
        if (!ok) return
        setCreating(false)
        setSelected('')
        setQuery('')
        setFilter('active')
    }

    const filters = [
        {id: 'active', title: 'Открытые'},
        ...(staff ? [{id: 'mine', title: 'Мои'}] : []),
        {id: 'resolved', title: 'Решённые'},
        {id: 'all', title: 'Все'}
    ]

    const queues = staff ? [
        {id: 'unanswered', title: 'Без первого ответа', count: all.filter(unanswered).length},
        {id: 'overdue', title: 'Срок ответа истёк', count: all.filter(overdue).length},
        {id: 'unassigned', title: 'Без ответственного', count: all.filter(item => item.status != 'resolved' && !item.assignee).length},
        {id: 'mine', title: 'Назначены мне', count: all.filter(item => item.assignee == value.account.account).length}
    ] : [
        {id: 'active', title: 'Открытые обращения', count: all.filter(item => item.status != 'resolved').length},
        {id: 'waiting', title: 'В ожидании', count: all.filter(item => item.status == 'waiting').length},
        {id: 'resolved', title: 'Решённые вопросы', count: all.filter(item => item.status == 'resolved').length}
    ]
    const needsReply = all.filter(unanswered)
    const byDeadline = [...needsReply].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    const attention = byDeadline.slice(0, 3)
    const queueTitle = queues.find(item => item.id == filter)?.title ?? filters.find(item => item.id == filter)?.title

    function chooseQueue(id: string) {
        setFilter(id)
        setQuery('')
    }
    function openAttention(id: string) {
        setFilter('all')
        setQuery('')
        setSelected(id)
        inboxRef.current?.scrollIntoView({block: 'start'})
    }

    const overview = <section className={'queue-overview' + (staff ? '' : ' customer')} aria-label="Обзор обращений">
        <div className="queue-summary">
            <div className="queue-summary-heading">
                <p className="eyebrow">{staff ? 'ОЧЕРЕДЬ КОМАНДЫ' : 'ВАШИ ОБРАЩЕНИЯ'}</p>
                <span>{all.length} всего</span>
            </div>
            <div className="queue-counters">
                {queues.map(item => <button key={item.id} aria-pressed={filter == item.id} onClick={() => chooseQueue(item.id)}>
                    <strong>{item.count}</strong><span>{item.title}</span>
                </button>)}
            </div>
        </div>
        {staff && <div className="queue-attention">
            <div className="queue-attention-heading">
                <h2>Первый ответ</h2>
                <p>Сначала обращения с ближайшим сроком</p>
            </div>
            {attention.length > 0 ? <div className="queue-attention-list">
                {attention.map(item => <button key={item.id} onClick={() => openAttention(item.id)}>
                    <span className={'queue-deadline' + (overdue(item) ? ' overdue' : '')}>
                        {item.dueAt ? dateLabel(item.dueAt) : 'Срок не задан'}
                        {overdue(item) && <small>Просрочено</small>}
                    </span>
                    <span><strong>{item.subject}</strong><small>{item.assignee ? name(item.assignee) : 'Назначьте ответственного'}</small></span>
                    <span aria-hidden="true">→</span>
                </button>)}
            </div> : <p className="queue-clear">Нет открытых обращений без первого ответа. Продолжайте текущие диалоги в списке ниже.</p>}
        </div>}
    </section>

    function resetFilters() {
        setQuery('')
        setFilter('all')
    }

    const form = <form className="create-ticket panel-form" onSubmit={createTicket}>
        <div className="form-heading">
            <h2>Чем можем помочь?</h2>
            <p>Опишите ситуацию — так команда быстрее найдёт решение.</p>
        </div>
        <label>Тема
            <input
                name="subject"
                placeholder="Например, нужна помощь с настройкой команды"
                maxLength={180}
                required
                autoFocus
            />
        </label>
        <label>Сообщение
            <textarea
                name="body"
                rows={3}
                maxLength={12000}
                required
                placeholder="Что произошло и какой результат вы ожидаете?"
            />
        </label>
        <div className="form-actions">
            <label>Приоритет
                <select name="priority" defaultValue="normal">
                    {Object.entries(priorityLabels).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                    ))}
                </select>
            </label>
            <button className="primary" disabled={busy}>
                {busy ? 'Создаём…' : 'Создать обращение'}
            </button>
        </div>
    </form>

    function card(item: SupportWorkspace['tickets'][number]) {
        const day = new Date(item.updatedAt).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})
        const last = item.messages.filter(message => !message.private).at(-1)
        return <button
            className={'ticket-card' + (ticket?.id == item.id ? ' active' : '')}
            key={item.id}
            aria-pressed={ticket?.id == item.id}
            onClick={() => setSelected(item.id)}
        >
            <div className="ticket-card-meta">
                <Avatar name={name(item.customer)} small/>
                <span>{name(item.customer)}</span>
                <time dateTime={new Date(item.updatedAt).toISOString()}>{day}</time>
            </div>
            <h2>{item.subject}</h2>
            <p>{last?.body ?? 'Сообщений пока нет'}</p>
            <div className="ticket-card-tags">
                <span className={'status-tag ' + item.status}>{statusLabels[item.status]}</span>
                {item.priority != 'normal' && (
                    <span className={'priority-tag ' + item.priority}>{priorityLabels[item.priority]}</span>
                )}
                <span className="message-count">{item.messageCount} сообщ.</span>
            </div>
        </button>
    }

    const list = <section className="ticket-list" aria-label="Список обращений">
        <div className="list-tools">
            <label className="search-field">
                <span aria-hidden="true">⌕</span>
                <input
                    aria-label="Поиск обращений"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Найти обращение…"
                />
            </label>
            <div className="filter-tabs" aria-label="Фильтр обращений">
                {filters.map(item => (
                    <button key={item.id} aria-pressed={filter == item.id} onClick={() => setFilter(item.id)}>
                        {item.title}
                    </button>
                ))}
            </div>
        </div>
        <div className="list-count">
            <strong>{queueTitle} · {tickets.length}</strong>
            {filter != 'all' && <button onClick={resetFilters}>Все обращения</button>}
        </div>
        <div className="tickets-scroll">
            {tickets.map(card)}
            {!tickets.length && <div className="empty-state">
                <span>✓</span>
                <h3>{query ? 'Обращения не найдены' : 'Нет обращений в этом списке'}</h3>
                <p>
                    {query
                        ? 'Попробуйте другую тему или снимите фильтр.'
                        : 'Проверьте другие статусы или создайте обращение.'}
                </p>
                {(query || filter != 'all') && <button onClick={resetFilters}>Показать все обращения</button>}
            </div>}
        </div>
    </section>

    const nothing = <section className="conversation empty-conversation">
        <div className="empty-state">
            <span>✳</span>
            <h2>Выберите обращение</h2>
            <p>Здесь появятся переписка, вложения и действия по выбранному обращению.</p>
        </div>
    </section>

    const open = all.filter(item => item.status != 'resolved').length

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">{staff ? 'ПОДДЕРЖКА КЛИЕНТОВ' : 'СВЯЗЬ С ПОДДЕРЖКОЙ'}</p>
                <h1>
                    {staff ? 'Обращения' : 'Мои обращения'} <span className="heading-count">{open} открытых</span>
                </h1>
                <p>
                    {staff
                        ? 'Отвечайте клиентам, следите за сроками и распределяйте работу.'
                        : 'Задайте вопрос и продолжайте разговор с командой.'}
                </p>
            </div>
            <button className="primary" disabled={busy} onClick={() => setCreating(!creating)}>
                {creating ? 'Закрыть форму' : '+ Новое обращение'}
            </button>
        </div>
        {overview}
        {creating && form}
        <div className="inbox-layout" ref={inboxRef}>
            {list}
            {ticket ? <Conversation
                key={ticket.id + ':' + org.role}
                ticket={ticket}
                org={org}
                value={value}
                resources={resources}
                commands={commands}
                busy={busy}
                name={name}
            /> : nothing}
        </div>
    </>
}

type ConversationProps = {
    ticket: SupportWorkspace['tickets'][number],
    org: Organization,
    value: SupportWorkspace,
    resources: SupportResources,
    commands: CommandController,
    busy: boolean,
    name: (account: string) => string
}

function Conversation({ticket, org, value, resources, commands, busy, name}: ConversationProps) {
    const [draft, setDraft] = useState('')
    const [privateNote, setPrivateNote] = useState(false)
    const [sent, setSent] = useState('')
    const [articleId, setArticleId] = useState('')
    const [confirmTask, setConfirmTask] = useState(false)
    const [taskCreated, setTaskCreated] = useState(false)

    const staff = org.role != 'customer'
    const people = value.people.filter(function assignable(person) {
        return person.orgId == org.id && person.role != 'customer'
    })
    const articles = value.articles.filter(function open(item) {
        return item.orgId == org.id && item.status == 'published'
    })
    const article = articles.find(item => item.id == articleId)
    const reference = {orgId: org.id, id: ticket.id, revision: ticket.revision}

    async function sendReply(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const ok = await commands.run('ticketReply', {
            ...reference,
            body: draft,
            private: staff && privateNote
        })
        if (!ok) return
        setDraft('')
        setSent(privateNote ? 'Заметка сохранена для команды' : 'Ответ отправлен')
    }
    async function assign(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketAssign', {...reference, assignee: event.target.value})
    }
    async function createTask() {
        const created = await commands.run('taskFromTicket', {
            orgId: org.id,
            ticketId: ticket.id,
            revision: ticket.revision
        })
        if (!created) return
        setTaskCreated(true)
        setConfirmTask(false)
    }
    async function updateStatus(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketStatus', {
            ...reference,
            status: event.target.value as Ticket['status'],
            priority: ticket.priority
        })
    }
    async function updatePriority(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketStatus', {
            ...reference,
            status: ticket.status,
            priority: event.target.value as Ticket['priority']
        })
    }
    async function updateDeadline(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const dueAt = new Date(String(new FormData(event.currentTarget).get('dueAt'))).getTime()
        await commands.run('ticketDue', {...reference, dueAt})
    }
    function receiveDraft(text: string) {
        setDraft(text)
        setPrivateNote(false)
        setSent('Черновик добавлен. Проверьте его перед отправкой.')
    }
    function updateDraft(event: React.ChangeEvent<HTMLTextAreaElement>) {
        setDraft(event.target.value)
        setSent('')
    }

    // Поле datetime-local показывает местное время, поэтому смещение снимаем заранее.
    const offset = ticket.dueAt ? new Date(ticket.dueAt).getTimezoneOffset() * 60000 : 0
    const localDeadline = ticket.dueAt
        ? new Date(ticket.dueAt - offset).toISOString().slice(0, 16)
        : ''

    const messages = <div className="messages">
        <div className="timeline-start">{dateLabel(ticket.createdAt)} · Обращение создано</div>
        <ConversationHistory
            key={ticket.id + ':' + ticket.revision + ':' + org.role}
            resources={resources}
            orgId={org.id}
            ticketId={ticket.id}
            firstId={ticket.messages[0]?.id ?? ''}
            count={ticket.messageCount}
            name={name}
        />
        {ticket.messages.map(function message(item) {
            const own = item.author == value.account.account ? ' own' : ''
            return <article className={'message' + (item.private ? ' private-note' : '') + own} key={item.id}>
                <div className="message-meta">
                    <Avatar name={name(item.author)} small/>
                    <strong>{name(item.author)}</strong>
                    {item.private && <span>Заметка команде</span>}
                    <time dateTime={new Date(item.at).toISOString()}>{dateLabel(item.at)}</time>
                </div>
                <p>{item.body}</p>
            </article>
        })}
    </div>

    let composerHint = privateNote ? 'Видно только сотрудникам' : 'Сообщение увидят участники обращения'
    if (sent) composerHint = sent

    let sendLabel = privateNote ? 'Сохранить заметку' : 'Отправить ответ ↗'
    if (busy) sendLabel = 'Отправляем…'

    const composer = <form
        className={'reply-composer' + (privateNote ? ' note-composer' : '')}
        onSubmit={sendReply}
    >
        <div className="composer-toolbar">
            <strong>{privateNote ? 'Заметка для команды' : 'Ответ в обращение'}</strong>
            {staff && <label className="checkbox-label">
                <input
                    type="checkbox"
                    checked={privateNote}
                    onChange={event => setPrivateNote(event.target.checked)}
                />
                Только команде
            </label>}
        </div>
        <label className="sr-only" htmlFor="reply-body">Текст ответа</label>
        <textarea
            id="reply-body"
            value={draft}
            onChange={updateDraft}
            placeholder={privateNote ? 'Клиент не увидит эту заметку…' : 'Напишите внимательный ответ…'}
            rows={4}
            maxLength={12000}
            required
        />
        <div className="composer-footer">
            <small role="status">{composerHint}</small>
            <button className="primary" disabled={busy || !draft.trim()}>{sendLabel}</button>
        </div>
    </form>

    const details = staff ? <div className="details-fields">
        <label>Ответственный
            <select value={ticket.assignee} disabled={busy} onChange={assign}>
                <option value="">Не назначен</option>
                {people.map(person => (
                    <option key={person.account} value={person.account}>{name(person.account)}</option>
                ))}
            </select>
        </label>
        <label>Статус
            <select value={ticket.status} disabled={busy} onChange={updateStatus}>
                {Object.entries(statusLabels).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                ))}
            </select>
        </label>
        <label>Приоритет
            <select value={ticket.priority} disabled={busy} onChange={updatePriority}>
                {Object.entries(priorityLabels).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                ))}
            </select>
        </label>
    </div> : <dl className="ticket-details">
        <dt>Приоритет</dt>
        <dd>{priorityLabels[ticket.priority]}</dd>
        <dt>Специалист</dt>
        <dd>{ticket.assignee ? name(ticket.assignee) : 'Скоро назначим'}</dd>
    </dl>

    let taskBlock = <button disabled={busy} onClick={() => setConfirmTask(true)}>
        Создать задачу из обращения
    </button>
    if (taskCreated) {
        taskBlock = <p role="status">
            Задача доступна в разделе «Задачи команды». Повторное создание не добавляет дубликат.
        </p>
    } else if (confirmTask) {
        taskBlock = <>
            <p>Создать задачу «{ticket.subject}» и назначить её себе? Переписка останется в обращении.</p>
            <button className="primary" disabled={busy} onClick={() => void createTask()}>
                Да, создать задачу
            </button>
            <button disabled={busy} onClick={() => setConfirmTask(false)}>Отмена</button>
        </>
    }

    const deadline = ticket.firstResponseAt
        ? <p className="muted">Ответили {dateLabel(ticket.firstResponseAt)}</p>
        : <>
            <p className="muted">
                {ticket.dueAt ? 'Ожидается до ' + dateLabel(ticket.dueAt) : 'Срок не задан'}
            </p>
            {staff && <form key={ticket.revision} className="deadline-form" onSubmit={updateDeadline}>
                <label>Изменить срок
                    <input
                        type="datetime-local"
                        name="dueAt"
                        defaultValue={localDeadline}
                        required
                        aria-label="Срок первого ответа"
                    />
                </label>
                <button disabled={busy}>Сохранить срок</button>
            </form>}
        </>

    const knownArticles = value.articles.filter(item => item.orgId == org.id).map(function state(item) {
        return {id: item.id, revision: item.revision, status: item.status}
    })

    return <>
        <section className="conversation" aria-label="Переписка">
            <header className="conversation-header">
                <span className="eyebrow">
                    ОБРАЩЕНИЕ · {ticket.id.replace('ticket-', '').slice(0, 14)}
                </span>
                <h2>{ticket.subject}</h2>
                <div>
                    <Avatar name={name(ticket.customer)} small/>
                    <strong>{name(ticket.customer)}</strong>
                    <span className={'status-tag ' + ticket.status}>{statusLabels[ticket.status]}</span>
                </div>
            </header>
            {messages}
            {composer}
        </section>
        <aside className="context-panel" aria-label="Контекст обращения">
            <section className="context-section">
                <div className="context-heading">
                    <h3>Детали обращения</h3>
                    <span>◌</span>
                </div>
                {details}
            </section>
            <section className="context-section attachment-slot">
                <Attachments resources={resources} orgId={org.id} ticketId={ticket.id} disabled={busy}/>
            </section>
            {staff && <section className="context-section">
                <div className="context-heading">
                    <h3>Работа по обращению</h3>
                    <span>▦</span>
                </div>
                {taskBlock}
            </section>}
            <section className="context-section">
                <div className="context-heading">
                    <h3>Первый ответ</h3>
                    <span>◷</span>
                </div>
                {deadline}
            </section>
            {staff && <section className="context-section assistant-slot">
                <AssistantPanel
                    articles={knownArticles}
                    resources={resources}
                    orgId={org.id}
                    ticketId={ticket.id}
                    revision={ticket.revision}
                    disabled={busy}
                    onDraft={receiveDraft}
                />
            </section>}
            <section className="context-section">
                <div className="context-heading">
                    <h3>Полезные знания</h3>
                    <span>▥</span>
                </div>
                <p className="muted">Проверенные ответы вашей команды.</p>
                <div className="knowledge-links">
                    {articles.map(item => (
                        <button
                            key={item.id}
                            aria-expanded={articleId == item.id}
                            onClick={() => setArticleId(articleId == item.id ? '' : item.id)}
                        >
                            <span>▤</span>{item.title}<span>↗</span>
                        </button>
                    ))}
                </div>
                {!articles.length && <p className="muted">Опубликованных статей пока нет.</p>}
                {article && <article className="article-preview">
                    <h4>{article.title}</h4>
                    <p>{article.body}</p>
                </article>}
            </section>
            <div className="context-footnote">Обновлено {dateLabel(ticket.updatedAt)}</div>
        </aside>
    </>
}
