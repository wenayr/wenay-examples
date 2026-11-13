import React, {useRef, useEffect, useState} from 'react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {Page} from '../backend/model'
import type {EditResult} from '../backend/assistant-resource'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'
import {useContentResource, type Resources, type Commands} from './contracts'

type AssistantProps = {resources: Resources, commands: Commands, page: Page}

type Loaded = {remote: ReturnType<typeof useContentResource>, key: string, result: EditResult, runId: string}

export function EditAssistant({resources, commands, page}: AssistantProps) {
    const remote = useContentResource(resources, 'assistant')
    const action = useServiceAction(remote)
    const replay = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({
        runs: {}, approvals: {}, inputs: {}
    }))

    const [blockId, setBlockId] = useState('')
    const defaultInstruction = 'Уберите лишние пробелы и проверьте начало предложения.'
    const [instruction, setInstruction] = useState(defaultInstruction)

    const blocks = page.draft.blocks.filter(item => ['heading', 'text', 'quote'].includes(item.kind))
    const block = blocks.find(item => item.id == blockId) ?? blocks[0]

    // Предложение относится к конкретному блоку сохранённой ревизии.
    const key = page.id + ':' + page.revision + ':' + block?.id
    const current = useRef({remote, key})
    current.current = {remote, key}
    useEffect(() => () => {current.current = {remote: null, key: ''}}, [])

    const [loaded, setLoaded] = useState<Loaded | null>(null)
    const value = loaded && loaded.remote == remote && loaded.key == key ? loaded : null
    const mine = Object.values(replay.state?.runs ?? {}).filter(item => item.resourceIds.includes(page.id))
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = run && ['queued', 'running'].includes(run.state)

    function stale(scope: {remote: typeof remote, key: string}) {
        return current.current.remote != scope.remote || current.current.key != scope.key
    }

    async function prepare(event: React.FormEvent) {
        event.preventDefault()
        setLoaded(null)
        if (!remote || !block) return
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'edit',
            resourceIds: [page.id],
            input: {
                orgId: page.orgId,
                id: page.id,
                revision: page.revision,
                blockId: block.id,
                instruction
            }
        }))
    }
    async function read() {
        const scope = current.current
        if (!scope.remote || !run) return
        await action.action(async function fresh() {
            const result = await scope.remote!.control.result(run.id)
            if (stale(scope) || result.blockId != block?.id) return
            setLoaded({remote: scope.remote, key: scope.key, result, runId: run.id})
        })
    }
    async function accept() {
        const scope = current.current
        if (!scope.remote || !value) return
        await action.action(async function apply() {
            const result = await scope.remote!.control.result(value.runId)
            if (stale(scope)) return
            const blocks = page.draft.blocks.map(function replaced(item) {
                return item.id == result.blockId ? {...item, text: result.after} : item
            })
            const ok = await commands.run('pageSave', {
                orgId: page.orgId,
                id: page.id,
                revision: result.revision,
                ...page.draft,
                blocks
            })
            if (ok) setLoaded(null)
        })
    }

    const comparison = value && <div className="edit-comparison">
        <div>
            <small>СЕЙЧАС · Сохранённый блок</small>
            <p>{value.result.before}</p>
        </div>
        <div>
            <small>ПРЕДЛАГАЕТСЯ · Тестовая правка</small>
            <p>{value.result.after}</p>
        </div>
        <small>
            Источник: «{value.result.title}», ревизия {value.result.revision}.
            Изменится только выбранный блок.
        </small>
        <div className="actions">
            <button
                className="primary"
                disabled={action.busy || commands.busy}
                onClick={() => void accept()}
            >
                Принять в черновик
            </button>
            <button onClick={() => setLoaded(null)}>Отклонить</button>
        </div>
    </div>

    return <section className="assistant-panel">
        <header>
            <span>✧</span>
            <div>
                <h2>Взгляд со стороны</h2>
                <p>
                    Демонстрационный помощник убирает лишние пробелы и исправляет первую букву.
                    Это не языковая модель, платных запросов нет.
                </p>
            </div>
        </header>
        <form onSubmit={prepare}>
            <label>Сохранённый текстовый блок
                <select value={block?.id ?? ''} onChange={event => setBlockId(event.target.value)}>
                    {blocks.map(item => (
                        <option key={item.id} value={item.id}>{item.text.slice(0, 75)}</option>
                    ))}
                </select>
            </label>
            <label>Пожелание к тексту
                <textarea
                    value={instruction}
                    onChange={event => setInstruction(event.target.value)}
                    maxLength={1000}
                    rows={2}
                />
            </label>
            <div className="actions">
                <button disabled={!remote || !replay.ready || !block || action.busy || !!active}>
                    Подготовить вариант
                </button>
                {active && <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => void action.action(() => remote!.ai.cancelRun(run!.id))}
                >
                    Отменить подготовку
                </button>}
                {run?.state == 'completed' && (
                    <button type="button" disabled={action.busy} onClick={() => void read()}>
                        Проверить предложение
                    </button>
                )}
            </div>
        </form>
        {(action.error || replay.error) && (
            <p className="error" role="alert">{action.error || replay.error}</p>
        )}
        {comparison}
    </section>
}
