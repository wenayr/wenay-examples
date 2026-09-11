import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {MonitoringState} from './model'
import {organizationAccess} from './domain'
import {openAiCheckpoint} from './ai-checkpoint'

export type MonitorFact = {id: string, label: string, text: string}
export type SummaryProvider = {summarize(input: {facts: MonitorFact[], signal: AbortSignal}): Promise<{text: string, steps: string[]}>}
export type MonitorSummary = {owner: string, orgId: string, id: string, revision: number, marker: string, text: string, steps: string[], sources: {id: string, label: string}[], demo: boolean}
export function createMonitorAssistant(deps: {directory?: string, provider?: SummaryProvider, timeoutMs?: number} = {}) {
    let store: Store<MonitoringState> | null = null
    const pending = new Map<string, {controller: AbortController, owner: string, orgId: string, id: string, marker: string}>()
    const journal = deps.directory ? openResults(deps.directory) : null
    const results = journal?.initial ?? {} as Record<string, MonitorSummary>
    function current(account: string, orgId: string, id: string) {
        if (!store) throw new Error('Мониторинг закрыт')
        organizationAccess(store.state, account, orgId, ['owner', 'oncall'])
        const monitor = store.state.monitors[id]
        if (!monitor || monitor.orgId != orgId) throw new Error('Проверка недоступна')
        const incident = store.state.incidents[monitor.incidentId]
        const marker = JSON.stringify([monitor.revision, monitor.history.at(-1)?.attempt ?? 0, incident?.id ?? '', incident?.revision ?? 0])
        return {monitor, incident, marker}
    }
    function facts(account: string, orgId: string, id: string) {
        const {monitor, incident, marker} = current(account, orgId, id)
        const states = {up: 'работает', down: 'ошибка', unknown: 'нет подтверждения'}
        const selected: MonitorFact[] = [{id: 'monitor-' + id, label: monitor.name, text: 'Последнее состояние: ' + states[monitor.status] + '. Наблюдений: ' + monitor.history.length + '. Порог ошибок: ' + monitor.downThreshold}]
        for (const item of monitor.history.slice(-8)) selected.push({id: id + ':' + item.attempt, label: 'Измерение ' + item.attempt, text: new Date(item.at).toISOString() + ': ' + states[item.outcome] + ', HTTP ' + item.code + ', ' + item.latencyMs + ' мс. ' + item.detail})
        if (incident) selected.push({id: incident.id, label: incident.title, text: 'Статус инцидента: ' + incident.status + '. ' + incident.notes.slice(-3).map(note => note.body).join('\n')})
        return {selected, marker, monitor}
    }
    function result(account: string, runId: string) {
        const output = Object.hasOwn(results, runId) ? results[runId] : undefined
        if (!output || output.owner != account || host.store.state.runs[runId]?.state != 'completed') throw new Error('Результат недоступен')
        if (current(account, output.orgId, output.id).marker != output.marker) throw new Error('Появились новые факты. Подготовьте свежую сводку')
        return {...output, steps: [...output.steps], sources: output.sources.map(source => ({...source}))}
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {orgId: string, id: string, revision: number}
        const source = facts(ctx.run.owner, input.orgId, input.id)
        if (source.monitor.revision != input.revision) throw new Error('Настройки изменились')
        const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 10000)])
        pending.set(ctx.run.id, {controller, owner: ctx.run.owner, orgId: input.orgId, id: input.id, marker: source.marker})
        let off = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Проверка наблюдений и истории инцидента'})
            const interrupted = new Promise<never>(function abortable(_resolve, reject) {
                function abort() {reject(signal.reason)}
                signal.addEventListener('abort', abort, {once: true}); off = () => signal.removeEventListener('abort', abort)
            })
            const response = await Promise.race([deps.provider ? deps.provider.summarize({facts: source.selected, signal}) : Promise.resolve({
                text: source.monitor.history.length ? source.selected.map(fact => fact.label + '. ' + fact.text).join('\n\n') : 'Измерений ещё нет. Причину состояния определить нельзя.',
                steps: ['Сверить время последних измерений и пропуски данных.', 'Проверить журнал приложения и последние развёртывания в его кабинете.', 'После устранения причины дождаться новых успешных измерений и проверить результат.']
            }), interrupted])
            signal.throwIfAborted()
            if (ctx.cancelled()) return
            if (typeof response.text != 'string' || !response.text.trim() || response.text.length > 15000 || !Array.isArray(response.steps) || response.steps.length > 8 || response.steps.some(step => typeof step != 'string' || !step.trim() || step.length > 1000)) throw new Error('Неверный формат сводки')
            if (current(ctx.run.owner, input.orgId, input.id).marker != source.marker) throw new Error('Факты изменились')
            const output: MonitorSummary = {owner: ctx.run.owner, ...input, marker: source.marker, text: response.text, steps: [...response.steps], sources: source.selected.map(({id, label}) => ({id, label})), demo: !deps.provider}
            results[ctx.run.id] = output
            journal?.save(results)
            return {result: {available: true, demo: !deps.provider}}
        } catch {throw new Error('Сводка не завершена: отмена, новые факты, изменение доступа или ошибка исполнителя')}
        finally {off(); pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'runs') : undefined}), runner, history: 5,
        capabilities: [{kind: 'summary', label: 'Сводка по наблюдаемым фактам'}], policy: {
            canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId: string, id: string, revision: number}
                    if (request.kind != 'summary' || !input || request.resourceIds?.length != 1 || request.resourceIds[0] != input.id) return false
                    const {monitor} = current(account, input.orgId, input.id)
                    const runs = Object.values(host.store.state.runs), active = runs.filter(run => ['running', 'queued'].includes(run.state))
                    return monitor.revision == input.revision && (runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 100 && active.length < 2 && !active.some(run => run.resourceIds[0] == input.id))
                } catch {return false}
            }}})
    for (const {run} of host.recovery.pending()) host.recovery.settle(run.id, {state: 'failed', error: 'Подготовка прервана перезапуском. Проверьте новые факты'})
    const resource = {allow: ['owner', 'oncall'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {result(runId: string) {ctx.signal.throwIfAborted(); return result(ctx.principal.account, runId)}}}, close: connection.close}
    }}
    return {resource, mount(value: Store<MonitoringState>) {
        store = value
        const off = value.on(function changed() {
            for (const item of pending.values()) {try {if (current(item.owner, item.orgId, item.id).marker != item.marker) item.controller.abort()} catch {item.controller.abort()}}
        })
        return function close() {off(); for (const item of pending.values()) item.controller.abort(); host.close(); store = null}
    }}
}
function openResults(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'results.replay'), storage = openFsReplayStorage<[Record<string, MonitorSummary>]>(file)
    let seq = storage.getKeyframe()?.seq ?? 0
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, MonitorSummary>) {
        storage.putKeyframe({seq: ++seq, ts: Date.now(), event: [value]})
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
