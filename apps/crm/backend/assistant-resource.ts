import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {openAiCheckpoint} from './ai-checkpoint'
import {dealAccess, organizationAccess, STAFF} from './domain'
import type {CrmState} from './model'
import type {UsageGate} from './metered-execution'

export type SummaryFact = {kind: 'deal' | 'company' | 'contact' | 'proposal' | 'interaction', id: string, revision: number, label: string, text: string}
export type SummaryProvider = {summarize(input: {facts: SummaryFact[], signal: AbortSignal}): Promise<{text: string, nextAction: string}>}
export type SummaryResult = {owner: string, orgId: string, dealId: string, revision: number, text: string, nextAction: string,
    sources: Omit<SummaryFact, 'text'>[], demo: boolean}

// AI history carries status only. Current authority ACL and source versions protect private output.
export function createCrmAssistant(deps: {directory?: string, provider?: SummaryProvider, timeoutMs?: number, usage?: UsageGate} = {}) {
    let store: Store<CrmState> | null = null
    const pending = new Map<string, {controller: AbortController, owner: string, orgId: string, id: string, revision: number}>()
    const journal = deps.directory ? openResults(deps.directory) : null
    const results: Record<string, SummaryResult> = journal?.initial ?? {}
    function current(account: string, orgId: string, id: string) {
        if (!store) throw new Error('Сервис закрыт')
        organizationAccess(store.state, account, orgId, STAFF)
        return dealAccess(store.state, account, orgId, id).deal
    }
    function facts(account: string, orgId: string, id: string) {
        const deal = current(account, orgId, id)
        const company = store!.state.companies[deal.companyId], contact = store!.state.contacts[deal.contactId]
        const proposal = deal.proposals.at(-1)
        const selected: SummaryFact[] = [{kind: 'deal', id: deal.id, revision: deal.revision, label: deal.title,
            text: [deal.title, deal.description, 'Этап: ' + deal.stage, 'Сумма в условных копейках: ' + deal.amount].join('\n')}]
        if (company) selected.push({kind: 'company', id: company.id, revision: company.revision, label: company.name, text: company.name + '\n' + company.domain})
        if (contact) selected.push({kind: 'contact', id: contact.id, revision: contact.revision, label: contact.name, text: contact.name})
        if (proposal) selected.push({kind: 'proposal', id: deal.id + ':' + proposal.version, revision: proposal.version, label: proposal.title, text: proposal.body.slice(0, 4000)})
        for (const entry of deal.interactions.slice(-4)) selected.push({kind: 'interaction', id: entry.id, revision: deal.revision, label: entry.private ? 'Внутренняя заметка' : 'Сообщение', text: entry.body})
        return selected
    }
    function validate(account: string, output: SummaryResult) {
        const deal = current(account, output.orgId, output.dealId)
        if (deal.revision != output.revision) throw new Error('Сделка изменилась. Подготовьте новую сводку')
        const selected = facts(account, output.orgId, output.dealId)
        if (output.sources.some(source => !selected.some(value => value.kind == source.kind && value.id == source.id && value.revision == source.revision))) throw new Error('Источник сводки изменился. Подготовьте новую сводку')
        return {...output, sources: output.sources.map(source => ({...source}))}
    }
    function result(account: string, runId: string) {
        const output = Object.hasOwn(results, runId) ? results[runId] : undefined
        if (!output || output.owner != account || host.store.state.runs[runId]?.state != 'completed') throw new Error('Результат недоступен')
        return validate(account, output)
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {orgId: string, id: string, revision: number}
        const deal = current(ctx.run.owner, input.orgId, input.id)
        if (deal.revision != input.revision) throw new Error('Сделка изменилась')
        const controller = new AbortController()
        pending.set(ctx.run.id, {controller, owner: ctx.run.owner, ...input})
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(deps.timeoutMs ?? 10000)])
        let offAbort = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Сбор фактов текущей сделки'})
            const selected = facts(ctx.run.owner, input.orgId, input.id)
            async function execute() {
                signal.throwIfAborted()
                const interrupted = new Promise<never>(function interrupt(_resolve, reject) {
                    function abort() {reject(signal.reason ?? new Error('Подготовка отменена'))}
                    signal.addEventListener('abort', abort, {once: true})
                    offAbort = () => signal.removeEventListener('abort', abort)
                })
                return Promise.race([deps.provider ? deps.provider.summarize({facts: selected, signal}) : Promise.resolve({
                    text: ('Факты для проверки:\n\n' + selected.map(source => '[' + source.kind + ':' + source.id + '] ' + source.text).join('\n\n')).slice(0, 19000),
                    nextAction: deal.proposals.length ? 'Проверить последнюю версию предложения и согласовать следующий шаг с клиентом.' : 'Уточнить требования и подготовить черновик предложения.'
                }), interrupted])
            }
            const answer = deps.usage ? await deps.usage.run({orgId: input.orgId, eventId: 'crm-summary-' + ctx.run.id,
                metric: 'search', units: 1, reference: input.id, signal}, execute) : await execute()
            signal.throwIfAborted()
            if (ctx.cancelled()) return
            if (typeof answer.text != 'string' || !answer.text.trim() || answer.text.length > 20000 || typeof answer.nextAction != 'string' || !answer.nextAction.trim() || answer.nextAction.length > 2000) throw new Error('Неверный формат ответа помощника')
            if (current(ctx.run.owner, input.orgId, input.id).revision != input.revision) throw new Error('Сделка изменилась во время подготовки')
            const output: SummaryResult = {owner: ctx.run.owner, orgId: input.orgId, dealId: input.id, revision: input.revision,
                text: answer.text, nextAction: answer.nextAction, sources: selected.map(({text, ...source}) => source), demo: !deps.provider}
            results[ctx.run.id] = output
            validate(ctx.run.owner, output)
            journal?.save(results)
            ctx.report({progress: 1, message: 'Сводка готова. Следующий шаг требует решения сотрудника'})
            return {result: {available: true, demo: !deps.provider}}
        } catch {
            // Provider failures may contain prompt data. Do not put their raw error into public AI replay.
            throw new Error(signal.aborted ? 'Сводка прервана: отмена, изменение доступа/сделки или время ожидания' : 'Не удалось подготовить сводку. Проверьте актуальные данные и исполнителя')
        } finally {offAbort(); pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort(new Error('Подготовка отменена'))}}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'runs') : undefined}), runner, history: 5,
        capabilities: [{kind: 'summary', label: deps.provider ? 'Сводка сделки' : 'Тестовая сводка фактов'}],
        policy: {canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId?: unknown, id?: unknown, revision?: unknown} | null
                    if (request.kind != 'summary' || !input || typeof input.orgId != 'string' || typeof input.id != 'string' || !Number.isSafeInteger(input.revision)) return false
                    const deal = current(account, input.orgId, input.id)
                    if (deal.revision != input.revision || request.resourceIds?.length != 1 || request.resourceIds[0] != input.id) return false
                    const runs = Object.values(host.store.state.runs)
                    const active = runs.filter(run => ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state))
                    return runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 100 && active.length < 2 && !active.some(run => run.resourceIds[0] == input.id)
                } catch {return false}
            }}})
    for (const entry of host.recovery.pending()) host.recovery.settle(entry.run.id, {state: 'failed', error: 'Подготовка была прервана рестартом. Проверьте состояние перед новым запуском'})
    const resource = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        return {facade: {ai: connection.fragment, control: {
            result(runId: string) {ctx.signal.throwIfAborted(); return result(ctx.principal.account, runId)}
        }}, close: connection.close}
    }}
    function mount(state: Store<CrmState>) {
        store = state
        const off = state.on(function changed() {
            for (const input of pending.values()) {
                try {if (current(input.owner, input.orgId, input.id).revision != input.revision) input.controller.abort(new Error('Сделка изменилась'))}
                catch {input.controller.abort(new Error('Доступ отозван'))}
            }
        })
        return function close() {off(); for (const input of pending.values()) input.controller.abort(new Error('Сервис закрыт')); host.close(); store = null}
    }
    return {resource, mount}
}

function openResults(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'results.replay')
    const storage = openFsReplayStorage<[Record<string, SummaryResult>]>(file)
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, SummaryResult>) {
        storage.putKeyframe({seq: Date.now(), ts: Date.now(), event: [value]})
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
