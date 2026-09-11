import React, {useState} from 'react'
import type {SupportWorkspace} from '../backend/domain'
import type {Ticket} from '../backend/model'
import {AssistantPanel} from './assistant'
import {Attachments} from './attachments'
import {ConversationHistory} from './conversation-history'
import {Avatar, dateLabel, priorityLabels, statusLabels, type CommandController, type SupportResources} from './contracts'

type Organization = SupportWorkspace['organizations'][number]

export function Inbox({value, org, commands, resources, busy}: {value: SupportWorkspace, org: Organization, commands: CommandController, resources: SupportResources, busy: boolean}) {
    const [selected, setSelected] = useState('')
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState('active')
    const [creating, setCreating] = useState(false)
    const staff = org.role != 'customer'
    const all = value.tickets.filter(item => item.orgId == org.id).sort((a, b) => b.updatedAt - a.updatedAt)
    const tickets = all.filter(item => (filter == 'all' || (filter == 'mine' ? item.assignee == value.account.account : filter == 'resolved' ? item.status == 'resolved' : item.status != 'resolved')) && (item.subject + ' ' + item.messages.map(message => message.body).join(' ')).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))
    const ticket = tickets.find(item => item.id == selected) ?? tickets[0]
    const name = (account: string) => value.people.find(person => person.orgId == org.id && person.account == account)?.name.split(' · ')[0] ?? account

    async function createTicket(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const ok = await commands.run('ticketCreate', {orgId: org.id, subject: String(form.get('subject')), body: String(form.get('body')), priority: String(form.get('priority')) as Ticket['priority']})
        if (ok) {
            setCreating(false)
            setSelected('')
            setQuery('')
            setFilter('active')
        }
    }

    return <>
        <div className="page-heading"><div><p className="eyebrow">{staff ? 'ПОМОГАЕМ ДВИГАТЬСЯ ДАЛЬШЕ' : 'МЫ РЯДОМ'}</p><h1>{staff ? 'Входящие' : 'Мои обращения'} <span className="heading-count">{all.filter(item => item.status != 'resolved').length}</span></h1><p>{staff ? 'Все разговоры вашей команды — в одном месте.' : 'Задайте вопрос и продолжайте разговор с командой.'}</p></div><button className="primary" disabled={busy} onClick={() => setCreating(!creating)}>{creating ? 'Закрыть форму' : '+ Новое обращение'}</button></div>
        {creating && <form className="create-ticket panel-form" onSubmit={createTicket}><div className="form-heading"><h2>Чем можем помочь?</h2><p>Опишите ситуацию — так команда быстрее найдёт решение.</p></div><label>Тема<input name="subject" placeholder="Например, нужна помощь с настройкой команды" maxLength={180} required autoFocus/></label><label>Сообщение<textarea name="body" rows={3} maxLength={12000} required placeholder="Что произошло и какой результат вы ожидаете?"/></label><div className="form-actions"><label>Приоритет<select name="priority" defaultValue="normal">{Object.entries(priorityLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button className="primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать обращение'}</button></div></form>}
        <div className="inbox-layout"><section className="ticket-list" aria-label="Список обращений"><div className="list-tools"><label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Поиск обращений" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти обращение…"/></label><div className="filter-tabs" aria-label="Фильтр обращений">{[{id: 'active', title: 'Открытые'}, ...(staff ? [{id: 'mine', title: 'Мои'}] : []), {id: 'resolved', title: 'Решённые'}, {id: 'all', title: 'Все'}].map(item => <button key={item.id} aria-pressed={filter == item.id} onClick={() => setFilter(item.id)}>{item.title}</button>)}</div></div><div className="list-count">{tickets.length} обращений <span>По последнему обновлению</span></div><div className="tickets-scroll">{tickets.map(item => <button className={'ticket-card' + (ticket?.id == item.id ? ' active' : '')} key={item.id} aria-pressed={ticket?.id == item.id} onClick={() => setSelected(item.id)}><div className="ticket-card-meta"><Avatar name={name(item.customer)} small/><span>{name(item.customer)}</span><time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})}</time></div><h2>{item.subject}</h2><p>{item.messages.filter(message => !message.private).at(-1)?.body ?? 'Сообщений пока нет'}</p><div className="ticket-card-tags"><span className={'status-tag ' + item.status}>{statusLabels[item.status]}</span>{item.priority != 'normal' && <span className={'priority-tag ' + item.priority}>{priorityLabels[item.priority]}</span>}<span className="message-count">{item.messageCount} сообщ.</span></div></button>)}{!tickets.length && <div className="empty-state"><span>✓</span><h3>{query ? 'Ничего не найдено' : 'Здесь пока спокойно'}</h3><p>{query ? 'Попробуйте другую тему или снимите фильтр.' : 'Новые обращения появятся в этом списке.'}</p></div>}</div></section>
            {ticket ? <Conversation key={ticket.id + ':' + org.role} ticket={ticket} org={org} value={value} resources={resources} commands={commands} busy={busy} name={name}/> : <section className="conversation empty-conversation"><div className="empty-state"><span>✳</span><h2>Начнём с разговора</h2><p>Создайте обращение или выберите другой фильтр.</p></div></section>}
        </div>
    </>
}

function Conversation({ticket, org, value, resources, commands, busy, name}: {ticket: SupportWorkspace['tickets'][number], org: Organization, value: SupportWorkspace, resources: SupportResources, commands: CommandController, busy: boolean, name: (account: string) => string}) {
    const [draft, setDraft] = useState('')
    const [privateNote, setPrivateNote] = useState(false)
    const [sent, setSent] = useState('')
    const [articleId, setArticleId] = useState('')
    const [confirmTask, setConfirmTask] = useState(false)
    const [taskCreated, setTaskCreated] = useState(false)
    const staff = org.role != 'customer'
    const people = value.people.filter(person => person.orgId == org.id && person.role != 'customer')
    const articles = value.articles.filter(article => article.orgId == org.id && article.status == 'published')
    const article = articles.find(item => item.id == articleId)

    async function sendReply(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (await commands.run('ticketReply', {orgId: org.id, id: ticket.id, revision: ticket.revision, body: draft, private: staff && privateNote})) {
            setDraft('')
            setSent(privateNote ? 'Заметка сохранена для команды' : 'Ответ отправлен')
        }
    }

    async function assign(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketAssign', {orgId: org.id, id: ticket.id, revision: ticket.revision, assignee: event.target.value})
    }

    async function createTask() {
        if (await commands.run('taskFromTicket', {orgId: org.id, ticketId: ticket.id, revision: ticket.revision})) {
            setTaskCreated(true)
            setConfirmTask(false)
        }
    }

    async function updateStatus(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketStatus', {orgId: org.id, id: ticket.id, revision: ticket.revision, status: event.target.value as Ticket['status'], priority: ticket.priority})
    }

    async function updatePriority(event: React.ChangeEvent<HTMLSelectElement>) {
        await commands.run('ticketStatus', {orgId: org.id, id: ticket.id, revision: ticket.revision, status: ticket.status, priority: event.target.value as Ticket['priority']})
    }

    async function updateDeadline(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const dueAt = new Date(String(new FormData(event.currentTarget).get('dueAt'))).getTime()
        await commands.run('ticketDue', {orgId: org.id, id: ticket.id, revision: ticket.revision, dueAt})
    }

    const localDeadline = ticket.dueAt ? new Date(ticket.dueAt - new Date(ticket.dueAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''

    return <><section className="conversation" aria-label="Переписка"><header className="conversation-header"><span className="eyebrow">ОБРАЩЕНИЕ · {ticket.id.replace('ticket-', '').slice(0, 14)}</span><h2>{ticket.subject}</h2><div><Avatar name={name(ticket.customer)} small/><strong>{name(ticket.customer)}</strong><span className={'status-tag ' + ticket.status}>{statusLabels[ticket.status]}</span></div></header><div className="messages"><div className="timeline-start">{dateLabel(ticket.createdAt)} · Обращение создано</div><ConversationHistory key={ticket.id + ':' + ticket.revision + ':' + org.role} resources={resources} orgId={org.id} ticketId={ticket.id} firstId={ticket.messages[0]?.id ?? ''} count={ticket.messageCount} name={name}/>{ticket.messages.map(message => <article className={'message' + (message.private ? ' private-note' : '') + (message.author == value.account.account ? ' own' : '')} key={message.id}><div className="message-meta"><Avatar name={name(message.author)} small/><strong>{name(message.author)}</strong>{message.private && <span>Заметка команде</span>}<time dateTime={new Date(message.at).toISOString()}>{dateLabel(message.at)}</time></div><p>{message.body}</p></article>)}</div><form className={'reply-composer' + (privateNote ? ' note-composer' : '')} onSubmit={sendReply}><div className="composer-toolbar"><strong>{privateNote ? 'Заметка для команды' : 'Ответ в обращение'}</strong>{staff && <label className="checkbox-label"><input type="checkbox" checked={privateNote} onChange={event => setPrivateNote(event.target.checked)}/>Только команде</label>}</div><label className="sr-only" htmlFor="reply-body">Текст ответа</label><textarea id="reply-body" value={draft} onChange={function updateDraft(event) {setDraft(event.target.value); setSent('')}} placeholder={privateNote ? 'Клиент не увидит эту заметку…' : 'Напишите внимательный ответ…'} rows={4} maxLength={12000} required/><div className="composer-footer"><small role="status">{sent || (privateNote ? 'Видно только сотрудникам' : 'Сообщение увидят участники обращения')}</small><button className="primary" disabled={busy || !draft.trim()}>{busy ? 'Отправляем…' : privateNote ? 'Сохранить заметку' : 'Отправить ответ ↗'}</button></div></form></section>
        <aside className="context-panel" aria-label="Контекст обращения"><section className="context-section"><div className="context-heading"><h3>Детали обращения</h3><span>◌</span></div>{staff ? <div className="details-fields"><label>Ответственный<select value={ticket.assignee} disabled={busy} onChange={assign}><option value="">Не назначен</option>{people.map(person => <option key={person.account} value={person.account}>{name(person.account)}</option>)}</select></label><label>Статус<select value={ticket.status} disabled={busy} onChange={updateStatus}>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Приоритет<select value={ticket.priority} disabled={busy} onChange={updatePriority}>{Object.entries(priorityLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div> : <dl className="ticket-details"><dt>Приоритет</dt><dd>{priorityLabels[ticket.priority]}</dd><dt>Специалист</dt><dd>{ticket.assignee ? name(ticket.assignee) : 'Скоро назначим'}</dd></dl>}</section>
            <section className="context-section attachment-slot"><Attachments resources={resources} orgId={org.id} ticketId={ticket.id} disabled={busy}/></section>
            {staff && <section className="context-section"><div className="context-heading"><h3>Работа по обращению</h3><span>▦</span></div>{taskCreated ? <p role="status">Задача доступна в разделе «Задачи команды». Повторное создание не добавляет дубликат.</p> : confirmTask ? <><p>Создать задачу «{ticket.subject}» и назначить её себе? Переписка останется в обращении.</p><button className="primary" disabled={busy} onClick={() => void createTask()}>Да, создать задачу</button><button disabled={busy} onClick={() => setConfirmTask(false)}>Отмена</button></> : <button disabled={busy} onClick={() => setConfirmTask(true)}>Создать задачу из обращения</button>}</section>}
            <section className="context-section"><div className="context-heading"><h3>Первый ответ</h3><span>◷</span></div>{ticket.firstResponseAt ? <p className="muted">Ответили {dateLabel(ticket.firstResponseAt)}</p> : <><p className="muted">{ticket.dueAt ? 'Ожидается до ' + dateLabel(ticket.dueAt) : 'Срок не задан'}</p>{staff && <form key={ticket.revision} className="deadline-form" onSubmit={updateDeadline}><label>Изменить срок<input type="datetime-local" name="dueAt" defaultValue={localDeadline} required aria-label="Срок первого ответа"/></label><button disabled={busy}>Сохранить срок</button></form>}</>}</section>
            {staff && <section className="context-section assistant-slot"><AssistantPanel articles={value.articles.filter(item => item.orgId == org.id).map(item => ({id: item.id, revision: item.revision, status: item.status}))} resources={resources} orgId={org.id} ticketId={ticket.id} revision={ticket.revision} disabled={busy} onDraft={function receiveDraft(text) {setDraft(text); setPrivateNote(false); setSent('Черновик добавлен. Проверьте его перед отправкой.')}}/></section>}
            <section className="context-section"><div className="context-heading"><h3>Полезные знания</h3><span>▥</span></div><p className="muted">Проверенные ответы вашей команды.</p><div className="knowledge-links">{articles.map(item => <button key={item.id} aria-expanded={articleId == item.id} onClick={() => setArticleId(articleId == item.id ? '' : item.id)}><span>▤</span>{item.title}<span>↗</span></button>)}</div>{!articles.length && <p className="muted">Опубликованных статей пока нет.</p>}{article && <article className="article-preview"><h4>{article.title}</h4><p>{article.body}</p></article>}</section><div className="context-footnote">Обновлено {dateLabel(ticket.updatedAt)}</div>
        </aside></>
}

