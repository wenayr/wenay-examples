import React, {useMemo, useRef, useState, useEffect} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {SuggestionResult} from '../backend/assistant-resource'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'
import {when, type Resources} from './contracts'

type AssistantProps = {
    resources: Resources,
    orgId: string,
    catalogKey: string,
    busy: boolean,
    apply: (result: SuggestionResult) => void
}

export function PreferenceAssistant({resources, orgId, catalogKey, busy, apply}: AssistantProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('assistant'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const replay = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({runs: {}, approvals: {}, inputs: {}}))
    const action = useServiceAction(remote)
    const [prompt, setPrompt] = useState('Завтра в 12:00, 1 человек')

    // Предложение относится к каталогу организации: его смена обесценивает прежний ответ.
    const key = orgId + ':' + catalogKey
    const current = useRef({key, remote})
    current.current = {key, remote}
    useEffect(() => () => {current.current = {key: '', remote: null}}, [])

    const [loaded, setLoaded] = useState<{key: string, remote: NonNullable<typeof remote>, result: SuggestionResult} | null>(null)
    const result = loaded?.key == key && loaded.remote == remote ? loaded.result : null
    const mine = Object.values(replay.state?.runs ?? {}).filter(item => item.resourceIds.includes(orgId))
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = run && ['queued', 'running'].includes(run.state)
    const disabled = busy || action.busy || !remote || !replay.ready

    function stale(scope: {key: string, remote: typeof remote}) {
        return current.current.key != scope.key || current.current.remote != scope.remote
    }

    async function prepare(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const scope = current.current
        setLoaded(null)
        if (!scope.remote) return
        await action.action(async function prepareRequest() {
            const context = await scope.remote!.control.context(orgId)
            if (stale(scope)) return
            await scope.remote!.ai.createRun({
                requestId: crypto.randomUUID(),
                kind: 'preferences',
                resourceIds: [orgId],
                input: {orgId, prompt, catalogKey: context.catalogKey}
            })
        })
    }
    async function read(choose: boolean) {
        const scope = current.current
        if (!scope.remote || !run) return
        await action.action(async function fresh() {
            const value = await scope.remote!.control.result(run.id)
            if (stale(scope)) return
            setLoaded({key: scope.key, remote: scope.remote!, result: value})
            if (choose) apply(value)
        })
    }

    const suggestion = result && <div className="preference-result">
        <strong>{result.serviceName}</strong>
        <p>{result.date} · {result.partySize} участн. · {result.zone}</p>
        {result.slots.length ? <ul>
            {result.slots.slice(0, 3).map(slot => <li key={slot.start}>{when(slot.start, result.zone)}</li>)}
        </ul> : <p>Свободных вариантов сейчас нет. Откройте календарь и выберите другое время.</p>}
        <button className="primary" disabled={disabled} onClick={() => void read(true)}>
            Применить выбор к календарю
        </button>
        <small>Запись не создана. Выберите слот и подтвердите удержание обычным способом.</small>
    </div>

    return <details className="preference-assistant">
        <summary>✦ Подобрать время по пожеланиям</summary>
        <p>
            Тестовый разбор текста, без платной модели.
            Укажите дату или «завтра», время и число участников.
        </p>
        <form onSubmit={prepare}>
            <label>Ваши пожелания
                <textarea
                    value={prompt}
                    onChange={event => setPrompt(event.target.value)}
                    maxLength={1000}
                    required
                    rows={2}
                />
            </label>
            <button disabled={disabled || !!active}>Подобрать варианты</button>
        </form>
        {(action.error || replay.error) && (
            <p role="alert" className="inline-error">{action.error || replay.error}</p>
        )}
        {active && (
            <button disabled={disabled} onClick={() => void action.action(() => remote!.ai.cancelRun(run!.id))}>
                Отменить подбор
            </button>
        )}
        {run?.state == 'completed' && (
            <button disabled={disabled} onClick={() => void read(false)}>Проверить предложение</button>
        )}
        {run?.state == 'failed' && (
            <p className="muted">Не удалось подобрать время. Уточните пожелания и повторите.</p>
        )}
        {suggestion}
    </details>
}
