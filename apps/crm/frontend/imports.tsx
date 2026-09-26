import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {ImportView} from '../backend/imports'
import type {CrmWorkspace} from '../backend/domain'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'
import type {Resources, Commands, Organization} from './contracts'

function openImports(resources: Resources) {
    return resources.open('imports')
}

type ImportRemote = NonNullable<ReturnType<ReturnType<typeof openImports>['current']>>['remote']
type ImportDetail = Awaited<ReturnType<ImportRemote['control']['detail']>>

const labels = {
    preview: 'Проверьте колонки',
    running: 'Импортируется',
    completed: 'Завершён',
    cancelled: 'Отменён',
    uncertain: 'Нужна сверка'
}

const rowLabels = {
    pending: 'Ожидает',
    imported: 'Добавлен',
    duplicate: 'Дубликат',
    invalid: 'Ошибка'
}

const columns = [
    {key: 'name', label: 'Имя'},
    {key: 'email', label: 'Email'},
    {key: 'phone', label: 'Телефон'}
]

const sample = 'Имя,Email,Телефон\n'
    + 'Анна,anna@example.test,+70000000001\n'
    + 'Борис,boris@example.test,+70000000002\n'
    + 'Повтор,anna@example.test,+70000000003\n'
    + 'Без почты,not-email,+70000000004'

type ImportsProps = {
    value: ImportView,
    workspace: CrmWorkspace,
    org: Organization,
    resources: Resources,
    commands: Commands,
    busy: boolean
}

export function Imports({value, workspace, org, resources, commands, busy}: ImportsProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...openImports(resources), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const ai = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({
        runs: {}, approvals: {}, inputs: {}
    }))
    const action = useServiceAction(remote)

    const companies = workspace.companies.filter(item => item.orgId == org.id && !item.archived)
    const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
    const [selected, setSelected] = useState('')
    const jobs = value.imports.filter(item => item.orgId == org.id)
    const job = jobs.find(item => item.id == selected) ?? jobs.at(-1)

    const [loaded, setLoaded] = useState<{key: string, remote: ImportRemote, detail: ImportDetail} | null>(null)
    const [detailError, setDetailError] = useState('')
    const key = job ? job.id + ':' + job.revision : ''
    const identity = useRef({remote, key})
    identity.current = {remote, key}
    useEffect(() => () => {identity.current = {remote: null, key: ''}}, [])

    useEffect(function read() {
        let active = true
        setDetailError('')
        if (!remote || !job) return
        const request = remote.control.detail({orgId: org.id, id: job.id, revision: job.revision})
        void request.then(function ready(detail) {
            if (!active || identity.current.key != key || identity.current.remote != remote) return
            setLoaded({key, remote, detail})
        }, function failed(reason) {
            if (active) setDetailError(reason instanceof Error ? reason.message : 'Импорт недоступен')
        })
        return () => {active = false}
    }, [key, remote, org.id])

    const detail = loaded?.key == key && loaded.remote == remote ? loaded.detail : null
    const run = Object.values(ai.state?.runs ?? {}).find(function running(item) {
        if (!item.resourceIds.includes(job?.id ?? '')) return false
        return ['running', 'queued'].includes(item.state)
    })
    const disabled = busy || action.busy || !remote || !ai.ready

    async function upload(name: string, bytes: Uint8Array) {
        const active = remote
        await action.action(async function send() {
            if (!active) throw new Error('Нет соединения')
            const result = await active.control.upload({orgId: org.id, companyId, name, bytes})
            if (identity.current.remote == active) setSelected(result.id)
        })
    }
    async function choose(file?: File) {
        if (!file) return
        const active = remote
        await action.action(async function readFile() {
            if (file.size > 512 * 1024) throw new Error('CSV до 512 КиБ')
            const bytes = new Uint8Array(await file.arrayBuffer())
            if (!active || identity.current.remote != active) return
            const result = await active.control.upload({orgId: org.id, companyId, name: file.name, bytes})
            if (identity.current.remote == active) setSelected(result.id)
        })
    }
    async function start() {
        if (!remote || !job) return
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'import',
            resourceIds: [job.id],
            input: {orgId: org.id, importId: job.id, revision: job.revision}
        }))
    }
    function saveMapping(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        void commands.run('importMap', {
            orgId: org.id,
            id: job!.id,
            revision: job!.revision,
            name: String(form.get('name')),
            email: String(form.get('email')),
            phone: String(form.get('phone'))
        })
    }

    const locked = disabled || job?.status == 'running' || job?.status == 'completed'

    const mapping = detail && <form key={key} className="mapping" onSubmit={saveMapping}>
        {columns.map(field => (
            <label key={field.key}>{field.label}
                <select
                    name={field.key}
                    defaultValue={detail.mapping[field.key as keyof typeof detail.mapping]}
                    disabled={locked}
                >
                    <option value="">
                        {field.key == 'phone' ? 'Не импортировать' : 'Выберите колонку'}
                    </option>
                    {detail.table.headers.map(header => (
                        <option key={header} value={header}>{header}</option>
                    ))}
                </select>
            </label>
        ))}
        <button disabled={locked}>Сохранить колонки</button>
    </form>

    const table = detail && <div className="raw-table">
        <table>
            <thead>
                <tr>
                    <th>Строка</th>
                    {detail.table.headers.map(header => <th key={header}>{header}</th>)}
                    <th>Результат</th>
                </tr>
            </thead>
            <tbody>
                {detail.table.rows.map((row, index) => (
                    <tr key={index}>
                        <td>{index + 1}</td>
                        {row.map((cell, column) => <td key={column}>{cell}</td>)}
                        <td>
                            <strong>{rowLabels[detail.rows[index].status]}</strong>
                            <small>{detail.rows[index].error}</small>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>

    // Продолжить может только владелец загрузки и только незавершённый импорт.
    const own = job?.owner == workspace.me?.account
    const resumable = own && ['preview', 'cancelled', 'uncertain'].includes(job?.status ?? '')

    const review = job && <>
        <header>
            <h2>{job.name}</h2>
            <span>{labels[job.status]}</span>
        </header>
        <div className="import-counts">
            <span>Добавлено <b>{job.imported}</b></span>
            <span>Повторы <b>{job.duplicate}</b></span>
            <span>Ошибки <b>{job.errors}</b></span>
            <span>Всего <b>{job.total}</b></span>
        </div>
        {run && <div>
            <progress max={1} value={run.progress ?? 0}/>
            <p className="muted">{run.message}</p>
            <button disabled={disabled} onClick={() => void action.action(() => remote!.ai.cancelRun(run.id))}>
                Остановить импорт
            </button>
        </div>}
        {detail ? <>
            {mapping}
            {table}
            <div className="actions">
                {job.status == 'completed' && <p className="muted" role="status">Все строки проверены.</p>}
                {job.status != 'completed' && <button className="primary" disabled={disabled || !resumable} onClick={() => void start()}>
                    {job.status == 'preview' ? 'Начать импорт' : 'Продолжить оставшиеся строки'}
                </button>}
                <small>
                    Каждая строка сохраняется отдельно. Завершённые строки не повторяются.
                </small>
            </div>
        </> : <p className="empty">Проверяем доступ к исходной таблице…</p>}
    </>

    const nothing = <div className="empty">
        <h2>Начните с CSV</h2>
        <p>Загрузите файл или откройте пример с повторами и ошибкой.</p>
    </div>

    return <>
        <div className="page-title">
            <div>
                <p className="eyebrow">ИЗ ТАБЛИЦЫ В ОТНОШЕНИЯ</p>
                <h1>Новые контакты, без рутины.</h1>
                <p>Проверьте колонки перед импортом. Ошибки и дубликаты останутся в отчёте.</p>
            </div>
        </div>
        <div className="import-upload">
            <label>Компания для контактов
                <select value={companyId} onChange={event => setCompanyId(event.target.value)}>
                    {companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>
            <label className="file-input">Выберите CSV до 512 КиБ
                <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={disabled || !companyId}
                    onChange={event => void choose(event.target.files?.[0])}
                />
            </label>
            <button
                disabled={disabled || !companyId}
                onClick={() => void upload('Контакты — пример.csv', new TextEncoder().encode(sample))}
            >
                Попробовать пример
            </button>
        </div>
        {(action.error || detailError || ai.error) && (
            <p className="error-inline" role="alert">
                {action.error || detailError || String(ai.error)}
            </p>
        )}
        <div className="import-layout">
            <aside className="import-list">
                {jobs.map(item => (
                    <button
                        className={job?.id == item.id ? 'active' : ''}
                        key={item.id}
                        onClick={() => setSelected(item.id)}
                    >
                        <strong>{item.name}</strong>
                        <small>{labels[item.status]} · Проверено {item.imported + item.duplicate + item.errors}/{item.total}</small>
                    </button>
                ))}
            </aside>
            <section className="import-review">{job ? review : nothing}</section>
        </div>
    </>
}
