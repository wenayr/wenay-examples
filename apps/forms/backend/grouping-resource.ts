import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {openAiCheckpoint} from './ai-checkpoint'
import {EDITORS, formAccess} from './domain'
import {STAFF, type FormsState} from './model'

export type Group = {label: string, sourceIds: string[]}
export type GroupingSource = {id: string, text: string}
export type GroupingProvider = {group(input: {sources: GroupingSource[], signal: AbortSignal}): Promise<Group[]>}
export type GroupingInput = {orgId: string, formId: string, version: number, answersRevision: number, fieldId: string}
export type GroupingResult = GroupingInput & {owner: string, revision: number, demo: boolean, groups: Group[], sampleSize: number, expiresAt: number}

// Source text remains private. Run history contains only status and a readiness flag.
export function createFormsGrouping(deps: {directory: string, now?: () => number, provider?: GroupingProvider, timeoutMs?: number}) {
    const now = deps.now ?? Date.now
    let store: Store<FormsState> | null = null
    const journal = openResults(deps.directory), results = journal.initial
    const pending = new Map<string, {owner: string, input: GroupingInput, controller: AbortController}>()
    function current(account: string, input: GroupingInput) {
        if (!store) throw new Error('Группировка закрыта')
        const {form} = formAccess(store.state, account, input.orgId, input.formId)
        if (form.answersRevision != input.answersRevision) throw new Error('Ответы изменились. Создайте новую группировку')
        const version = form.versions.find(value => value.version == input.version)
        const field = version?.fields.find(value => value.id == input.fieldId)
        if (!field || !['text', 'longtext'].includes(field.kind)) throw new Error('Выберите текстовое поле опубликованной версии')
        return form
    }
    function sources(account: string, input: GroupingInput) {
        const form = current(account, input)
        const rows = Object.values(store!.state.submissions).filter(row => row.formId == form.id && row.version == input.version && row.expiresAt > now() && typeof row.answers[input.fieldId] == 'string' && String(row.answers[input.fieldId]).trim()).sort((a, b) => a.id.localeCompare(b.id))
        if (rows.length < 3 || rows.length > 200) throw new Error('Для группировки нужны от 3 до 200 непустых текстовых ответов одной версии')
        return {values: rows.map(row => ({id: row.id, text: String(row.answers[input.fieldId])})), expiresAt: Math.min(...rows.map(row => row.expiresAt))}
    }
    function validateGroups(groups: Group[], ids: string[]) {
        if (!Array.isArray(groups) || !groups.length || groups.length > 20) throw new Error('Нужны от 1 до 20 групп')
        const allowed = new Set(ids), seen = new Set<string>(), labels = new Set<string>()
        const value = groups.map(function validate(group) {
            if (!group || typeof group.label != 'string' || !group.label.trim() || group.label.length > 100 || labels.has(group.label.trim()) || !Array.isArray(group.sourceIds) || !group.sourceIds.length || group.sourceIds.length > 200) throw new Error('Группа должна иметь уникальное название до 100 символов и источники')
            labels.add(group.label.trim())
            for (const id of group.sourceIds) {
                if (typeof id != 'string' || !allowed.has(id) || seen.has(id)) throw new Error('Каждый источник должен входить ровно в одну группу')
                seen.add(id)
            }
            return {label: group.label.trim(), sourceIds: [...group.sourceIds]}
        })
        if (seen.size != allowed.size) throw new Error('Некоторые источники не включены в группы')
        return value
    }
    function validate(account: string, output: GroupingResult) {
        current(account, output)
        if (output.expiresAt <= now()) throw new Error('Срок хранения источников завершился')
        const ids = sources(account, output).values.map(value => value.id)
        validateGroups(output.groups, ids)
        return {...output, groups: output.groups.map(group => ({...group, sourceIds: [...group.sourceIds]}))}
    }
    function result(account: string, id: string) {
        const output = Object.hasOwn(results, id) ? results[id] : undefined
        if (!output || output.owner != account || host.store.state.runs[id]?.state != 'completed') throw new Error('Результат недоступен')
        return validate(account, output)
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as GroupingInput
        const selected = sources(ctx.run.owner, input)
        const controller = new AbortController()
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 10000)])
        pending.set(ctx.run.id, {owner: ctx.run.owner, input, controller})
        let off = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Группировка ограниченной выборки; результат требует проверки'})
            const interrupted = new Promise<never>(function interrupt(_resolve, reject) {
                function abort() {reject(new Error('Группировка прервана'))}
                signal.addEventListener('abort', abort, {once: true})
                off = () => signal.removeEventListener('abort', abort)
            })
            signal.throwIfAborted()
            const groups = await Promise.race([deps.provider ? deps.provider.group({sources: selected.values, signal}) : demoGroups(selected.values), interrupted])
            signal.throwIfAborted()
            if (ctx.cancelled()) return
            const output: GroupingResult = {...input, owner: ctx.run.owner, revision: 1, demo: !deps.provider,
                groups: validateGroups(groups, selected.values.map(value => value.id)), sampleSize: selected.values.length, expiresAt: selected.expiresAt}
            validate(ctx.run.owner, output)
            results[ctx.run.id] = output
            journal.save(results)
            ctx.report({progress: 1, message: 'Группы готовы. Проверьте источники и при необходимости исправьте'})
            return {result: {available: true, demo: !deps.provider}}
        } catch {
            throw new Error(signal.aborted ? 'Группировка отменена, устарела или превысила время ожидания' : 'Не удалось сгруппировать текущие источники')
        } finally {off(); pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: path.join(deps.directory, 'runs')}), runner, history: 5,
        capabilities: [{kind: 'group', label: deps.provider ? 'Группировка ответов' : 'Тестовая группировка по ключевым словам'}],
        policy: {canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as GroupingInput | null
                    if (request.kind != 'group' || !input || typeof input.orgId != 'string' || typeof input.formId != 'string' || typeof input.fieldId != 'string' || !Number.isSafeInteger(input.version) || !Number.isSafeInteger(input.answersRevision) || request.resourceIds?.length != 1 || request.resourceIds[0] != input.formId) return false
                    sources(account, input)
                    const runs = Object.values(host.store.state.runs), active = runs.filter(run => ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state))
                    return runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 50 && active.length < 2 && !active.some(run => run.resourceIds[0] == input.formId)
                } catch {return false}
            }}})
    for (const entry of host.recovery.pending()) host.recovery.settle(entry.run.id, {state: 'failed', error: 'Группировка прервана перезапуском. Создайте новый запуск после проверки источников'})
    const resource = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {
            result(id: string) {ctx.signal.throwIfAborted(); return result(ctx.principal.account, id)},
            correct(input: {runId: string, revision: number, groups: Group[]}) {
                ctx.signal.throwIfAborted()
                const output = result(ctx.principal.account, input.runId)
                formAccess(store!.state, ctx.principal.account, output.orgId, output.formId, EDITORS)
                if (output.revision != input.revision) throw new Error('Группы уже исправлены. Обновите результат')
                const groups = validateGroups(input.groups, output.groups.flatMap(group => group.sourceIds))
                results[input.runId] = {...output, groups, revision: output.revision + 1}
                journal.save(results)
                return result(ctx.principal.account, input.runId)
            }
        }}, close: connection.close}
    }}
    function mount(state: Store<FormsState>) {
        store = state
        function changed() {
            for (const value of pending.values()) {
                try {sources(value.owner, value.input)} catch {value.controller.abort()}
            }
            let dirty = false
            for (const [id, value] of Object.entries(results)) {
                try {validate(value.owner, value)} catch {delete results[id]; dirty = true}
            }
            if (dirty) journal.save(results)
        }
        changed()
        const off = store.on(changed)
        return function close() {off(); for (const value of pending.values()) value.controller.abort(); host.close(); store = null}
    }
    return {resource, mount}
}

async function demoGroups(sources: GroupingSource[]) {
    // Explicit, deterministic demo rules; this is not a trained model or a quality score.
    await new Promise<void>(resolve => setImmediate(resolve))
    const groups = new Map<string, string[]>()
    for (const source of sources) {
        const text = source.text.toLowerCase()
        const label = /цен|дорог|стоим|price|cost/.test(text) ? 'Цена' : /скор|медлен|быстр|speed|slow|fast/.test(text) ? 'Скорость' : /удоб|сложн|понят|interface|easy|difficult/.test(text) ? 'Удобство' : 'Другие ответы'
        if (!groups.has(label)) groups.set(label, [])
        groups.get(label)!.push(source.id)
    }
    return [...groups].map(([label, sourceIds]) => ({label, sourceIds}))
}

function openResults(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'groups.replay')
    const storage = openFsReplayStorage<[Record<string, GroupingResult>]>(file)
    let seq = storage.getKeyframe()?.seq ?? 0
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, GroupingResult>) {
        storage.putKeyframe({seq: ++seq, ts: Date.now(), event: [value]})
        storage.compact()
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
