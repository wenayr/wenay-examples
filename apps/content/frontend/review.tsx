import React, {useRef, useState} from 'react'
import {Overlay} from 'wenay-react2/ui'
import type {Page} from '../backend/model'
import {Article} from './article'
import {date, publicUrl, type Resources, type Commands, type Organization} from './contracts'

const scheduleStates = {
    pending: 'Ожидает выпуска',
    cancelled: 'Отменён',
    published: 'Опубликован',
    failed: 'Не выполнен'
}

type Confirmation = {
    kind: 'publish' | 'rollback' | 'withdraw',
    version: number,
    revision: number,
    key: string
}

type DeskProps = {page: Page, org: Organization, resources: Resources, commands: Commands}

function reviewState(decision: string | undefined) {
    if (decision == 'approved') return 'Согласовано'
    return decision == 'changes' ? 'Нужны правки' : 'На проверке'
}

function publicationKind(kind: string) {
    if (kind == 'rollback') return 'Возврат версии'
    return kind == 'scheduled' ? 'По расписанию' : 'Опубликовано'
}

export function ReviewDesk({page, org, resources, commands}: DeskProps) {
    const [version, setVersion] = useState(0)
    const [comment, setComment] = useState('')
    const [blockId, setBlockId] = useState('')
    const [decisionBody, setDecisionBody] = useState('')
    const [due, setDue] = useState('')
    const [confirm, setConfirm] = useState<Confirmation | null>(null)
    const scheduleIntent = useRef<{signature: string, key: string} | null>(null)

    const snapshot = page.snapshots.find(value => value.version == version) ?? page.snapshots.at(-1)
    const review = page.reviews.filter(item => item.version == snapshot?.version).at(-1)
    const reviewer = ['owner', 'editor'].includes(org.role)
    const publisher = ['owner', 'publisher'].includes(org.role)
    // Решение относится к снимку: если черновик ушёл вперёд, снимок остаётся историей.
    const current = snapshot?.draftRevision == page.draftRevision
    const approved = review?.decision == 'approved'

    async function note(event: React.FormEvent) {
        event.preventDefault()
        if (!snapshot) return
        const added = await commands.run('commentAdd', {
            orgId: org.id,
            id: page.id,
            version: snapshot.version,
            blockId,
            body: comment
        })
        if (!added) return
        setComment('')
        setBlockId('')
    }
    async function schedule(event: React.FormEvent) {
        event.preventDefault()
        if (!snapshot) return
        const dueAt = new Date(due).getTime()
        const signature = JSON.stringify([page.revision, snapshot.version, dueAt])
        const repeat = scheduleIntent.current?.signature == signature
        const key = repeat ? scheduleIntent.current!.key : crypto.randomUUID()
        scheduleIntent.current = {signature, key}
        const planned = await commands.run('scheduleCreate', {
            orgId: org.id,
            id: page.id,
            revision: page.revision,
            version: snapshot.version,
            key,
            dueAt
        })
        if (!planned) return
        setDue('')
        scheduleIntent.current = null
    }
    async function publish() {
        if (!confirm) return
        const input = {orgId: org.id, id: page.id, revision: confirm.revision, key: confirm.key}
        let ok = false
        if (confirm.kind == 'withdraw') ok = await commands.run('pageWithdraw', input)
        else if (confirm.kind == 'rollback') {
            ok = await commands.run('pageRollback', {...input, version: confirm.version})
        } else ok = await commands.run('pagePublish', {...input, version: confirm.version})
        if (ok) setConfirm(null)
    }
    function decide(decision: 'approved' | 'changes') {
        void commands.run('reviewDecide', {
            orgId: org.id,
            id: page.id,
            revision: page.revision,
            version: snapshot!.version,
            decision,
            body: decisionBody
        })
    }
    function ask(kind: Confirmation['kind'], target: number) {
        setConfirm({kind, version: target, revision: page.revision, key: crypto.randomUUID()})
    }

    const publishedSnapshot = page.snapshots.find(value => value.version == page.publishedVersion)

    const heading = <header className="page-heading">
        <div>
            <p className="eyebrow">ОТ ЧЕРНОВИКА К ЧИТАТЕЛЮ</p>
            <h1>Редакционный стол</h1>
            <p>
                Согласовываем конкретную версию.
                Публичный текст меняется только после решения издателя.
            </p>
        </div>
        {page.publishedVersion > 0 && <a
            className="button"
            href={publicUrl(org.id, publishedSnapshot!.slug)}
            target="_blank"
            rel="noreferrer"
        >
            Посмотреть публикацию ↗
        </a>}
    </header>

    if (!snapshot) {
        return <>
            {heading}
            <section className="empty">
                <h2>Материал ещё в работе</h2>
                <p>Автору нужно сохранить черновик и отправить его на проверку.</p>
            </section>
        </>
    }

    const comments = <section className="panel">
        <h2>Замечания к версии {snapshot.version}</h2>
        {page.comments.filter(item => item.version == snapshot.version).map(item => (
            <article className="comment" key={item.id}>
                <header>
                    <strong>{item.author}</strong>
                    <small>{date(item.at)}</small>
                </header>
                <p>{item.body}</p>
                {item.blockId && <small>
                    К блоку: {snapshot.blocks.find(block => block.id == item.blockId)?.text.slice(0, 80)}
                </small>}
            </article>
        ))}
        <form onSubmit={note}>
            <label>К чему относится
                <select value={blockId} onChange={event => setBlockId(event.target.value)}>
                    <option value="">Весь материал</option>
                    {snapshot.blocks.map((block, index) => (
                        <option key={block.id} value={block.id}>
                            {index + 1}. {block.text.slice(0, 60)}
                        </option>
                    ))}
                </select>
            </label>
            <label>Ваше замечание
                <textarea
                    value={comment}
                    onChange={event => setComment(event.target.value)}
                    rows={3}
                    required
                    maxLength={2000}
                />
            </label>
            <button disabled={commands.busy}>Добавить замечание</button>
        </form>
    </section>

    const decisions = reviewer && <section className="panel">
        <h2>Решение редактора</h2>
        <label>Пояснение
            <textarea
                value={decisionBody}
                onChange={event => setDecisionBody(event.target.value)}
                rows={2}
                maxLength={2000}
            />
        </label>
        <div className="actions">
            <button className="primary" disabled={!current || commands.busy} onClick={() => decide('approved')}>
                Согласовать версию
            </button>
            <button disabled={!current || commands.busy} onClick={() => decide('changes')}>
                Вернуть на доработку
            </button>
        </div>
    </section>

    const republished = page.publications.some(value => value.version == snapshot.version)

    const release = publisher && <section className="panel publish-panel">
        <h2>Выпуск материала</h2>
        <p>Читатель увидит снимок версии {snapshot.version}.</p>
        <button
            className="primary"
            disabled={!current || !approved || commands.busy}
            onClick={() => ask('publish', snapshot.version)}
        >
            Опубликовать сейчас
        </button>
        <form onSubmit={schedule}>
            <label>Или запланировать выпуск
                <input
                    type="datetime-local"
                    value={due}
                    required
                    onChange={event => setDue(event.target.value)}
                />
                <small>
                    Часовой пояс компьютера: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </small>
            </label>
            <button disabled={!current || !approved || commands.busy}>Запланировать</button>
        </form>
        {republished && snapshot.version != page.publishedVersion && (
            <button disabled={commands.busy} onClick={() => ask('rollback', snapshot.version)}>
                Вернуть эту публикацию
            </button>
        )}
        {page.publishedVersion > 0 && (
            <button
                className="danger"
                disabled={commands.busy}
                onClick={() => ask('withdraw', page.publishedVersion)}
            >
                Снять с публикации
            </button>
        )}
    </section>

    const schedules = <section className="panel">
        <h2>Расписание выпуска</h2>
        {page.schedules.length ? page.schedules.slice().reverse().map(item => (
            <article className="timeline" key={item.id}>
                <strong>v{item.version} · {date(item.dueAt)}</strong>
                <span>{scheduleStates[item.status]}</span>
                {item.reason && <small>{item.reason}</small>}
                {publisher && item.status == 'pending' && <button
                    disabled={commands.busy}
                    onClick={() => void commands.run('scheduleCancel', {
                        orgId: org.id,
                        id: page.id,
                        revision: page.revision,
                        scheduleId: item.id
                    })}
                >
                    Отменить выпуск
                </button>}
            </article>
        )) : <p>Запланированных выпусков нет.</p>}
    </section>

    const history = <section className="panel">
        <h2>История публикаций</h2>
        {page.publications.length ? page.publications.slice().reverse().map(item => (
            <article className="timeline" key={item.id}>
                <strong>Версия {item.version}</strong>
                <span>{date(item.at)} · {item.actor}</span>
                <small>{publicationKind(item.kind)}</small>
            </article>
        )) : <p>Материал ещё не выходил.</p>}
    </section>

    let confirmTitle = 'Выпустить материал?'
    if (confirm?.kind == 'withdraw') confirmTitle = 'Снять материал с публикации?'
    else if (confirm?.kind == 'rollback') confirmTitle = 'Вернуть прежнюю версию?'

    const withdrawText = 'Публичная страница перестанет открываться.'
        + ' Черновик и история останутся в редакции.'
    const releaseText = 'Читатели увидят согласованный снимок версии '
        + confirm?.version + '. Черновик не изменится.'

    const dialog = confirm && <Overlay
        ariaLabel="Подтверждение выпуска"
        scrimClassName="scrim"
        outsideClassName="modal"
        onEscape={() => setConfirm(null)}
    >
        <button className="close" aria-label="Закрыть подтверждение" onClick={() => setConfirm(null)}>
            ×
        </button>
        <p className="eyebrow">РЕШЕНИЕ ИЗДАТЕЛЯ</p>
        <h2>{confirmTitle}</h2>
        <p>{confirm.kind == 'withdraw' ? withdrawText : releaseText}</p>
        <button className="primary" disabled={commands.busy} onClick={() => void publish()}>
            {confirm.kind == 'withdraw' ? 'Да, снять публикацию' : 'Да, выпустить версию ' + confirm.version}
        </button>
    </Overlay>

    function chooseSnapshot(event: React.ChangeEvent<HTMLSelectElement>) {
        setVersion(Number(event.target.value))
        setBlockId('')
    }

    return <>
        {heading}
        <div className="review-layout">
            <section className="review-paper">
                <header>
                    <label>Снимок материала
                        <select value={snapshot.version} onChange={chooseSnapshot}>
                            {page.snapshots.map(value => (
                                <option key={value.version} value={value.version}>
                                    Версия {value.version} · {date(value.createdAt)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span className={'status ' + (review?.decision ?? 'review')}>
                        {reviewState(review?.decision)}
                    </span>
                </header>
                {!current && (
                    <p className="notice">Черновик уже изменён. Этот снимок сохранён для истории.</p>
                )}
                <Article
                    title={snapshot.title}
                    blocks={snapshot.blocks}
                    orgId={org.id}
                    resources={resources}
                />
            </section>
            <aside className="review-sidebar">
                {comments}
                {decisions}
                {release}
                {schedules}
                {history}
            </aside>
        </div>
        {dialog}
    </>
}
