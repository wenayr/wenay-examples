import React, {useMemo, useState, useRef, useEffect} from 'react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {ServiceClient} from 'wenay-common2/service/client'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {SupportDefinition} from '../backend/runtime'
import type {Draft} from '../backend/assistant-resource'
import {useServiceAction} from '../shared/react/service-action'
import {useReplayView} from '../shared/react/replay-view'

type Props = {
    resources: ServiceClient<SupportDefinition>['resources'],
    orgId: string,
    ticketId: string,
    revision: number,
    disabled: boolean,
    onDraft: (text: string) => void,
    articles?: {id: string, revision: number, status: string}[]
}

const runStates: Record<string, string> = {
    queued: 'Ожидание',
    running: 'Обработка',
    waiting_input: 'Нужен ввод',
    waiting_approval: 'Нужна проверка',
    completed: 'Готово',
    failed: 'Не завершено',
    cancelled: 'Отменено'
}

const busyStates = ['queued', 'running', 'waiting_input', 'waiting_approval']

export function AssistantPanel(props: Props) {
    const resource = useOwnedClient({
        key: props.resources,
        create: () => ({...props.resources.open('assistant'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => resource.client ? {store: resource.client.status} : null, [resource.client]))
    const remote = status.state?.phase == 'ready' ? resource.client?.current()?.remote : null
    const ai = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({runs: {}, approvals: {}, inputs: {}}))
    const action = useServiceAction(remote)

    const [draft, setDraft] = useState<{key: string, remote: typeof remote, value: Draft} | null>(null)
    const key = [props.orgId, props.ticketId, props.revision].join(':')
    const scope = useRef({key, remote, articles: props.articles, mounted: true})
    scope.current = {key, remote, articles: props.articles, mounted: true}
    useEffect(function lifetime() {
        return () => {scope.current.mounted = false}
    }, [])

    // Материал опирается на статьи: их правка или снятие с публикации обесценивают черновик.
    function currentSources(value: Draft) {
        if (!scope.current.articles) return true
        return value.sources.every(function fresh(source) {
            return scope.current.articles!.some(function same(article) {
                if (article.id != source.id || article.revision != source.revision) return false
                return article.status == 'published'
            })
        })
    }

    const matching = draft?.key == key && draft.remote == remote
    const visible = matching && currentSources(draft.value) ? draft.value : null
    const mine = Object.values(ai.state?.runs ?? {}).filter(run => run.resourceIds[0] == props.ticketId)
    const runs = mine.sort((a, b) => b.createdAt - a.createdAt).slice(0, 4)

    async function prepare() {
        await action.action(async function start() {
            setDraft(null)
            await remote!.ai.createRun({
                requestId: crypto.randomUUID(),
                kind: 'answer',
                resourceIds: [props.ticketId],
                input: {orgId: props.orgId, ticketId: props.ticketId, revision: props.revision}
            })
        })
    }
    async function read(id: string, copy: boolean) {
        await action.action(async function fetchDraft() {
            setDraft(null)
            const value = await remote!.control.result(id)
            if (!scope.current.mounted || scope.current.key != key) return
            if (scope.current.remote != remote || !currentSources(value)) return
            setDraft({key, remote, value})
            if (copy) props.onDraft(value.text)
        })
    }

    const material = visible && <div>
        <p style={{whiteSpace: 'pre-wrap'}}>{visible.text}</p>
        <ul>
            {visible.sources.map(source => (
                <li key={source.id}>{source.title} · версия {source.revision}</li>
            ))}
        </ul>
        <small>
            Перед вставкой проверяются текущие права и версии. Отправка — отдельным действием.
        </small>
    </div>

    return <section className="assistant-box">
        <h3>Помощник по базе знаний</h3>
        <p className="muted">
            Сейчас работает тестовый исполнитель: находит статьи и собирает выдержку.
            Это не ответ модели. Платных запросов нет.
        </p>
        <button
            disabled={props.disabled || !ai.ready || action.busy}
            onClick={() => void prepare()}
        >
            Подготовить материал
        </button>
        {runs.map(run => (
            <div key={run.id} className="assistant-run">
                <small>{runStates[run.state]}</small>
                <p>
                    {run.recovery
                        ? 'Прервано рестартом. Автоматический повтор отключён.'
                        : run.message || run.error}
                </p>
                {busyStates.includes(run.state) && <button
                    disabled={action.busy}
                    onClick={() => void action.action(() => remote!.ai.cancelRun(run.id, 'Отменено пользователем'))}
                >
                    Отменить
                </button>}
                {run.state == 'completed' && <>
                    <button
                        disabled={action.busy || props.disabled}
                        onClick={() => void read(run.id, false)}
                    >
                        Проверить источники
                    </button>
                    <button
                        disabled={action.busy || props.disabled}
                        onClick={() => void read(run.id, true)}
                    >
                        Вставить в черновик ответа
                    </button>
                </>}
            </div>
        ))}
        {material}
        {action.error && <p role="alert">{action.error}</p>}
        {!!(status.error || ai.error) && (
            <p role="alert">Помощник временно недоступен. Повторите подключение.</p>
        )}
    </section>
}
