import {createHash} from 'node:crypto'
import {schemaCommand, type InferInput, type tInputSchema, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {createTaskCommands, type TaskHost} from '../organizer/task-domain'
import {WORK_COLUMNS, type WorkTask, type TaskState} from '../organizer/task-model'
import {organizationAccess, dealAccess, STAFF} from './domain'
import type {CrmState, Deal} from './model'

type ScopedHost = TaskHost & {sources: {id: string, label: string, kind: 'deal'}[]}
function empty(): TaskState {return {tasks: {}, columns: {todo: [], doing: [], done: []}}}
// Роли CRM переводятся в роли доски задач: руководитель ведёт, менеджер исполняет.
function role(value: string) {
    if (value == 'lead') return 'manager'
    return value == 'manager' ? 'agent' : value
}
function taskId(deal: Deal, version: number) {return 'deal-task-' + createHash('sha256').update(JSON.stringify([deal.orgId, deal.id, version])).digest('hex')}

// В доску задач попадают только сотрудники организации, клиенты — нет.
function staffOf(org: {members: Record<string, string>}) {
    return Object.entries(org.members).filter(([, membership]) => membership != 'customer')
}

export function taskBoards(state: CrmState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    return {boards: Object.values(state.organizations).flatMap(function project(org) {
        const membership = Object.hasOwn(org.members, account) ? org.members[account] : undefined
        if (!membership || membership == 'customer' || !Object.hasOwn(state.accounts, account)) return []
        const manager = membership != 'manager'
        const work = state.workspaces?.[org.id] ?? empty()
        const tasks = Object.values(work.tasks).filter(task => manager || task.assignee == account || task.createdBy == account)
        const visible = new Set(tasks.map(task => task.id))
        return [{orgId: org.id, me: account, manager, tasks: tasks.map(task => ({
            ...task,
            source: task.source ? {...task.source} : undefined,
            checklist: task.checklist?.map(item => ({...item}))
        })),
            columns: WORK_COLUMNS.map(column => ({...column, items: work.columns[column.key].filter(id => visible.has(id))})),
            people: staffOf(org).map(([id]) => ({account: id, name: state.accounts[id]?.name ?? id})),
            sources: Object.values(state.deals).filter(deal => deal.orgId == org.id && !deal.archived).map(deal => ({id: deal.id, label: deal.title}))}]
    })}
}
export type TaskBoards = ReturnType<typeof taskBoards>

export function createTenantOrganizer() {
    const tasks = createTaskCommands<ScopedHost>({staffRoles: ['owner', 'manager', 'agent'], sources: state => state.sources})
    function scope(ctx: ServiceCommandCtx<CrmState>, orgId: string) {
        const access = organizationAccess(ctx.state, ctx.account, orgId, STAFF)
        ctx.state.workspaces ??= {}
        ctx.state.workspaces[orgId] ??= empty()
        const accounts = Object.fromEntries(Object.entries(access.org.members).map(([account, membership]) => [account, {roles: [role(membership)]}]))
        const live = Object.values(ctx.state.deals).filter(function open(deal) {
            return deal.orgId == orgId && !deal.archived
        })
        const sources = live.map(deal => ({id: deal.id, label: deal.title, kind: 'deal' as const}))
        return {...ctx, roles: [role(access.role)], state: {accounts, organizer: ctx.state.workspaces[orgId], sources}}
    }
    function accepted(ctx: ServiceCommandCtx<CrmState>, deal: Deal, version: number) {
        const id = taskId(deal, version)
        const existing = ctx.state.workspaces?.[deal.orgId]
        if (existing?.tasks[id]) return
        if (Object.keys(existing?.tasks ?? {}).length >= 500) throw new Error('До 500 задач организации; освободите место перед согласованием')
        organizationAccess(ctx.state, deal.assignee, deal.orgId, STAFF)
        const work = existing ?? empty()
        const description = 'Выполнить согласованное предложение, версия ' + version
            + '. Подробности находятся в карточке сделки.'
        const task: WorkTask = {id, title: deal.title, description,
            assignee: deal.assignee, createdBy: deal.assignee, status: 'todo', due: '', priority: 'normal', revision: 1,
            source: {kind: 'deal', id: deal.id, label: deal.title},
            checklist: [
                {title: 'Согласовать план работ', done: false},
                {title: 'Подтвердить результат с клиентом', done: false}
            ]
        }
        ctx.state.workspaces ??= {}
        if (!existing) ctx.state.workspaces[deal.orgId] = work
        ctx.state.workspaces[deal.orgId].tasks[id] = task
        ctx.state.workspaces[deal.orgId].columns.todo.push(id)
    }
    function scoped<const Sch extends tInputSchema, R>(command: {
        input: Sch,
        validate?: (input: InferInput<Sch>) => void,
        apply: (ctx: ServiceCommandCtx<ScopedHost>, input: InferInput<Sch>) => R
    }) {
        return schemaCommand({...command.input, orgId: 'string'}, {allow: STAFF, apply(ctx: ServiceCommandCtx<CrmState>, input) {
            const {orgId, ...fields} = input as InferInput<Sch> & {orgId: string}
            const inner = scope(ctx, orgId)
            const data = fields as unknown as InferInput<Sch>
            command.validate?.(data)
            if (Object.keys(inner.state.organizer.tasks).length >= 500 && 'id' in fields && !fields.id) throw new Error('До 500 задач организации')
            return command.apply(inner, data)
        }})
    }
    return {accepted, commands: {
        workSaveTask: scoped(tasks.workSaveTask), workCheckTask: scoped(tasks.workCheckTask), workMoveTask: scoped(tasks.workMoveTask),
        taskFromDeal: schemaCommand({orgId: 'string', id: 'string', revision: 'number'}, {allow: STAFF, apply(ctx: ServiceCommandCtx<CrmState>, input) {
            const {deal} = dealAccess(ctx.state, ctx.account, input.orgId, input.id, {edit: true})
            const version = deal.proposals.at(-1)?.version ?? 0
            const agreed = deal.decisions.some(function decision(entry) {
                return entry.version == version && entry.decision == 'accept'
            })
            if (!agreed) throw new Error('Сначала согласуйте предложение с клиентом')
            const id = taskId(deal, version)
            const previous = ctx.state.workspaces?.[input.orgId]?.tasks[id]
            if (previous) return {id, revision: previous.revision}
            if (deal.revision != input.revision) throw new Error('Сделка изменилась')
            accepted(ctx, deal, version)
            return {id, revision: 1}
        }})
    }, views: {taskBoards: {allow: STAFF, project: taskBoards}}}
}
