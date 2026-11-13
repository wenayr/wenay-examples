import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {createCrmService} from './service'
import {crmDetail, crmWorkspace, organizationAccess} from './domain'
import {ROLES, STAGES, type CrmState, type tStage} from './model'
import {createCrmImports, type ImportExecutor} from './imports'
import {createCrmAssistant, type SummaryProvider} from './assistant-resource'
import type {UsageGate} from './metered-execution'
import path from 'node:path'

type SearchInput = {
    query: string,
    offset: number,
    limit: number,
    stage: string,
    archived: boolean
}

// Страница поиска задаётся клиентом: проверяем текст, окно и фильтр по отдельности.
function validSearch(input: SearchInput) {
    if (typeof input.query != 'string' || input.query.length > 100) return false
    if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 2000) return false
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return false
    if (!['all', ...STAGES].includes(input.stage)) return false
    return typeof input.archived == 'boolean'
}

export function createCrmRuntime(deps: {now?: () => number, directory?: string, provider?: SummaryProvider, timeoutMs?: number, usage?: UsageGate} = {}) {
    const service = createCrmService(deps)
    const imports = createCrmImports(deps)
    const assistant = createCrmAssistant({...deps, directory: deps.directory ? path.join(deps.directory, 'assistant') : undefined})
    let store: Store<CrmState> | null = null
    const crm = {allow: ROLES, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        function state(orgId: string) {
            ctx.signal.throwIfAborted()
            if (!store) throw new Error('Сервис закрыт')
            organizationAccess(store.state, ctx.principal.account, orgId)
            return store.state
        }
        function detail(input: {orgId: string, id: string}) {return crmDetail(state(input.orgId), ctx.principal.account, input.orgId, input.id)}
        function search(input: {orgId: string, query: string, stage: tStage | 'all', offset: number, limit: number, archived: boolean}) {
            const current = state(input.orgId)
            if (!validSearch(input)) {
                throw new Error('Поиск: запрос до 100 символов, от 1 до 100 строк на странице')
            }
            const query = input.query.trim().toLowerCase()
            const visible = crmWorkspace(current, ctx.principal).deals.filter(function matching(deal) {
                if (deal.orgId != input.orgId || deal.archived != input.archived) return false
                if (input.stage != 'all' && deal.stage != input.stage) return false
                if (!query) return true
                return (deal.title + ' ' + deal.description).toLowerCase().includes(query)
            })
            const found = visible.sort(function order(a, b) {
                return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
            })
            const items = found.slice(input.offset, input.offset + input.limit)
            return {items, total: found.length, next: input.offset + items.length < found.length ? input.offset + items.length : null}
        }
        function exportData(input: {orgId: string, format: 'csv' | 'json'}) {
            const current = state(input.orgId)
            const entries = crmWorkspace(current, ctx.principal).deals.filter(deal => deal.orgId == input.orgId)
            if (input.format == 'json') return {name: 'crm-deals.json', mime: 'application/json', text: JSON.stringify(entries, null, 2)}
            if (input.format != 'csv') throw new Error('Доступны CSV и JSON')
            function cell(value: string | number) {
                const raw = String(value)
                const safe = typeof value == 'string' && /^[=+\-@\t\r\n]/.test(raw) ? "'" + raw : raw
                return '"' + safe.replace(/"/g, '""') + '"'
            }
            const header = ['id', 'title', 'stage', 'amountMinor', 'assignee', 'archived']
            const rows: (string | number)[][] = [header, ...entries.map(function line(deal) {
                const archived = deal.archived ? 'yes' : 'no'
                return [deal.id, deal.title, deal.stage, deal.amount, deal.assignee, archived]
            })]
            return {name: 'crm-deals.csv', mime: 'text/csv', text: rows.map(row => row.map(cell).join(',')).join('\r\n')}
        }
        return {facade: {control: {detail, search, export: exportData}}, close() {}}
    }}
    return {definition: {
        ...service.definition,
        resources: {crm, imports: imports.resource, assistant: assistant.resource}
    }, mount(deps: {store: Store<CrmState>, execute: ImportExecutor}) {
        store = deps.store
        const closeImports = imports.mount(deps)
        const closeAssistant = assistant.mount(deps.store)
        return function close() {
            closeAssistant()
            closeImports()
            store = null
        }
    }}
}
export type CrmDefinition = ReturnType<typeof createCrmRuntime>['definition']
