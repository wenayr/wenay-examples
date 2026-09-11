import React, {useMemo, useRef, useState, useEffect} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {SummaryResult} from '../backend/assistant-resource'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'
import type {Resources, DealRow} from './contracts'

type AssistantProps = {resources: Resources, row: DealRow, sourceKey: string, busy: boolean}

const busyStates = ['queued', 'running', 'waiting_input', 'waiting_approval']

export function Assistant({resources, row, sourceKey, busy}: AssistantProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('assistant'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const replay = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({
        runs: {}, approvals: {}, inputs: {}
    }))
    const action = useServiceAction(remote)

    // Сводка относится к состоянию сделки и её источников.
    const key = row.id + ':' + row.revision + ':' + sourceKey
    const current = useRef({key, remote})
    current.current = {key, remote}
    useEffect(() => () => {current.current = {key: '', remote: null}}, [])

    const [loaded, setLoaded] = useState<{key: string, remote: NonNullable<typeof remote>, result: SummaryResult} | null>(null)
    const result = loaded?.key == key && loaded.remote == remote ? loaded.result : null
    const mine = Object.values(replay.state?.runs ?? {}).filter(item => item.resourceIds.includes(row.id))
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = !!run && busyStates.includes(run.state)
    const disabled = busy || action.busy || !remote || !replay.ready

    async function prepare() {
        if (!remote) return
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'summary',
            resourceIds: [row.id],
            input: {orgId: row.orgId, id: row.id, revision: row.revision}
        }))
    }
    async function read() {
        const scope = current.current
        if (!scope.remote || !run) return
        await action.action(async function fresh() {
            const value = await scope.remote!.control.result(run.id)
            if (current.current.key != scope.key || current.current.remote != scope.remote) return
            setLoaded({key: scope.key, remote: scope.remote!, result: value})
        })
    }

    const summary = result && <div className="summary-result">
        <strong>Проверенные факты</strong>
        <p>{result.text}</p>
        <strong>Следующий шаг</strong>
        <p>{result.nextAction}</p>
        <ul>
            {result.sources.map(source => (
                <li key={source.kind + ':' + source.id}>{source.label} · v{source.revision}</li>
            ))}
        </ul>
        <small>Материал не отправлен клиенту и не сохранён в переписку.</small>
    </div>

    return <section className="assistant-card">
        <h2>✦ Контекст перед разговором</h2>
        <p>
            Тестовый исполнитель собирает факты из сделки.
            Это не ответ языковой модели, платных запросов нет.
        </p>
        {(action.error || replay.error) && (
            <p role="alert" className="error-inline">{action.error || replay.error}</p>
        )}
        <div className="actions">
            <button disabled={disabled || active} onClick={() => void prepare()}>
                Подготовить сводку
            </button>
            {active && (
                <button disabled={disabled} onClick={() => void action.action(() => remote!.ai.cancelRun(run.id))}>
                    Отменить подготовку
                </button>
            )}
            {run?.state == 'completed' && (
                <button disabled={disabled} onClick={() => void read()}>
                    Проверить и открыть результат
                </button>
            )}
        </div>
        {run && (
            <p className="muted">
                {run.state == 'completed' ? 'Материал готов' : run.message || run.state}
            </p>
        )}
        {summary}
    </section>
}
