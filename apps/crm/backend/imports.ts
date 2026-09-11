import {createHash} from 'node:crypto'
import path from 'node:path'
import {schemaCommand, type ServiceCommandCtx, type ServiceResourceContext, type tServicePrincipal} from 'wenay-common2/service'
import type {tClientCommands} from 'wenay-common2/service/client'
import {createAiRunHost, type AiRunRunner} from 'wenay-common2/ai'
import type {Store} from 'wenay-common2/observe'
import {parseCsv, validateTable, type ParsedTable} from './csv-table'
import {createCrmDomain, crmRoles, organizationAccess, STAFF} from './domain'
import type {CrmState} from './model'
import {openAiCheckpoint} from './ai-checkpoint'

export type ImportJob = {id: string, orgId: string, owner: string, companyId: string, name: string, table: ParsedTable,
    mapping: {name: string, email: string, phone: string}, revision: number, createdAt: number,
    status: 'preview' | 'running' | 'completed' | 'cancelled' | 'uncertain', runId: string,
    rows: {index: number, status: 'pending' | 'imported' | 'duplicate' | 'invalid', error: string, contactId: string}[]}
type Ctx = ServiceCommandCtx<CrmState>
function internal(ctx: Ctx) {if (ctx.account != 'system') throw new Error('Внутренняя операция')}
function jobAccess(state: CrmState, account: string, orgId: string, id: string) {
    const {role} = organizationAccess(state, account, orgId, STAFF)
    const job = Object.hasOwn(state.imports ?? {}, id) ? state.imports![id] : undefined
    if (!job || job.orgId != orgId || role == 'manager' && job.owner != account) throw new Error('Импорт недоступен')
    return job
}
function mapping(job: ImportJob, input: ImportJob['mapping']) {
    if (!job.table.headers.includes(input.name) || !job.table.headers.includes(input.email) || input.name == input.email || input.phone && !job.table.headers.includes(input.phone)) throw new Error('Сопоставьте имя, email и необязательный телефон с колонками CSV')
    return {name: input.name, email: input.email, phone: input.phone}
}
export function importView(state: CrmState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    return {imports: Object.values(state.imports ?? {}).flatMap(job => {
        try {
            jobAccess(state, account, job.orgId, job.id)
            return [{id: job.id, orgId: job.orgId, owner: job.owner, companyId: job.companyId, name: job.name, revision: job.revision, status: job.status,
                total: job.rows.length, imported: job.rows.filter(row => row.status == 'imported').length, errors: job.rows.filter(row => row.status == 'invalid').length, duplicate: job.rows.filter(row => row.status == 'duplicate').length}]
        } catch {return []}
    })}
}
export type ImportView = ReturnType<typeof importView>

export function createImportDomain() {
    const contacts = createCrmDomain().commands.contactSave
    return {commands: {
        importCreate: schemaCommand({id: 'string', orgId: 'string', actor: 'string', companyId: 'string', name: 'string', headers: {array: 'string'}, rows: {array: {array: 'string'}}}, {allow: ['system'], apply(ctx: Ctx, input) {
            internal(ctx)
            organizationAccess(ctx.state, input.actor, input.orgId, STAFF)
            const company = ctx.state.companies[input.companyId]
            if (!company || company.orgId != input.orgId || company.archived) throw new Error('Компания недоступна')
            if (!/^[a-f0-9]{64}$/.test(input.id) || !input.name || input.name.length > 160) throw new Error('Некорректный импорт')
            const old = ctx.state.imports?.[input.id]
            if (old) {jobAccess(ctx.state, input.actor, input.orgId, input.id); return {id: old.id, revision: old.revision}}
            if (Object.keys(ctx.state.imports ?? {}).length >= 20) throw new Error('До 20 сохранённых импортов в примере')
            const table = validateTable(input)
            const header = (names: string[]) => table.headers.find(value => names.includes(value.toLowerCase())) ?? ''
            ctx.state.imports ??= {}
            ctx.state.imports[input.id] = {id: input.id, orgId: input.orgId, owner: input.actor, companyId: input.companyId, name: input.name, table,
                mapping: {name: header(['name', 'имя']), email: header(['email', 'почта']), phone: header(['phone', 'телефон'])},
                revision: 1, createdAt: Date.now(), status: 'preview', runId: '', rows: table.rows.map((_, index) => ({index, status: 'pending', error: '', contactId: ''}))}
            return {id: input.id, revision: 1}
        }}),
        importMap: schemaCommand({orgId: 'string', id: 'string', revision: 'number', name: 'string', email: 'string', phone: 'string'}, {allow: STAFF, apply(ctx: Ctx, input) {
            const job = jobAccess(ctx.state, ctx.account, input.orgId, input.id)
            if (job.status != 'preview' || job.revision != input.revision) throw new Error('Сопоставление уже зафиксировано или изменено')
            job.mapping = mapping(job, input)
            job.revision++
            return {id: job.id, revision: job.revision}
        }}),
        importBegin: schemaCommand({orgId: 'string', id: 'string', actor: 'string', revision: 'number', runId: 'string'}, {allow: ['system'], apply(ctx: Ctx, input) {
            internal(ctx)
            const job = jobAccess(ctx.state, input.actor, input.orgId, input.id)
            if (!['preview', 'cancelled', 'uncertain'].includes(job.status) || job.revision != input.revision) throw new Error('Импорт уже изменён или выполняется')
            mapping(job, job.mapping)
            job.status = 'running'; job.runId = input.runId; job.revision++
            return {id: job.id, revision: job.revision}
        }}),
        importRow: schemaCommand({orgId: 'string', id: 'string', actor: 'string', runId: 'string', index: 'number'}, {allow: ['system'], apply(ctx: Ctx, input) {
            internal(ctx)
            const job = jobAccess(ctx.state, input.actor, input.orgId, input.id)
            if (job.status != 'running' || job.runId != input.runId) throw new Error('Попытка импорта уже закрыта')
            if (!Number.isInteger(input.index) || input.index < 0 || input.index >= job.rows.length) throw new Error('Строка недоступна')
            const row = job.rows[input.index]
            if (row.status != 'pending') return {status: row.status, contactId: row.contactId}
            const value = (column: string) => column ? job.table.rows[input.index][job.table.headers.indexOf(column)]?.trim() ?? '' : ''
            const email = value(job.mapping.email).toLowerCase()
            const previous = Object.values(ctx.state.contacts).find(contact => contact.orgId == job.orgId && contact.email == email)
            if (previous) {row.status = 'duplicate'; row.contactId = previous.id; row.error = 'Контакт с таким email уже существует'}
            else {
                try {
                    const result = contacts.apply({...ctx, account: job.owner, roles: crmRoles(ctx.state, job.owner), requestId: 'import-' + job.id + '-' + input.index},
                        {orgId: job.orgId, id: '', revision: 0, companyId: job.companyId, name: value(job.mapping.name), email, phone: value(job.mapping.phone)})
                    row.status = 'imported'; row.contactId = result.id
                } catch (error) {row.status = 'invalid'; row.error = error instanceof Error ? error.message : 'Строка отклонена'}
            }
            job.revision++
            return {status: row.status, contactId: row.contactId}
        }}),
        importFinish: schemaCommand({orgId: 'string', id: 'string', actor: 'string', runId: 'string', status: {enum: ['completed', 'cancelled', 'uncertain']}}, {allow: ['system'], apply(ctx: Ctx, input) {
            internal(ctx)
            const job = ctx.state.imports?.[input.id]
            if (!job || job.orgId != input.orgId || job.owner != input.actor || job.runId != input.runId || job.status != 'running') return {changed: false}
            if (input.status == 'completed' && job.rows.some(row => row.status == 'pending')) throw new Error('Не все строки обработаны')
            job.status = input.status; job.revision++
            return {changed: true}
        }})
    }, views: {imports: {allow: STAFF, project: importView}}}
}
export type ImportExecutor = tClientCommands<{commands: ReturnType<typeof createImportDomain>['commands']}>

export function createCrmImports(deps: {directory?: string} = {}) {
    let store: Store<CrmState> | null = null, execute: ImportExecutor | null = null
    let ready: Promise<void> = Promise.resolve()
    const runner: AiRunRunner = {async run(ctx) {
        await ready
        if (ctx.cancelled()) return
        const input = ctx.input as {orgId: string, importId: string, revision: number}
        if (!store || !execute) throw new Error('Импорт не подключён')
        await execute.importBegin(ctx.run.id + '-begin', {orgId: input.orgId, id: input.importId, actor: ctx.run.owner, revision: input.revision, runId: ctx.run.id})
        try {
            const total = store.state.imports![input.importId].rows.length
            for (let index = 0; index < total; index++) {
                if (ctx.cancelled()) return
                await execute.importRow(ctx.run.id + '-row-' + index, {orgId: input.orgId, id: input.importId, actor: ctx.run.owner, runId: ctx.run.id, index})
                ctx.report({progress: (index + 1) / Math.max(1, total), message: 'Проверено строк: ' + (index + 1) + ' из ' + total})
                await new Promise(resolve => setImmediate(resolve))
            }
            await execute.importFinish(ctx.run.id + '-finish', {orgId: input.orgId, id: input.importId, actor: ctx.run.owner, runId: ctx.run.id, status: 'completed'})
            return {result: {available: true}}
        } catch (error) {
            await execute?.importFinish(ctx.run.id + '-uncertain', {orgId: input.orgId, id: input.importId, actor: ctx.run.owner, runId: ctx.run.id, status: 'uncertain'})
            throw error
        }
    }, async cancel({run}) {
        const input = run.resourceIds[0], job = store?.state.imports?.[input]
        if (execute && job) await execute.importFinish(run.id + '-cancel', {orgId: job.orgId, id: job.id, actor: run.owner, runId: run.id, status: 'cancelled'})
    }}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory ? path.join(deps.directory, 'runs') : undefined}), runner,
        capabilities: [{kind: 'import', label: 'Импорт контактов из CSV'}], policy: {canRead: (account, run) => run.owner == account, canWrite: (account, run) => run.owner == account,
            canCreate(account, request) {
                try {
                    const input = request.input as {orgId: string, importId: string, revision: number}
                    if (!store || !input || request.kind != 'import' || request.resourceIds?.length != 1 || request.resourceIds[0] != input.importId) return false
                    const job = jobAccess(store.state, account, input.orgId, input.importId)
                    if (job.owner != account) return false
                    const runs = Object.values(host.store.state.runs)
                    if (runs.some(run => run.owner == account && run.requestId == request.requestId)) return true
                    return job.revision == input.revision && ['preview', 'cancelled', 'uncertain'].includes(job.status) && runs.length < 100 && !runs.some(run => ['queued', 'running'].includes(run.state))
                } catch {return false}
            }}})
    const resource = {allow: STAFF, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const connection = host.connection(ctx.principal.account)
        function active() {ctx.signal.throwIfAborted(); if (!store || !execute) throw new Error('Импорт закрыт')}
        return {facade: {ai: connection.fragment, control: {
            async upload(input: {orgId: string, companyId: string, name: string, bytes: Uint8Array}) {
                await ready; active()
                organizationAccess(store!.state, ctx.principal.account, input.orgId, STAFF)
                if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > 512 * 1024 || typeof input.name != 'string' || !/\.csv$/i.test(input.name) || input.name.length > 160) throw new Error('Загрузите CSV до 512 КиБ')
                const table = parseCsv(new TextDecoder('utf-8', {fatal: true}).decode(input.bytes))
                const id = createHash('sha256').update(JSON.stringify([ctx.principal.account, input.orgId, input.companyId, input.name])).update(input.bytes).digest('hex')
                const created = await execute!.importCreate('upload-' + id, {id, orgId: input.orgId, actor: ctx.principal.account, companyId: input.companyId, name: input.name, ...table})
                active(); jobAccess(store!.state, ctx.principal.account, input.orgId, id)
                return created
            },
            async detail(input: {orgId: string, id: string, revision: number}) {
                await ready; active()
                const job = jobAccess(store!.state, ctx.principal.account, input.orgId, input.id)
                if (job.revision != input.revision) throw new Error('Импорт изменился')
                return {...job, table: validateTable(job.table), mapping: {...job.mapping}, rows: job.rows.map(row => ({...row}))}
            }
        }}, close: connection.close}
    }}
    return {resource, mount(input: {store: Store<CrmState>, execute: ImportExecutor}) {
        store = input.store; execute = input.execute
        ready = (async function recover() {
            for (const job of Object.values(store!.state.imports ?? {})) if (job.status == 'running') await execute!.importFinish(job.runId + '-recover', {orgId: job.orgId, id: job.id, actor: job.owner, runId: job.runId, status: 'uncertain'})
        })()
        return function close() {host.close(); store = null; execute = null}
    }}
}
