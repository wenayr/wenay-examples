import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {createAiRunHost, type AiRun, type AiRunRunner} from 'wenay-common2/ai'
import {buildInputValidate, type InferInput, type ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import type {SupportState} from './model'
import type {createArticleIndex} from './article-index'
import type {createMeteredExecution} from './metered-execution'
import {requireProductKey} from './product-credentials'
import {openAiCheckpoint} from './ai-checkpoint'

export type MachineSearchUsage = Pick<ReturnType<typeof createMeteredExecution>, 'settled'>
const requestShape = {orgId: 'string', query: 'string', limit: 'number', requestId: 'string'} as const
const referenceShape = {orgId: 'string', id: 'string'} as const
const validateRequest = buildInputValidate(requestShape)
const validateReference = buildInputValidate(referenceShape)
type SearchRequest = InferInput<typeof requestShape>
type Items = ReturnType<ReturnType<typeof createArticleIndex>['search']>
type Receipt = Awaited<ReturnType<MachineSearchUsage['settled']>>['receipt']
type SearchResult = {owner: string, orgId: string, items: Items, usageReceipt: Receipt | null}

export function createMachineSearch(deps: {
    directory?: string, now?: () => number, usage?: MachineSearchUsage, configuredUsage?: boolean,
    search: ReturnType<typeof createArticleIndex>['search'],
    limits?: {total?: number, active?: number, bytes?: number}
}) {
    const now = deps.now ?? Date.now
    const total = deps.limits?.total ?? 100, concurrent = deps.limits?.active ?? 2, bytes = deps.limits?.bytes ?? 256 * 1024
    if (![total, concurrent, bytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid machine search limits')
    let store: Store<SupportState> | null = null, generation = 0, disposed = false
    let ready = Promise.resolve()
    const pending = new Map<string, {controller: AbortController, owner: string, orgId: string, items: Items}>()
    function input(value: unknown): SearchRequest {
        validateRequest(value)
        const request = value as SearchRequest
        const valid = /^[\w.-]{1,100}$/.test(request.requestId) && request.orgId.length > 0 && request.orgId.length <= 100
        const query = request.query.trim() && request.query.length <= 2000
        const limit = Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= 10
        if (!valid || !query || !limit) {
            throw new Error('Search needs query up to2000/requestId up to100/limit1–10')
        }
        return request
    }
    function key(account: string, orgId: string) {
        if (!store || disposed) throw new Error('Machine search unavailable')
        return requireProductKey(store.state, account, orgId, now())
    }
    function sources(orgId: string, items: Items) {
        for (const item of items) {
            const current = store?.state.articles[item.id]
            const published = current && current.orgId == orgId && current.status == 'published'
            const version = current && current.revision == item.revision && current.title == item.title && current.body == item.body
            if (!published || !version) throw new Error('Search source changed or withdrawn')
        }
    }
    function size(value: unknown) {
        if (Buffer.byteLength(JSON.stringify(value), 'utf8') > bytes) throw new Error('Search result exceeds UTF8 envelope limit')
    }
    function result(run: AiRun, account: string, orgId: string) {
        const output = run.result as SearchResult | undefined
        const matching = output && output.owner == account && output.orgId == orgId
        const collection = output && Array.isArray(output.items) && output.items.length <= 10
        if (!matching || !collection) {
            throw new Error('Search result unavailable')
        }
        for (const item of output.items) if (typeof item.id != 'string' || typeof item.title != 'string' ||
            typeof item.body != 'string' || !Number.isSafeInteger(item.revision)) throw new Error('Invalid stored search item')
        const receipt = output.usageReceipt
        if (receipt == null) {
            if (receipt !== null || deps.configuredUsage || deps.usage) throw new Error('Configured search has no confirmed receipt')
        } else {
            const linked = receipt.orgId == orgId && receipt.eventId == 'support-search-' + run.id
            const committed = receipt.status == 'committed' && receipt.units == 1 && receipt.reservedUnits == 1
            const format = /^[a-f0-9]{64}$/.test(receipt.id) && /^\d{4}-(0[1-9]|1[0-2])$/.test(receipt.period) && typeof receipt.fresh == 'boolean'
            if (!linked || !committed || !format) throw new Error('Search receipt does not match run')
        }
        sources(orgId, output.items)
        size(output)
        return {owner: output.owner, orgId, items: output.items.map(item => ({...item})), usageReceipt: receipt ? {...receipt} : null}
    }
    const runner: AiRunRunner = {async run(ctx) {
        const request = input(ctx.input)
        const live = key(ctx.run.owner, request.orgId)
        const controller = new AbortController()
        const items = deps.search(ctx.run.owner, request.orgId, request.query, request.limit).map(item => ({...item}))
        sources(request.orgId, items)
        size({owner: ctx.run.owner, orgId: request.orgId, items, receiptBudget: 'x'.repeat(1024)})
        pending.set(ctx.run.id, {controller, owner: ctx.run.owner, orgId: request.orgId, items})
        const timer = setTimeout(() => controller.abort(new Error('Search expired or exceeded deadline')),
            Math.min(15000, Math.max(1, live.expiresAt - now())))
        const expiry = setInterval(function currentCredential() {
            try {key(ctx.run.owner, request.orgId)} catch (error) {controller.abort(error)}
        }, 100)
        function current() {
            controller.signal.throwIfAborted()
            key(ctx.run.owner, request.orgId)
            sources(request.orgId, items)
        }
        try {
            if (deps.configuredUsage && !deps.usage) throw new Error('Configured Metering needs settled adapter')
            async function execute() {
                current()
                return items
            }
            let receipt: Receipt | null = null
            if (deps.usage) receipt = (await deps.usage.settled({orgId: request.orgId, eventId: 'support-search-' + ctx.run.id,
                metric: 'search', reference: request.requestId, units: 1, signal: controller.signal}, execute)).receipt
            current()
            if (ctx.cancelled()) throw new Error('Search cancelled after operation')
            const output: SearchResult = {owner: ctx.run.owner, orgId: request.orgId, items, usageReceipt: receipt}
            size(output)
            return {result: output}
        } finally {clearTimeout(timer)
        clearInterval(expiry)
        pending.delete(ctx.run.id)}
    }, cancel({run}) {pending.get(run.id)?.controller.abort(new Error('Search job cancelled'))}}
    const checkpoint = openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'machine-search') : undefined})
    for (const [id, run] of Object.entries(checkpoint.initial?.store.runs ?? {})) {
        try {
            const request = checkpoint.initial?.requests[id]
            if (!request) throw new Error('Saved request missing')
            const value = input(request.input)
            const identity = run.id == id && run.owner.startsWith('product:') && run.requestId == value.requestId
            const kind = run.kind == 'publishedSearch' && request.kind == run.kind && request.requestId == run.requestId
            const scoped = run.resourceIds.length == 1 && run.resourceIds[0] == value.orgId
            const target = request.resourceIds?.length == 1 && request.resourceIds[0] == value.orgId
            const consistent = identity && kind && scoped && target
            if (!consistent) throw new Error('Saved request target mismatch')
        } catch {throw new Error('Invalid saved machine search request')}
    }
    const host = createAiRunHost({...checkpoint,
        runner, id: randomUUID, capabilities: [{kind: 'publishedSearch'}], policy: {
            canRead: (account, run) => account == run.owner,
            canWrite: (account, run) => account == run.owner,
            canCreate(account, request) {
                try {
                    const value = input(request.input)
                    return account.startsWith('product:') && request.kind == 'publishedSearch' &&
                        request.requestId == value.requestId && request.resourceIds?.length == 1 && request.resourceIds[0] == value.orgId
                } catch {return false}
            }
        }})
    const resource = {allow: ['knowledge:search'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const opened = generation
        let closed = false
        const connection = host.connection(ctx.principal.account)
        function active(orgId: string) {
            ctx.signal.throwIfAborted()
            if (closed || opened != generation) throw new Error('Search resource closed')
            key(ctx.principal.account, orgId)
        }
        function target(orgId: string, id: string) {
            active(orgId)
            const run = host.store.state.runs[id]
            const owned = run && run.owner == ctx.principal.account
            const scoped = run && run.kind == 'publishedSearch' && run.resourceIds[0] == orgId
            if (!owned || !scoped) {
                throw new Error('Search job unavailable')
            }
            return run
        }
        async function start(value: SearchRequest) {
            value = Object.freeze({...input(value)})
            active(value.orgId)
            if (deps.configuredUsage && !deps.usage) throw new Error('Configured Metering needs settled adapter')
            await ready
            active(value.orgId)
            const runs = Object.values(host.store.state.runs)
            const repeat = runs.some(run => run.owner == ctx.principal.account && run.requestId == value.requestId)
            if (!repeat && (runs.length >= total || runs.filter(run => ['queued', 'running'].includes(run.state)).length >= concurrent)) {
                throw new Error('Search job capacity reached')
            }
            const run = connection.fragment.createRun({requestId: value.requestId, kind: 'publishedSearch', input: value, resourceIds: [value.orgId]})
            target(value.orgId, run.id)
            return {id: run.id, state: run.state}
        }
        async function status(value: InferInput<typeof referenceShape>) {
            validateReference(value)
            value = Object.freeze({...value})
            active(value.orgId)
            await ready
            const run = target(value.orgId, value.id)
            const output = run.state == 'completed' ? result(run, ctx.principal.account, value.orgId) : undefined
            active(value.orgId)
            return {id: run.id, state: run.state, error: run.error, ...(output ? {usageReceipt: output.usageReceipt} : {})}
        }
        async function read(value: InferInput<typeof referenceShape>) {
            validateReference(value)
            value = Object.freeze({...value})
            active(value.orgId)
            await ready
            const run = target(value.orgId, value.id)
            if (run.state != 'completed') throw new Error('Search has no confirmed result')
            const output = result(run, ctx.principal.account, value.orgId)
            active(value.orgId)
            return output
        }
        return {facade: {control: {start, status, result: read}}, close() {
            closed = true
            connection.close()
        }}
    }}
    function mount(value: Store<SupportState>) {
        if (store || disposed) throw new Error('Search mount cannot be reused')
        store = value
        generation++
        ready = Promise.resolve().then(function reconcile() {
            for (const recovery of host.recovery.pending()) host.recovery.settle(recovery.run.id,
                {state: 'failed', error: 'Unresolved after restart; accepted search is never automatically rerun'})
        })
        void ready.catch(function observed() {})
        const off = value.on(function revokePending() {
            for (const job of pending.values()) {
                try {
                    key(job.owner, job.orgId)
                    sources(job.orgId, job.items)
                } catch (error) {job.controller.abort(error)}
            }
        })
        return function close() {
            if (disposed) return
            disposed = true
            generation++
            off()
            for (const job of pending.values()) job.controller.abort(new Error('Search host closed'))
            host.close()
            store = null
        }
    }
    return {resource, mount}
}
