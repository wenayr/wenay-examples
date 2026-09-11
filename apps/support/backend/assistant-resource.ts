import path from 'node:path'
import {mkdirSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import {openFsReplayStorage} from 'wenay-common2/server/fs'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {SupportState} from './model'
import {openAiCheckpoint} from './ai-checkpoint'
import type {UsageGate} from './metered-execution'
import {createArticleIndex} from './article-index'

export type Draft = {owner: string, orgId: string, ticketId: string, ticketRevision: number, text: string, sources: {id: string, title: string, revision: number}[], demo: boolean}
export type DraftProvider = {draft(input: {question: string, sources: {id: string, title: string, body: string}[], signal: AbortSignal}): Promise<{text: string}>}

// Private outputs are fetched through a current ACL check, never embedded in AI replay history.
export function createSupportAssistant(deps: {directory?: string, provider?: DraftProvider, timeoutMs?: number, usage?: UsageGate}) {
    const index = createArticleIndex()
    let state: Store<SupportState> | null = null
    const pending = new Map<string, AbortController>()
    const journal = deps.directory ? openDrafts(deps.directory) : null
    const drafts: Record<string, Draft> = journal?.initial ?? {}
    function ticket(account: string, orgId: string, ticketId: string) {
        const data = state?.state
        const role = data?.organizations[orgId]?.members[account]
        const found = data?.tickets[ticketId]
        if (!data || !role || role == 'customer' || !found || found.orgId != orgId) throw new Error('Нет доступа к обращению или работе помощника')
        return found
    }
    function sources(account: string, orgId: string, query: string) {
        const role = state?.state.organizations[orgId]?.members[account]
        if (!role || role == 'customer') throw new Error('Нет доступа к поиску помощника')
        if (typeof query != 'string' || query.length > 8000) throw new Error('Слишком большой поисковый запрос')
        return index.search(account, orgId, query)
    }
    function result(account: string, runId: string) {
        const draft = drafts[runId]
        if (!draft || draft.owner != account) throw new Error('Результат недоступен')
        if (ticket(account, draft.orgId, draft.ticketId).revision != draft.ticketRevision) throw new Error('Обращение изменилось. Подготовьте новый черновик')
        for (const source of draft.sources) {
            const article = state!.state.articles[source.id]
            if (!article || article.orgId != draft.orgId || article.status != 'published' || article.revision != source.revision) throw new Error('Источник изменён или закрыт. Подготовьте новый черновик')
        }
        return {...draft, sources: draft.sources.map(source => ({...source}))}
    }
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {orgId: string, ticketId: string, revision: number}
        const item = ticket(ctx.run.owner, input.orgId, input.ticketId)
        if (item.revision != input.revision) throw new Error('Обращение изменилось. Откройте свежую версию')
        const controller = new AbortController()
        pending.set(ctx.run.id, controller)
        const timeout = setTimeout(function expired() {controller.abort(new Error('Помощник не ответил вовремя'))}, deps.timeoutMs ?? 15000)
        let offAbort = () => {}
        try {
            ctx.report({progress: 0.2, message: 'Поиск опубликованных источников'})
            const question = (item.subject + '\n' + item.messages.filter(message => !message.private).slice(-4).map(message => message.body).join('\n')).slice(0, 8000)
            const selected = sources(ctx.run.owner, input.orgId, question)
            if (!selected.length) throw new Error('Подходящих источников нет. Нужен ответ специалиста')
            async function execute() {
                controller.signal.throwIfAborted()
                const aborted = new Promise<never>(function interruption(_resolve, reject) {
                    function abort() {reject(controller.signal.reason ?? new Error('Обработка отменена'))}
                    controller.signal.addEventListener('abort', abort, {once: true})
                    offAbort = () => controller.signal.removeEventListener('abort', abort)
                })
                return Promise.race([deps.provider ? deps.provider.draft({question, sources: selected, signal: controller.signal}) :
                    Promise.resolve({text: 'Материал для ответа:\n\n' + selected.map(source => source.body).join('\n\n')}), aborted])
            }
            const answer = deps.usage ? await deps.usage.run({orgId: input.orgId, eventId: 'support-' + ctx.run.id,
                metric: 'search', units: 1, reference: input.ticketId, signal: controller.signal}, execute) : await execute()
            controller.signal.throwIfAborted()
            if (ctx.cancelled()) return
            if (typeof answer.text != 'string' || !answer.text.trim() || answer.text.length > 12000) throw new Error('Проверьте формат ответа провайдера')
            ticket(ctx.run.owner, input.orgId, input.ticketId)
            drafts[ctx.run.id] = {owner: ctx.run.owner, orgId: input.orgId, ticketId: input.ticketId, ticketRevision: input.revision,
                text: answer.text, sources: selected.map(({id, title, revision}) => ({id, title, revision})), demo: !deps.provider}
            result(ctx.run.owner, ctx.run.id)
            journal?.save(drafts)
            ctx.report({progress: 1, message: 'Черновик готов для проверки. Клиенту ничего не отправлено'})
            return {result: {available: true, demo: !deps.provider}}
        } finally {clearTimeout(timeout); offAbort(); pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'runs') : undefined}), runner, history: 5,
        capabilities: [{kind: 'answer', label: deps.provider ? 'Подготовить ответ по источникам' : 'Тестовый исполнитель: выдержка из статей'}],
        policy: {
            canRead: (account, run) => run.owner == account,
            canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId?: unknown, ticketId?: unknown, revision?: unknown} | null
                    if (request.kind != 'answer' || !input || typeof input.orgId != 'string' || typeof input.ticketId != 'string' || !Number.isSafeInteger(input.revision)) return false
                    ticket(account, input.orgId, input.ticketId)
                    if (request.resourceIds?.length != 1 || request.resourceIds[0] != input.ticketId) return false
                    const runs = Object.values(host.store.state.runs)
                    return runs.some(run => run.owner == account && run.requestId == request.requestId) || runs.length < 100 && !runs.some(run => run.owner == account && ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state))
                } catch {return false}
            }
        }})
    const resource = {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        function active() {ctx.signal.throwIfAborted(); if (!state) throw new Error('Сервис закрыт')}
        return {facade: {ai: connection.fragment, control: {
            sources(orgId: string, query: string) {active(); return sources(ctx.principal.account, orgId, query)},
            result(runId: string) {active(); return result(ctx.principal.account, runId)}
        }}, close: connection.close}
    }}
    function mount(store: Store<SupportState>) {
        state = store
        const closeIndex = index.mount(store)
        const off = store.on(function revokePending() {
            for (const [id, controller] of pending) {
                const run = host.store.state.runs[id]
                const found = store.state.tickets[run.resourceIds[0]]
                try {ticket(run.owner, found?.orgId ?? '', found?.id ?? '')} catch {controller.abort()}
            }
        })
        return function close() {off(); closeIndex(); for (const controller of pending.values()) controller.abort(); host.close(); state = null}
    }
    return {resource, mount, search: index.search}
}

function openDrafts(directory: string) {
    mkdirSync(directory, {recursive: true})
    const file = path.join(directory, 'drafts.replay')
    const storage = openFsReplayStorage<[Record<string, Draft>]>(file)
    return {initial: storage.getKeyframe()?.event[0] ?? {}, save(value: Record<string, Draft>) {
        storage.putKeyframe({seq: Date.now(), ts: Date.now(), event: [value]})
        const fd = openSync(file, 'r+')
        try {fsyncSync(fd)} finally {closeSync(fd)}
    }}
}
