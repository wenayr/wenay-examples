import {Overlay} from 'wenay-react2/ui'
import {Assistant} from './assistant'
import React, {useEffect, useRef, useState} from 'react'
import type {CrmWorkspace} from '../backend/domain'
import type {tStage} from '../backend/model'
import {
    stages, money, date,
    type Commands, type Organization, type DealRow, type Remote, type Detail, type Resources
} from './contracts'

type FormProps = {
    row?: DealRow,
    value: CrmWorkspace,
    org: Organization,
    commands: Commands,
    busy: boolean,
    onClose: () => void
}

export function DealForm({row, value, org, commands, busy, onClose}: FormProps) {
    const companies = value.companies.filter(item => item.orgId == org.id && !item.archived)
    const [companyId, setCompanyId] = useState(row?.companyId ?? companies[0]?.id ?? '')
    const people = value.people.filter(item => item.orgId == org.id)
    const manager = org.role == 'owner' || org.role == 'lead'
    const contacts = value.contacts.filter(function pickable(item) {
        return item.orgId == org.id && item.companyId == companyId && !item.archived
    })
    // Менеджер ведёт только свои сделки, руководитель назначает любого сотрудника.
    const assignable = people.filter(function staff(item) {
        if (item.role == 'customer') return false
        return manager || item.account == value.me?.account
    })

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const saved = await commands.run('dealSave', {
            orgId: org.id,
            id: row?.id ?? '',
            revision: row?.revision ?? 0,
            title: String(form.get('title')),
            description: String(form.get('description')),
            companyId,
            contactId: String(form.get('contactId')),
            assignee: String(form.get('assignee')),
            customerAccount: String(form.get('customerAccount')),
            amount: Math.round(Number(form.get('amount')) * 100)
        })
        if (saved) onClose()
    }

    return <form onSubmit={save}>
        <header className="form-title">
            <h2>{row ? 'Изменить сделку' : 'Новая возможность'}</h2>
            <button type="button" aria-label="Закрыть форму сделки" onClick={onClose}>×</button>
        </header>
        <fieldset disabled={busy}>
            <label>Название
                <input name="title" required maxLength={180} defaultValue={row?.title}/>
            </label>
            <label>Контекст
                <textarea name="description" rows={3} maxLength={3000} defaultValue={row?.description}/>
            </label>
            <div className="form-row">
                <label>Компания
                    <select
                        value={companyId}
                        onChange={event => setCompanyId(event.target.value)}
                        required
                    >
                        {companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                </label>
                <label>Контакт
                    <select
                        key={companyId}
                        name="contactId"
                        defaultValue={row?.companyId == companyId ? row.contactId : undefined}
                        required
                    >
                        {contacts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                </label>
            </div>
            <div className="form-row">
                <label>Ответственный
                    <select name="assignee" defaultValue={row?.assignee ?? value.me?.account}>
                        {assignable.map(item => (
                            <option key={item.account} value={item.account}>{item.name}</option>
                        ))}
                    </select>
                </label>
                <label>Стоимость, у. е.
                    <input
                        type="number"
                        name="amount"
                        min="0"
                        max="1000000"
                        step="0.01"
                        defaultValue={(row?.amount ?? 0) / 100}
                        required
                    />
                </label>
            </div>
            <label>Аккаунт клиента
                <select name="customerAccount" defaultValue={row?.customerAccount ?? ''}>
                    <option value="">Без клиентского кабинета</option>
                    {people.filter(item => item.role == 'customer').map(item => (
                        <option key={item.account} value={item.account}>{item.name}</option>
                    ))}
                </select>
            </label>
            <small>Клиент увидит опубликованные предложения и общие сообщения этой сделки.</small>
            <div className="actions">
                <button className="primary">Сохранить сделку</button>
                <button type="button" onClick={onClose}>Отмена</button>
            </div>
        </fieldset>
    </form>
}

type PanelProps = {
    row: DealRow,
    value: CrmWorkspace,
    org: Organization,
    remote: Remote | null,
    resources: Resources,
    commands: Commands,
    busy: boolean,
    close: () => void
}

export function DealPanel({row, value, org, remote, resources, commands, busy, close}: PanelProps) {
    const key = row.id + ':' + row.revision + ':' + org.role
    const [loaded, setLoaded] = useState<{key: string, remote: Remote, data: Detail} | null>(null)
    const [error, setError] = useState('')
    const [editing, setEditing] = useState<DealRow | null>(null)
    const [notice, setNotice] = useState('')
    const current = useRef({key, remote})
    current.current = {key, remote}

    useEffect(function load() {
        let active = true
        setError('')
        if (!remote) return
        void remote.control.detail({orgId: org.id, id: row.id}).then(function ready(data) {
            if (!active || current.current.key != key || current.current.remote != remote) return
            setLoaded({key, remote, data})
        }, function failed(reason) {
            if (active) setError(reason instanceof Error ? reason.message : 'Карточка недоступна')
        })
        return () => {active = false}
    }, [key, remote, org.id, row.id])

    const data = loaded?.key == key && loaded.remote == remote ? loaded.data : null
    const staff = org.role != 'customer'
    const own = org.role != 'manager' || row.assignee == value.me?.account
    const editable = staff && !row.archived && own
    const reference = {orgId: org.id, id: row.id, revision: row.revision}

    async function interaction(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const element = event.currentTarget
        const form = new FormData(element)
        const added = await commands.run('interactionAdd', {
            ...reference,
            body: String(form.get('body')),
            private: staff && form.get('private') == 'on'
        })
        if (added) element.reset()
    }
    async function proposal(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await commands.run('proposalSave', {
            ...reference,
            title: String(form.get('title')),
            body: String(form.get('body')),
            amount: Math.round(Number(form.get('amount')) * 100)
        })
    }
    async function respond(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const answered = await commands.run('proposalRespond', {
            ...reference,
            version: data!.deal.proposals.at(-1)!.version,
            decision: String(form.get('decision')) as 'accept' | 'changes',
            body: String(form.get('body'))
        })
        if (answered) setNotice('Решение сохранено. Команда получила ваш ответ.')
    }
    async function createTask() {
        const created = await commands.run('taskFromDeal', reference)
        if (created) setNotice('Задача доступна на доске команды. Повтор не создаёт дубликат.')
    }
    function archive(archived: boolean) {
        void commands.run('archiveRecord', {
            orgId: org.id,
            kind: 'deal',
            id: row.id,
            revision: row.revision,
            archived
        })
    }
    function moveStage(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        void commands.run('dealMove', {
            ...reference,
            stage: String(form.get('stage')) as tStage,
            beforeId: '',
            reason: String(form.get('reason'))
        })
    }

    const stageForm = <form className="stage-form" key={'stage-' + row.revision} onSubmit={moveStage}>
        <label>Следующий этап
            <select name="stage" defaultValue={row.stage}>
                {Object.entries(stages).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                ))}
            </select>
        </label>
        <label>Причина закрытия
            <input name="reason" placeholder="Для закрытия без сделки" maxLength={1000}/>
        </label>
        <button disabled={busy}>Обновить этап</button>
    </form>

    const sourceKey = JSON.stringify([
        value.companies.find(item => item.id == row.companyId)?.revision,
        value.contacts.find(item => item.id == row.contactId)?.revision
    ])

    const proposals = data && <section className="detail-section">
        <h2>Предложение <span>{data.deal.proposals.length}</span></h2>
        {data.deal.proposals.length ? data.deal.proposals.slice().reverse().map(item => (
            <article className="proposal" key={item.version}>
                <header>
                    <span>ВЕРСИЯ {item.version}</span>
                    <small>{date(item.publishedAt)}</small>
                </header>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <strong>{money(item.amount)}</strong>
                {data.deal.decisions.filter(value => value.version == item.version).map(decision => (
                    <div className={'decision ' + decision.decision} key={decision.version + ':' + decision.at}>
                        <b>
                            {decision.decision == 'accept'
                                ? '✓ Клиент принял предложение'
                                : 'Клиент просит изменения'}
                        </b>
                        <p>{decision.body}</p>
                    </div>
                ))}
            </article>
        )) : <p className="muted">Опубликованных предложений пока нет.</p>}
    </section>

    const latest = data?.deal.proposals.at(-1)
    const answered = data?.deal.decisions.some(item => item.version == latest?.version)
    const awaiting = !staff && !row.archived && !!latest && !answered

    const responseForm = <form onSubmit={respond} className="response-form">
        <h3>Ваше решение по версии {latest?.version}</h3>
        <label>Решение
            <select name="decision">
                <option value="accept">Принимаю предложение</option>
                <option value="changes">Нужны изменения</option>
            </select>
        </label>
        <label>Комментарий
            <textarea
                name="body"
                maxLength={3000}
                required
                placeholder="Подтвердите договорённости или опишите изменения"
            />
        </label>
        <button className="primary" disabled={busy}>Отправить решение</button>
    </form>

    const draftEditor = data && <details className="proposal-editor" open={!data.deal.proposals.length}>
        <summary>Черновик следующего предложения</summary>
        <p className="muted">
            Клиент увидит только опубликованную версию. Сначала сохраните и проверьте черновик.
        </p>
        <form key={'proposal-' + row.revision} onSubmit={proposal}>
            <label>Заголовок
                <input
                    name="title"
                    defaultValue={data.deal.draft?.title ?? row.title}
                    required
                    maxLength={180}
                />
            </label>
            <label>Условия и результат
                <textarea
                    name="body"
                    rows={4}
                    defaultValue={data.deal.draft?.body ?? ''}
                    required
                    maxLength={6000}
                />
            </label>
            <label>Стоимость, у. е.
                <input
                    name="amount"
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    defaultValue={(data.deal.draft?.amount ?? row.amount) / 100}
                    required
                />
            </label>
            <button disabled={busy}>Сохранить черновик</button>
        </form>
        {data.deal.draft && <div className="publish-block">
            <strong>{data.deal.draft.title} · {money(data.deal.draft.amount)}</strong>
            <p>{data.deal.draft.body}</p>
            <button
                className="primary"
                disabled={busy}
                onClick={() => void commands.run('proposalPublish', reference)}
            >
                Опубликовать клиенту
            </button>
        </div>}
    </details>

    const history = data && <section className="detail-section">
        <h2>История общения <span>{data.deal.interactions.length}</span></h2>
        <div className="interactions">
            {data.deal.interactions.map(function message(item) {
                const author = value.people.find(person => person.account == item.author)
                return <article className={item.private ? 'private' : ''} key={item.id}>
                    <header>
                        <strong>{author?.name.split(' · ')[0] ?? item.author}</strong>
                        <small>{date(item.at)} {item.private ? '· только команде' : ''}</small>
                    </header>
                    <p>{item.body}</p>
                </article>
            })}
        </div>
        {!row.archived && <form key={'message-' + row.revision} onSubmit={interaction}>
            <label>Добавить сообщение
                <textarea
                    name="body"
                    rows={3}
                    required
                    maxLength={6000}
                    placeholder="Что обсудили и о чём договорились?"
                />
            </label>
            {staff && <label className="inline">
                <input type="checkbox" name="private" defaultChecked/>
                Только команде
            </label>}
            <button className="primary" disabled={busy}>Сохранить сообщение</button>
        </form>}
    </section>

    const body = data && <>
        <div className="contact-strip">
            <span>◉</span>
            <div>
                <strong>{data.company?.name ?? 'Компания недоступна'}</strong>
                <p>{data.contact?.name} {data.contact?.email && '· ' + data.contact.email}</p>
            </div>
        </div>
        {staff && !row.archived && (
            <Assistant resources={resources} row={row} busy={busy} sourceKey={sourceKey}/>
        )}
        {proposals}
        {awaiting && responseForm}
        {editable && draftEditor}
        {history}
    </>

    let content: React.ReactNode = <p className="empty">Проверяем доступ и загружаем свежую карточку…</p>
    if (error) content = <p className="error-inline" role="alert">{error}</p>
    else if (data) content = body

    return <Overlay
        scrimClassName="drawer-backdrop"
        outsideClassName="deal-panel"
        ariaLabel={'Карточка: ' + row.title}
        onEscape={close}
    >
        <header className="drawer-header">
            <span className="eyebrow">
                {row.archived ? 'АРХИВ СДЕЛКИ' : 'ОБЩИЙ КОНТЕКСТ'} · v{row.revision}
            </span>
            <button aria-label="Закрыть карточку" onClick={close}>×</button>
        </header>
        <h1>{row.title}</h1>
        <div className="deal-summary">
            <strong>{money(row.amount)}</strong>
            <span className={'stage-pill ' + row.stage}>{stages[row.stage]}</span>
        </div>
        <p>{row.description}</p>
        {editable && <div className="actions">
            <button onClick={() => setEditing({...row})}>Изменить сделку</button>
            <button disabled={busy} onClick={() => void createTask()}>Создать задачу</button>
            <button disabled={busy} onClick={() => archive(true)}>В архив</button>
        </div>}
        {staff && row.archived && (
            <button disabled={busy} onClick={() => archive(false)}>Вернуть из архива</button>
        )}
        {notice && <p className="success" role="status">{notice}</p>}
        {editing && <section className="edit-block">
            <DealForm
                row={editing}
                value={value}
                org={org}
                commands={commands}
                busy={busy}
                onClose={() => setEditing(null)}
            />
        </section>}
        {editable && stageForm}
        {content}
    </Overlay>
}
