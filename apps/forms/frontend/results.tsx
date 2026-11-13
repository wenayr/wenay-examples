import {Grouping} from './grouping'
import React, {useEffect, useRef, useState} from 'react'
import {Overlay} from 'wenay-react2/ui'
import type {AiRunStore} from 'wenay-common2/ai'
import type {FormsWorkspace} from '../backend/domain'
import type {Answers, Submission} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'
import {
    useFormResource, date, download,
    type Resources, type Commands, type Organization, type FormRow, type Detail
} from './contracts'
import {Questions, cleanAnswers} from './questions'

type ResultsProps = {
    resources: Resources,
    commands: Commands,
    org: Organization,
    row: FormRow,
    workspace: FormsWorkspace
}

function answerText(value: Answers[string]) {
    if (typeof value == 'boolean') return value ? 'Да' : 'Нет'
    return String(value)
}

function bucketLabel(value: string) {
    if (value == 'true') return 'Да'
    return value == 'false' ? 'Нет' : value
}

export function Results({resources, commands, org, row, workspace}: ResultsProps) {
    const remote = useFormResource(resources, 'answers')
    const editor = useFormResource(resources, 'editor')
    type Page = Awaited<ReturnType<NonNullable<typeof remote>['control']['list']>>

    const action = useServiceAction(remote)
    const [version, setVersion] = useState(0)
    const [offset, setOffset] = useState(0)
    const [reload, setReload] = useState(0)
    const key = [row.id, row.revision, row.answersRevision, version, offset, reload].join(':')
    const [loaded, setLoaded] = useState<{key: string, remote: typeof remote, page: Page, detail: Detail} | null>(null)
    const [editing, setEditing] = useState<Submission | null>(null)
    const [deleting, setDeleting] = useState<Submission | null>(null)

    useEffect(function loadPage() {
        let active = true
        setLoaded(null)
        setEditing(null)
        setDeleting(null)
        if (!remote || !editor) return
        void action.action(async function read() {
            const [page, detail] = await Promise.all([
                remote.control.list({orgId: org.id, formId: row.id, version, offset, limit: 25}),
                editor.control.detail({orgId: org.id, id: row.id})
            ])
            if (active) setLoaded({key, remote, page, detail})
        })
        return () => {active = false}
    }, [remote, editor, key, org.id])

    const value = loaded?.key == key && loaded.remote == remote ? loaded : null
    const aggregates = workspace.aggregates.filter(function shown(item) {
        return item.formId == row.id && (!version || item.version == version)
    })

    function chooseVersion(event: React.ChangeEvent<HTMLSelectElement>) {
        setVersion(Number(event.target.value))
        setOffset(0)
    }
    async function remove() {
        if (!deleting) return
        const done = await commands.run('answerDelete', {orgId: org.id, formId: row.id, id: deleting.id})
        if (done) setDeleting(null)
    }

    const heading = <header className="results-heading">
        <div>
            <span className="eyebrow">ИСТОРИИ ЗА ЦИФРАМИ</span>
            <h1>{row.title}</h1>
            <p>У каждой публикации свои вопросы и ответы. Черновик не меняет прошлое.</p>
        </div>
        <label>Публикация
            <select value={version} onChange={chooseVersion}>
                <option value={0}>Все версии</option>
                {Array.from({length: row.versions}, (_ignored, index) => (
                    <option key={index} value={index + 1}>Версия {index + 1}</option>
                ))}
            </select>
        </label>
    </header>

    const metrics = <div className="metric-strip">
        <article>
            <strong>{aggregates.reduce((count, item) => count + item.count, 0)}</strong>
            <span>Ответов</span>
        </article>
        <article>
            <strong>{row.versions}</strong>
            <span>Опубликовано версий</span>
        </article>
        <article>
            <strong>{row.retentionDays}</strong>
            <span>Дней для новых ответов</span>
        </article>
    </div>

    const summary = <section className="aggregate-grid">
        {aggregates.map(aggregate => (
            <article className="panel" key={aggregate.version}>
                <span className="chip">Версия {aggregate.version}</span>
                {aggregate.fields.map(field => (
                    <div className="aggregate" key={field.id}>
                        <h3>{field.label}</h3>
                        <small>Ответили {field.answered}</small>
                        {field.average != null && <strong className="average">
                            {field.average.toLocaleString('ru', {maximumFractionDigits: 2})}
                            <small>среднее</small>
                        </strong>}
                        {field.values.map(bucket => (
                            <div className="bar-row" key={bucket.value}>
                                <span>{bucketLabel(bucket.value)}</span>
                                <meter min={0} max={Math.max(1, field.answered)} value={bucket.count}/>
                                <b>{bucket.count}</b>
                            </div>
                        ))}
                    </div>
                ))}
            </article>
        ))}
    </section>

    function entryCard(entry: Submission) {
        const publication = value!.detail.versions.find(item => item.version == entry.version)
        const answered = publication?.fields.filter(field => Object.hasOwn(entry.answers, field.id)) ?? []
        return <article key={entry.id}>
            <header>
                <strong>{date(entry.createdAt)}</strong>
                <span className="chip">v{entry.version}</span>
                <small>Удалится {date(entry.expiresAt)}</small>
            </header>
            <dl>
                {answered.map(field => (
                    <React.Fragment key={field.id}>
                        <dt>{field.label}</dt>
                        <dd>{answerText(entry.answers[field.id])}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {org.role == 'owner' && <div className="actions">
                <button onClick={() => setEditing(entry)}>Исправить ответ</button>
                <button className="danger" onClick={() => setDeleting(entry)}>Удалить ответ</button>
            </div>}
        </article>
    }

    const list = value && <>
        <div className="response-list">{value.page.items.map(entryCard)}</div>
        {!value.page.items.length && (
            <p className="empty">Ответов пока нет. Поделитесь опубликованной формой.</p>
        )}
        <div className="pagination">
            <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>← Назад</button>
            <span>
                {value.page.total ? offset + 1 : 0}–{offset + value.page.items.length}
                {' '}из {value.page.total}
            </span>
            <button disabled={value.page.next == null} onClick={() => setOffset(value.page.next!)}>
                Далее →
            </button>
        </div>
    </>

    const confirmDelete = deleting && <Overlay
        ariaLabel="Удаление ответа"
        scrimClassName="scrim"
        outsideClassName="modal"
        onEscape={() => setDeleting(null)}
    >
        <button className="close" aria-label="Закрыть подтверждение удаления" onClick={() => setDeleting(null)}>
            ×
        </button>
        <h2>Удалить этот ответ?</h2>
        <p>
            Ответ исчезнет из списка и итогов.
            Подготовленные ранее выгрузки станут недоступны. Вернуть ответ нельзя.
        </p>
        <button className="danger" disabled={commands.busy} onClick={() => void remove()}>
            Да, удалить ответ
        </button>
    </Overlay>

    return <>
        {heading}
        {metrics}
        {summary}
        <section className="panel">
            <header>
                <h2>Ответы участников</h2>
                <button disabled={action.busy} onClick={() => setReload(item => item + 1)}>Обновить</button>
            </header>
            {action.error && <p className="error" role="alert">{action.error}</p>}
            {value ? list : <p>Открываем разрешённые ответы…</p>}
        </section>
        {value && <Grouping
            resources={resources}
            org={org}
            row={row}
            detail={value.detail}
            version={version}
            entries={value.page.items}
        />}
        <ExportPanel resources={resources} org={org} row={row} version={version}/>
        {editing && value && <Correction
            entry={editing}
            detail={value.detail}
            commands={commands}
            org={org}
            revision={value.page.answersRevision}
            close={() => setEditing(null)}
        />}
        {confirmDelete}
    </>
}

type CorrectionProps = {
    entry: Submission,
    detail: Detail,
    commands: Commands,
    org: Organization,
    revision: number,
    close: () => void
}

function Correction({entry, detail, commands, org, revision, close}: CorrectionProps) {
    const [answers, setAnswers] = useState<Answers>({...entry.answers})
    const fields = detail.versions.find(value => value.version == entry.version)!.fields

    async function save(event: React.FormEvent) {
        event.preventDefault()
        const done = await commands.run('answerCorrect', {
            orgId: org.id,
            formId: entry.formId,
            id: entry.id,
            answersRevision: revision,
            answersJson: JSON.stringify(cleanAnswers(fields, answers))
        })
        if (done) close()
    }

    return <Overlay
        ariaLabel="Исправление ответа"
        scrimClassName="scrim"
        outsideClassName="modal"
        onEscape={close}
    >
        <button className="close" aria-label="Закрыть исправление" onClick={close}>×</button>
        <h2>Исправить ответ</h2>
        <p>Вопросы из версии {entry.version}. Итоги пересчитаются после сохранения.</p>
        <form onSubmit={save}>
            <Questions fields={fields} answers={answers} change={setAnswers} disabled={commands.busy}/>
            <button className="primary" disabled={commands.busy}>Сохранить исправление</button>
        </form>
    </Overlay>
}

type ExportProps = {resources: Resources, org: Organization, row: FormRow, version: number}

function ExportPanel({resources, org, row, version}: ExportProps) {
    const remote = useFormResource(resources, 'exports')
    const action = useServiceAction(remote)
    const replay = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({
        runs: {}, approvals: {}, inputs: {}
    }))
    const [format, setFormat] = useState<'csv' | 'json'>('csv')

    // Готовый файл относится к состоянию ответов: после правок нужна новая выгрузка.
    const key = row.id + ':' + row.answersRevision
    const current = useRef({remote, key})
    current.current = {remote, key}
    useEffect(() => () => {current.current = {remote: null, key: ''}}, [])

    const mine = Object.values(replay.state?.runs ?? {}).filter(item => item.resourceIds.includes(row.id))
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = run && ['queued', 'running'].includes(run.state)

    async function start() {
        if (!remote) return
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'export',
            resourceIds: [row.id],
            input: {orgId: org.id, formId: row.id, revision: row.answersRevision, version, format}
        }))
    }
    async function save() {
        const scope = current.current
        if (!scope.remote || !run) return
        await action.action(async function receive() {
            const file = await scope.remote!.control.result(run.id)
            if (current.current.remote != scope.remote || current.current.key != scope.key) return
            download(file)
        })
    }

    return <section className="export-panel">
        <div>
            <h2>Забрать ответы с собой</h2>
            <p>CSV для таблиц или JSON. Файл готовится в фоне, без ИИ и платных запросов.</p>
        </div>
        <div className="actions">
            <select
                aria-label="Формат выгрузки"
                value={format}
                onChange={event => setFormat(event.target.value as typeof format)}
            >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
            </select>
            <button
                disabled={!remote || !replay.ready || action.busy || !!active}
                onClick={() => void start()}
            >
                Подготовить выгрузку
            </button>
            {active && (
                <button disabled={action.busy} onClick={() => void action.action(() => remote!.ai.cancelRun(run!.id))}>
                    Отменить выгрузку
                </button>
            )}
            {run?.state == 'completed' && (
                <button className="primary" disabled={action.busy} onClick={() => void save()}>
                    Скачать готовый файл
                </button>
            )}
        </div>
        {(action.error || replay.error) && (
            <p role="alert" className="error">{action.error || replay.error}</p>
        )}
        {active && <p role="status">Подготавливаем файл…</p>}
        {run?.state == 'failed' && (
            <p>Выгрузка не завершилась. Проверьте доступ и подготовьте новый файл.</p>
        )}
        <small>Изменение ответов, срока хранения или доступа может потребовать новой выгрузки.</small>
    </section>
}
