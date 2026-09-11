import React, {useRef, useState, useEffect} from 'react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {GroupingResult, Group} from '../backend/grouping-resource'
import type {Submission} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'
import {useFormResource, type Resources, type Organization, type FormRow, type Detail} from './contracts'

type GroupingProps = {
    resources: Resources,
    org: Organization,
    row: FormRow,
    detail: Detail,
    version: number,
    entries: Submission[]
}

type Loaded = {
    remote: ReturnType<typeof useFormResource>,
    key: string,
    result: GroupingResult,
    runId: string,
    groups: Group[]
}

function copyGroups(groups: Group[]) {
    return groups.map(group => ({...group, sourceIds: [...group.sourceIds]}))
}

export function Grouping({resources, org, row, detail, version, entries}: GroupingProps) {
    const remote = useFormResource(resources, 'grouping')
    const action = useServiceAction(remote)
    const replay = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({
        runs: {}, approvals: {}, inputs: {}
    }))

    const publication = detail.versions.find(value => value.version == (version || row.publishedVersion))
    const fields = publication?.fields.filter(field => ['text', 'longtext'].includes(field.kind)) ?? []
    const [fieldId, setFieldId] = useState('')
    const field = fields.find(item => item.id == fieldId) ?? fields[0]

    // Группы относятся к конкретной версии, вопросу и состоянию ответов.
    const key = [org.id, row.id, row.answersRevision, publication?.version, field?.id].join(':')
    const current = useRef({remote, key})
    current.current = {remote, key}
    useEffect(() => () => {current.current = {remote: null, key: ''}}, [])

    const [loaded, setLoaded] = useState<Loaded | null>(null)
    const value = loaded && loaded.remote == remote && loaded.key == key ? loaded : null
    const mine = Object.values(replay.state?.runs ?? {}).filter(item => item.resourceIds.includes(row.id))
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = run && ['queued', 'running'].includes(run.state)
    const editable = org.role != 'analyst'

    async function start() {
        setLoaded(null)
        if (!remote || !field || !publication) return
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'group',
            resourceIds: [row.id],
            input: {
                orgId: org.id,
                formId: row.id,
                version: publication.version,
                answersRevision: row.answersRevision,
                fieldId: field.id
            }
        }))
    }
    async function read() {
        const scope = current.current
        if (!scope.remote || !run) return
        await action.action(async function fresh() {
            const result = await scope.remote!.control.result(run.id)
            if (current.current.remote != scope.remote || current.current.key != scope.key) return
            if (result.version != publication?.version || result.fieldId != field?.id) return
            setLoaded({
                remote: scope.remote,
                key: scope.key,
                result,
                runId: run.id,
                groups: copyGroups(result.groups)
            })
        })
    }
    async function save() {
        const scope = current.current
        if (!scope.remote || !value) return
        await action.action(async function correct() {
            await scope.remote!.control.correct({
                runId: value.runId,
                revision: value.result.revision,
                groups: value.groups.filter(group => group.sourceIds.length)
            })
            const result = await scope.remote!.control.result(value.runId)
            if (current.current.remote != scope.remote || current.current.key != scope.key) return
            setLoaded({...value, result, groups: copyGroups(result.groups)})
        })
    }
    function change(groups: Group[]) {
        if (value) setLoaded({...value, groups})
    }
    // Ответ живёт ровно в одной теме: из прежней убираем, в выбранную добавляем.
    function moveSource(id: string, from: number, to: number) {
        if (!value) return
        change(value.groups.map(function regroup(item, index) {
            if (index == from) return {...item, sourceIds: item.sourceIds.filter(value => value != id)}
            if (index == to) return {...item, sourceIds: [...item.sourceIds, id]}
            return item
        }))
    }

    const controls = <div className="actions">
        <label>Текстовый вопрос · v{publication?.version}
            <select value={field?.id} onChange={event => setFieldId(event.target.value)}>
                {fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
        </label>
        <button
            disabled={!remote || !replay.ready || action.busy || !!active}
            onClick={() => void start()}
        >
            Сгруппировать ответы
        </button>
        {active && (
            <button disabled={action.busy} onClick={() => void action.action(() => remote!.ai.cancelRun(run!.id))}>
                Отменить группировку
            </button>
        )}
        {run?.state == 'completed' && (
            <button disabled={action.busy} onClick={() => void read()}>Проверить группы</button>
        )}
    </div>

    function card(group: Group, index: number) {
        return <article key={index}>
            <label>Название темы
                <input
                    value={group.label}
                    disabled={!editable || action.busy}
                    onChange={event => change(value!.groups.map(function renamed(item, position) {
                        return position == index ? {...item, label: event.target.value} : item
                    }))}
                />
            </label>
            <small>{group.sourceIds.length} ответов</small>
            {group.sourceIds.map(function source(id) {
                const entry = entries.find(item => item.id == id)
                const text = entry ? String(entry.answers[field.id] ?? '') : 'Ответ с другой страницы списка'
                return <div className="group-source" key={id}>
                    <p>{text}</p>
                    {editable && <select
                        aria-label={'Тема ответа ' + id.slice(0, 6)}
                        value={index}
                        disabled={action.busy}
                        onChange={event => moveSource(id, index, Number(event.target.value))}
                    >
                        {value!.groups.map((item, position) => (
                            <option key={position} value={position}>{item.label}</option>
                        ))}
                    </select>}
                </div>
            })}
        </article>
    }

    const result = value && <>
        <p>
            Ответов в выборке: {value.result.sampleSize}.
            Названия можно уточнить, исходные ответы останутся прежними.
        </p>
        {editable && (
            <button
                disabled={action.busy || value.groups.length >= 20}
                onClick={() => change([
                    ...value.groups,
                    {label: 'Новая тема ' + (value.groups.length + 1), sourceIds: []}
                ])}
            >
                + Новая тема
            </button>
        )}
        <div className="group-grid">{value.groups.map(card)}</div>
        {editable && (
            <button className="primary" disabled={action.busy} onClick={() => void save()}>
                Сохранить уточнение тем
            </button>
        )}
    </>

    const body = <>
        {controls}
        {(action.error || replay.error) && (
            <p role="alert" className="error">{action.error || replay.error}</p>
        )}
        {run?.state == 'failed' && (
            <p>Для группировки нужны от 3 до 200 актуальных непустых ответов. Проверьте вопрос и версию.</p>
        )}
        {result}
    </>

    return <section className="panel grouping">
        <header>
            <div>
                <h2>Какие темы повторяются?</h2>
                <p>
                    Тестовая группировка, без платной модели.
                    От 3 до 200 непустых текстовых ответов одной версии.
                    Это небольшой образец, а не статистический вывод.
                </p>
            </div>
        </header>
        {field ? body : <p>В этой публикации нет текстовых вопросов. Выберите другую версию.</p>}
    </section>
}
