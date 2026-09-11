import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {openAiCheckpoint} from './ai-checkpoint'
import {checkRevision, cleanText, writeAccess} from './domain'
import {WRITERS, type ContentState} from './model'

export type EditSource = {orgId: string, id: string, revision: number, title: string, blockId: string, kind: 'heading' | 'text' | 'quote', before: string}
export type EditProvider = {suggest(input: {source: EditSource, instruction: string, signal: AbortSignal}): Promise<string>}
export type EditResult = EditSource & {after: string, demo: boolean, requiresConfirmation: true}
type SavedEdit = EditResult & {owner: string}

export function createContentAssistant(deps: {directory?: string, provider?: EditProvider, timeoutMs?: number} = {}) {
    let store: Store<ContentState> | null = null
    const pending = new Map<string, {controller: AbortController, account: string, source: EditSource}>()
    const journal = deps.directory ? openResults(deps.directory) : null, results: Record<string, SavedEdit> = journal?.initial ?? {}
    function source(account: string, input: {orgId: string, id: string, revision: number, blockId: string}): EditSource {
        if (!store) throw new Error('Редактор закрыт')
        const page = writeAccess(store.state, account, input.orgId, input.id)
        checkRevision(page, input.revision)
        const block = page.draft.blocks.find(value => value.id == input.blockId)
        if (!block || block.kind != 'heading' && block.kind != 'text' && block.kind != 'quote') throw new Error('Выберите текстовый блок')
        return {orgId: page.orgId, id: page.id, revision: page.revision, title: page.draft.title, blockId: block.id, kind: block.kind, before: block.text}
    }
    function result(account: string, runId: string) {
        const value = Object.hasOwn(results, runId) ? results[runId] : undefined
        if (!value || value.owner != account || host.store.state.runs[runId]?.state != 'completed') throw new Error('Предложение недоступно')
        const current = source(account, value)
        if (current.before != value.before) throw new Error('Исходный текст изменился')
        const {owner: _owner, ...publicResult} = value
        return publicResult
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {orgId: string, id: string, revision: number, blockId: string, instruction: string}
        const selected = source(ctx.run.owner, input), controller = new AbortController()
        pending.set(ctx.run.id, {controller, account: ctx.run.owner, source: selected})
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 10000)])
        let offAbort = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Готовим вариант для сравнения'})
            const interrupted = new Promise<never>(function interrupt(_resolve, reject) {
                function abort() {reject(new Error('Подготовка прервана'))}
                signal.addEventListener('abort', abort, {once: true}); offAbort = () => signal.removeEventListener('abort', abort)
            })
            signal.throwIfAborted()
            const answer = await Promise.race([deps.provider ? deps.provider.suggest({source: {...selected}, instruction: input.instruction, signal}) : Promise.resolve(selected.before.replace(/\s+/g, ' ').trim().replace(/^[а-яa-z]/, letter => letter.toUpperCase())), interrupted])
            signal.throwIfAborted(); if (ctx.cancelled()) return
            source(ctx.run.owner, selected)
            const after = cleanText(answer, selected.kind == 'heading' ? 500 : 4000)
            results[ctx.run.id] = {...selected, after, owner: ctx.run.owner, demo: !deps.provider, requiresConfirmation: true}
            journal?.save(results)
            ctx.report({progress: 1, message: 'Сравните варианты и примите правку самостоятельно'})
            return {result: {available: true, demo: !deps.provider, requiresConfirmation: true}}
        } catch {throw new Error(signal.aborted ? 'Предложение прервано: отмена, изменение документа/прав или тайм-аут' : 'Не удалось подготовить предложение. Проверьте документ и исполнителя')}
        finally {offAbort(); pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'runs') : undefined}), runner, history: 5,
        capabilities: [{kind: 'edit', label: deps.provider ? 'Предложить правку' : 'Тестовая правка текста (без LLM)'}],
        policy: {canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account, canCreate(account, request) {
            try {
                const input = request.input as {orgId: string, id: string, revision: number, blockId: string, instruction: string}
                if (request.kind != 'edit' || !input || request.resourceIds?.length != 1 || request.resourceIds[0] != input.id) return false
                cleanText(input.instruction, 1000); source(account, input)
                const runs = Object.values(host.store.state.runs), active = runs.filter(run => ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state))
                return runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 100 && active.length < 2 && !active.some(run => run.owner == account)
            } catch {return false}
        }}})
    for (const entry of host.recovery.pending()) host.recovery.settle(entry.run.id, {state: 'failed', error: 'Предложение прервано рестартом. Создайте новое'})
    const resource = {allow: WRITERS, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {
            source(input: {orgId: string, id: string, revision: number, blockId: string}) {ctx.signal.throwIfAborted(); return source(ctx.principal.account, input)},
            result(runId: string) {ctx.signal.throwIfAborted(); return result(ctx.principal.account, runId)}
        }}, close: connection.close}
    }}
    function mount(state: Store<ContentState>) {
        store = state
        const off = state.on(function changed() {for (const entry of pending.values()) {try {source(entry.account, entry.source)} catch {entry.controller.abort()}}})
        return function close() {off(); for (const entry of pending.values()) entry.controller.abort(); host.close(); store = null}
    }
    return {resource, mount}
}
function openResults(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'results.replay'), fd = openSync(file, 'a', 0o600)
    closeSync(fd)
    const storage = openFsReplayStorage<[Record<string, SavedEdit>]>(file)
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, SavedEdit>) {
        storage.putKeyframe({seq: Date.now(), ts: Date.now(), event: [value]})
        const fd = openSync(file, 'r+'); try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
