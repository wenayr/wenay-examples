import React, {useState} from 'react'
import type {SupportWorkspace} from '../backend/domain'
import type {Article, tRole} from '../backend/model'
import {articleLabels, Avatar, dateLabel, roleLabels, type CommandController} from './contracts'
import {useServiceAction} from '../shared/react/service-action'

type Organization = SupportWorkspace['organizations'][number]
type Props = {value: SupportWorkspace, org: Organization, commands: CommandController, busy: boolean}

export function Knowledge({value, org, commands, busy}: Props) {
    const [query, setQuery] = useState('')
    const [selected, setSelected] = useState('')
    const [creating, setCreating] = useState(false)
    const staff = org.role != 'customer'
    const needle = query.toLocaleLowerCase('ru')
    const articles = value.articles.filter(function matching(item) {
        if (item.orgId != org.id) return false
        return (item.title + ' ' + item.body).toLocaleLowerCase('ru').includes(needle)
    })
    const article = articles.find(item => item.id == selected) ?? articles[0]

    function selectArticle(id: string) {
        setSelected(id)
        setCreating(false)
    }

    const list = <div className="article-grid">
        {articles.map(item => (
            <button
                className={'article-card' + (article?.id == item.id && !creating ? ' active' : '')}
                key={item.id}
                onClick={() => selectArticle(item.id)}
            >
                <div>
                    <span className="article-symbol">▤</span>
                    <span className={'article-status ' + item.status}>{articleLabels[item.status]}</span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <footer>Обновлено {dateLabel(item.updatedAt)}<span>→</span></footer>
            </button>
        ))}
        {!articles.length && <div className="empty-state">
            <h2>{query ? 'Статьи не найдены' : 'Статей пока нет'}</h2>
            <p>
                {query
                    ? 'Измените поисковый запрос.'
                    : 'Здесь появятся инструкции и ответы на частые вопросы.'}
            </p>
        </div>}
    </div>

    const reader = article && <article className="article-reader">
        <p className="eyebrow">ИНСТРУКЦИЯ</p>
        <h2>{article.title}</h2>
        <p>{article.body}</p>
        <small>Обновлено {dateLabel(article.updatedAt)}</small>
    </article>

    let detail: React.ReactNode = null
    if (creating || article) {
        detail = staff ? <ArticleEditor
            key={creating ? 'new' : article.id}
            article={creating ? undefined : article}
            org={org}
            commands={commands}
            busy={busy}
            onSaved={selectArticle}
        /> : reader
    }

    return <section className="page-content">
        <div className="section-heading">
            <div>
                <p className="eyebrow">ИНСТРУКЦИИ И ОТВЕТЫ</p>
                <h1>База знаний</h1>
                <p>Находите инструкции, публикуйте ответы и используйте их в обращениях.</p>
            </div>
            {staff && (
                <button className="primary" disabled={busy} onClick={() => setCreating(!creating)}>
                    {creating ? 'Закрыть редактор' : '+ Новая статья'}
                </button>
            )}
        </div>
        <label className="search-field knowledge-search">
            <span aria-hidden="true">⌕</span>
            <input
                aria-label="Поиск в базе знаний"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Найти решение…"
            />
        </label>
        <div className="knowledge-layout">
            {list}
            {detail}
        </div>
    </section>
}

type EditorProps = {
    article?: Article,
    org: Organization,
    commands: CommandController,
    busy: boolean,
    onSaved: (id: string) => void
}

function ArticleEditor({article, org, commands, busy, onSaved}: EditorProps) {
    const [title, setTitle] = useState(article?.title ?? '')
    const [body, setBody] = useState(article?.body ?? '')
    const [revision, setRevision] = useState(article?.revision ?? 0)
    const [notice, setNotice] = useState('')
    const importing = useServiceAction(article?.id)
    const dirty = title != article?.title || body != article?.body
    const manage = org.role == 'owner' || org.role == 'lead'
    const stale = article && article.revision != revision

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        try {
            const result = await commands.execute('articleSave', {
                orgId: org.id,
                id: article?.id ?? '',
                revision,
                title,
                body
            })
            if (result && 'id' in result && 'revision' in result) {
                setRevision(result.revision)
                onSaved(result.id)
                setNotice('Изменения сохранены')
            }
        } catch {}
    }

    async function importText(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        await importing.action(async function readText() {
            if (file.size > 30000) throw new Error('Для статьи выберите текстовый файл не больше 30 КБ.')
            const text = await file.text()
            if (text.length > 24000) throw new Error('В статье может быть не больше 24 000 символов.')
            if (text.includes('\0')) throw new Error('Этот файл не похож на текст. Выберите TXT или Markdown.')
            setBody(text)
            if (!title) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, '').slice(0, 180))
            setNotice('Текст загружен в редактор. Проверьте и сохраните статью.')
        })
    }

    async function publish(status: Article['status']) {
        if (!article) return
        const changed = await commands.run('articlePublish', {
            orgId: org.id,
            id: article.id,
            revision: article.revision,
            status
        })
        if (changed) {
            setRevision(article.revision + 1)
            setNotice(status == 'published' ? 'Статья доступна клиентам' : 'Статус статьи изменён')
        }
    }

    function reload() {
        if (!article) return
        setTitle(article.title)
        setBody(article.body)
        setRevision(article.revision)
    }

    async function restore(version: number) {
        if (!article) return
        try {
            const result = await commands.execute('articleRestore', {
                orgId: org.id,
                id: article.id,
                revision: article.revision,
                version
            })
            const previous = article.history?.find(item => item.revision == version)
            if (result && 'revision' in result && previous) {
                setTitle(previous.title)
                setBody(previous.body)
                setRevision(result.revision)
                setNotice('Версия восстановлена в черновик. Проверьте перед публикацией.')
            }
        } catch {}
    }

    const locked = busy || dirty || !!stale

    const publishing = article && manage && <div className="publish-actions">
        <p>Опубликуйте проверенный ответ для клиентов.</p>
        {article.status != 'published' && (
            <button type="button" disabled={locked} onClick={() => publish('published')}>
                Опубликовать
            </button>
        )}
        {article.status == 'published' && (
            <button type="button" disabled={locked} onClick={() => publish('draft')}>
                Снять с публикации
            </button>
        )}
        {article.status != 'archived' && (
            <button type="button" disabled={locked} onClick={() => publish('archived')}>
                В архив
            </button>
        )}
    </div>

    const history = article && !!article.history?.length && <details className="article-history">
        <summary>История · {article.history.length} версий</summary>
        {article.history.slice().reverse().map(version => (
            <div key={version.revision}>
                <strong>Версия {version.revision} · {articleLabels[version.status]}</strong>
                <small>{version.title} · {dateLabel(version.updatedAt)}</small>
                {manage && (
                    <button type="button" disabled={locked} onClick={() => restore(version.revision)}>
                        Восстановить в черновик
                    </button>
                )}
            </div>
        ))}
    </details>

    return <form className="article-editor panel-form" onSubmit={save}>
        <div className="form-heading">
            <h2>{article ? 'Редактор статьи' : 'Новая статья'}</h2>
            <p>{article ? articleLabels[article.status] : 'Начните с частого вопроса клиента.'}</p>
        </div>
        {stale && <div className="inline-warning" role="status">
            Статья обновилась. Ваш текст сохранён в редакторе.
            <button type="button" onClick={reload}>Загрузить актуальную версию</button>
        </div>}
        <label className="text-import">Импортировать TXT или Markdown
            <input
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                disabled={busy || importing.busy}
                onChange={importText}
            />
            <small>До 30 КБ. Текст появится в редакторе до сохранения.</small>
        </label>
        {importing.error && <p className="inline-warning" role="alert">{importing.error}</p>}
        <label>Заголовок
            <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                maxLength={180}
                required
            />
        </label>
        <label>Текст статьи
            <textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                rows={13}
                maxLength={24000}
                required
            />
        </label>
        <small className="muted">
            Сохранение опубликованной статьи возвращает её на проверку в черновики.
        </small>
        <div className="form-actions">
            <span role="status" className="muted">{notice}</span>
            <button className="primary" disabled={busy || !!stale || (!!article && !dirty)}>
                {busy ? 'Сохраняем…' : 'Сохранить черновик'}
            </button>
        </div>
        {publishing}
        {history}
    </form>
}

export function Team({value, org, commands, busy}: Omit<Props, 'org'> & {org?: Organization}) {
    const [invitation, setInvitation] = useState('')
    const [notice, setNotice] = useState('')
    const owner = org?.role == 'owner'
    const manage = owner || org?.role == 'lead'
    const people = value.people.filter(person => person.orgId == org?.id)
    const invites = value.invites.filter(invite => invite.orgId == org?.id)

    async function createOrg(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        if (await commands.run('orgCreate', {name: String(new FormData(form).get('name'))})) {
            form.reset()
            setNotice('Организация создана. Выберите её в меню слева.')
        }
    }

    async function acceptInvite(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        if (await commands.run('inviteAccept', {token: String(new FormData(form).get('token')).trim()})) {
            form.reset()
            setNotice('Приглашение принято. Организация доступна в меню слева.')
        }
    }

    async function createInvite(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!org) return
        const form = new FormData(event.currentTarget)
        try {
            const result = await commands.execute('inviteCreate', {
                orgId: org.id,
                role: String(form.get('role')) as 'lead' | 'agent' | 'customer',
                hours: Number(form.get('hours'))
            })
            if (result && 'token' in result) setInvitation(result.token)
        } catch {}
    }

    async function setRole(account: string, role: tRole | 'revoked') {
        if (org) await commands.run('memberRole', {orgId: org.id, account, role})
    }

    function openTickets(account: string) {
        return value.tickets.filter(function assigned(ticket) {
            if (ticket.orgId != org!.id || ticket.assignee != account) return false
            return ticket.status != 'resolved'
        }).length
    }

    const table = org && <div className="team-table table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Участник</th>
                    <th>Роль</th>
                    <th>Открытые обращения</th>
                </tr>
            </thead>
            <tbody>
                {people.map(person => (
                    <tr key={person.account}>
                        <td>
                            <div className="person-cell">
                                <Avatar name={person.name}/>
                                <div>
                                    <strong>{person.name.split(' · ')[0]}</strong>
                                    <small>
                                        {person.account}
                                        {person.account == value.account.account ? ' · это вы' : ''}
                                    </small>
                                </div>
                            </div>
                        </td>
                        <td>
                            {owner ? <select
                                aria-label={'Роль ' + person.account}
                                value={person.role}
                                disabled={busy}
                                onChange={event => setRole(person.account, event.target.value as tRole | 'revoked')}
                            >
                                {Object.entries(roleLabels).map(([id, title]) => (
                                    <option value={id} key={id}>{title}</option>
                                ))}
                            </select> : <span className="soft-badge">{roleLabels[person.role]}</span>}
                        </td>
                        <td><span className="workload-count">{openTickets(person.account)}</span></td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>

    const inviteForm = manage && <form className="panel-form" onSubmit={createInvite}>
        <div className="form-heading">
            <span className="form-symbol">↗</span>
            <h2>Пригласить участника</h2>
            <p>Создайте одноразовый код и передайте его коллеге.</p>
        </div>
        <label>Роль
            <select name="role" defaultValue="agent">
                {owner && <option value="lead">Руководитель</option>}
                <option value="agent">Специалист</option>
                <option value="customer">Клиент</option>
            </select>
        </label>
        <label>Срок действия
            <select name="hours" defaultValue="24">
                <option value="1">1 час</option>
                <option value="24">24 часа</option>
                <option value="168">7 дней</option>
            </select>
        </label>
        <button className="primary" disabled={busy}>Создать приглашение</button>
        {invitation && <label className="invitation-result">Код приглашения
            <input readOnly value={invitation} onFocus={event => event.currentTarget.select()}/>
            <small>Скопируйте код. После закрытия страницы он больше не отображается.</small>
        </label>}
    </form>

    function inviteState(invite: SupportWorkspace['invites'][number]) {
        if (invite.usedBy) return 'Принято: ' + invite.usedBy
        if (invite.revoked) return 'Отозвано'
        if (invite.expiresAt <= Date.now()) return 'Срок истёк'
        return 'Действует до ' + dateLabel(invite.expiresAt)
    }

    const inviteList = manage && invites.length > 0 && <section className="invitation-list">
        <h2>Приглашения команды</h2>
        {invites.map(invite => (
            <div key={invite.id}>
                <span className="soft-badge">{roleLabels[invite.role]}</span>
                <span>{inviteState(invite)}</span>
                {!invite.usedBy && !invite.revoked && (
                    <button
                        disabled={busy}
                        onClick={() => commands.run('inviteRevoke', {orgId: org!.id, id: invite.id})}
                    >
                        Отозвать
                    </button>
                )}
            </div>
        ))}
    </section>

    return <section className="page-content">
        <div className="section-heading">
            <div>
                <p className="eyebrow">РАБОТАЕМ ВМЕСТЕ</p>
                <h1>Команда и доступ</h1>
                <p>Приглашайте коллег и выбирайте подходящую роль.</p>
            </div>
            {org && <span className="soft-badge">{people.length} участников</span>}
        </div>
        {notice && <p className="success-notice" role="status">{notice}</p>}
        {table}
        <div className="team-forms">
            {inviteForm}
            <form className="panel-form" onSubmit={acceptInvite}>
                <div className="form-heading">
                    <span className="form-symbol">◈</span>
                    <h2>Есть приглашение?</h2>
                    <p>Присоединитесь к организации по коду от её команды.</p>
                </div>
                <label>Код приглашения
                    <input
                        name="token"
                        required
                        maxLength={300}
                        placeholder="Вставьте полученный код"
                        autoComplete="off"
                    />
                </label>
                <button disabled={busy}>Принять приглашение</button>
            </form>
            <form className="panel-form" onSubmit={createOrg}>
                <div className="form-heading">
                    <span className="form-symbol">✳</span>
                    <h2>Новая организация</h2>
                    <p>Отдельная команда, обращения и база знаний.</p>
                </div>
                <label>Название
                    <input name="name" required maxLength={100} placeholder="Например, Atelier Studio"/>
                </label>
                <button disabled={busy}>Создать организацию</button>
            </form>
        </div>
        {inviteList}
    </section>
}

const actionLabels: Record<string, string> = {
    'org.create': 'Создана организация',
    'invite.create': 'Создано приглашение',
    'invite.accept': 'Принято приглашение',
    'invite.revoke': 'Отозвано приглашение',
    'ticket.create': 'Создано обращение',
    'ticket.assign': 'Назначен специалист',
    'ticket.reply': 'Добавлено сообщение',
    'ticket.note': 'Добавлена заметка команде',
    'ticket.open': 'Открыто обращение',
    'ticket.waiting': 'Обращение ожидает ответа',
    'ticket.resolved': 'Обращение решено',
    'ticket.due': 'Изменён срок ответа',
    'article.save': 'Сохранена статья',
    'article.published': 'Опубликована статья',
    'article.draft': 'Статья возвращена в черновик',
    'article.archived': 'Статья перенесена в архив'
}

function actionLabel(action: string) {
    if (action.startsWith('member.')) {
        const role = action.slice(7)
        return 'Изменена роль: ' + (roleLabels[role as keyof typeof roleLabels] ?? role)
    }
    if (action.startsWith('article.restore.')) {
        return 'Восстановлена версия статьи ' + action.slice(16)
    }
    return actionLabels[action] ?? action
}

export function Audit({value, orgId}: {value: SupportWorkspace, orgId: string}) {
    const entries = value.audit.filter(item => item.orgId == orgId).slice().reverse()
    function actorName(account: string) {
        const person = value.people.find(function same(item) {
            return item.account == account && item.orgId == orgId
        })
        return person?.name.split(' · ')[0] ?? account
    }

    const list = <div className="audit-list">
        {entries.map(entry => (
            <article key={entry.id}>
                <div className="audit-dot"/>
                <div>
                    <h2>{actionLabel(entry.action)}</h2>
                    <p>
                        <strong>{actorName(entry.actor)}</strong>
                        <span> · {entry.target}</span>
                    </p>
                </div>
                <time dateTime={new Date(entry.at).toISOString()}>{dateLabel(entry.at)}</time>
            </article>
        ))}
    </div>

    const empty = <div className="empty-state audit-empty">
        <span>◷</span>
        <h2>Действий пока нет</h2>
        <p>Создайте обращение или измените статью — действие появится здесь.</p>
    </div>

    return <section className="page-content">
        <div className="section-heading">
            <div>
                <p className="eyebrow">ПОНЯТНАЯ ИСТОРИЯ</p>
                <h1>Действия команды</h1>
                <p>Кто и когда изменил обращения, знания и доступ.</p>
            </div>
            <span className="soft-badge">{entries.length} событий</span>
        </div>
        {entries.length ? list : empty}
    </section>
}
