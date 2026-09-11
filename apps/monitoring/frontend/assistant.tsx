import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {MonitorSummary} from '../backend/assistant-resource'
import type {Monitor} from '../backend/model'
import type {Resources} from './contracts'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'
function initial(): AiRunStore {return {runs: {}, inputs: {}, approvals: {}}}
export function Assistant({resources, monitor, incidentRevision}: {resources: Resources, monitor: Monitor, incidentRevision: number}) {
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open('assistant'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote ?? null : null
    const scope = JSON.stringify([monitor.orgId, monitor.id, monitor.revision, monitor.history.at(-1)?.attempt ?? 0, monitor.incidentId, incidentRevision])
    const latest = useRef({scope, remote}); latest.current = {scope, remote}
    useEffect(() => () => {latest.current = {scope: '', remote: null}}, [])
    const action = useServiceAction(scope)
    const state = useReplayView(remote?.ai.state ?? null, initial)
    const [loaded, setLoaded] = useState<{scope: string, remote: typeof remote, result: MonitorSummary} | null>(null)
    const run = Object.values(state.state?.runs ?? {}).filter(run => run.resourceIds[0] == monitor.id).sort((a, b) => b.createdAt - a.createdAt)[0]
    const active = run && ['running', 'queued'].includes(run.state)
    const result = loaded?.scope == scope && loaded.remote == remote ? loaded.result : null
    return <section className="assistant"><h3>✦ Что известно сейчас</h3><p>Тестовый исполнитель собирает факты. Причину сбоя он не придумывает и команды развёртывания не выполняет.</p><div className="actions"><button disabled={!remote || !!active || action.busy} onClick={() => void action.action(async function start() {await remote!.ai.createRun({kind: 'summary', requestId: crypto.randomUUID(), resourceIds: [monitor.id], input: {orgId: monitor.orgId, id: monitor.id, revision: monitor.revision}})})}>Собрать сводку</button>{active && <button onClick={() => void action.action(async function cancel() {await remote!.ai.cancelRun(run.id)})}>Отменить</button>}{run?.state == 'completed' && <button disabled={!remote || action.busy} onClick={() => void action.action(async function read() {const result = await remote!.control.result(run.id); if (latest.current.scope == scope && latest.current.remote == remote) setLoaded({scope, remote, result})})}>Проверить и открыть</button>}</div>{action.error && <p role="alert">{action.error}</p>}{run && <small>{({queued: 'В очереди', running: 'Проверяем факты', completed: 'Материал готов', cancelled: 'Отменено', failed: 'Не завершено'} as Record<string, string>)[run.state] ?? run.state}</small>}{result && <div className="summary"><p>{result.text}</p><h4>Шаги для проверки человеком</h4><ol>{result.steps.map(step => <li key={step}>{step}</li>)}</ol><small>Источники: {result.sources.map(source => source.label).join(' · ')}</small><a href="http://127.0.0.1:3705/" target="_blank" rel="noreferrer">Открыть локальный кабинет хостинга ↗</a></div>}</section>
}
