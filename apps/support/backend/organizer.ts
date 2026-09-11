import {createHash} from 'node:crypto'
import {schemaCommand, type InferInput, type tInputSchema, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {createTaskCommands, type TaskHost} from '../organizer/task-domain'
import {WORK_COLUMNS, type WorkTask, type TaskState} from '../organizer/task-model'
import {authorizeOrganization} from './domain'
import type {SupportState} from './model'

const staff = ['owner', 'lead', 'agent'] as const
type ScopedHost = TaskHost & {sources: {id: string, label: string, kind: 'ticket'}[]}
function empty(): TaskState {return {tasks: {}, columns: {todo: [], doing: [], done: []}}}
function role(value: string) {return value == 'lead' ? 'manager' : value}

export function taskBoards(state: SupportState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    return {boards: Object.values(state.organizations).flatMap(function project(org) {
        const membership = Object.hasOwn(org.members, account) ? org.members[account] : undefined
        if (!membership || membership == 'customer' || !Object.hasOwn(state.accounts, account)) return []
        const manager = membership != 'agent'
        const work = state.workspaces?.[org.id] ?? empty()
        const tasks = Object.values(work.tasks).filter(task => manager || task.assignee == account || task.createdBy == account)
        const visible = new Set(tasks.map(task => task.id))
        return [{orgId: org.id, me: account, manager, tasks,
            columns: WORK_COLUMNS.map(column => ({...column, items: work.columns[column.key].filter(id => visible.has(id))})),
            people: Object.entries(org.members).filter(([, membership]) => membership != 'customer').map(([id]) => ({account: id, name: state.accounts[id]?.name ?? id})),
            sources: Object.values(state.tickets).filter(ticket => ticket.orgId == org.id).map(ticket => ({id: ticket.id, label: ticket.subject}))}]
    })}
}
export type TaskBoards = ReturnType<typeof taskBoards>

export function createTenantOrganizer() {
    const tasks = createTaskCommands<ScopedHost>({staffRoles: ['owner', 'manager', 'agent'], sources: state => state.sources})
    function scope(ctx: ServiceCommandCtx<SupportState>, orgId: string) {
        const access = authorizeOrganization(ctx.state, ctx.account, orgId, staff)
        ctx.state.workspaces ??= {}
        ctx.state.workspaces[orgId] ??= empty()
        const work = ctx.state.workspaces[orgId]
        const accounts = Object.fromEntries(Object.entries(access.org.members).map(([account, membership]) => [account, {roles: [role(membership)]}]))
        const sources = Object.values(ctx.state.tickets).filter(ticket => ticket.orgId == orgId).map(ticket => ({id: ticket.id, label: ticket.subject, kind: 'ticket' as const}))
        return {...ctx, roles: [role(access.role)], state: {accounts, organizer: work, sources}}
    }
    function scoped<const Sch extends tInputSchema, R>(command: {input: Sch, validate?: (input: InferInput<Sch>) => void, apply: (ctx: ServiceCommandCtx<ScopedHost>, input: InferInput<Sch>) => R}) {
        return schemaCommand({...command.input, orgId: 'string'}, {allow: staff,
            apply(ctx: ServiceCommandCtx<SupportState>, input) {
                const {orgId, ...fields} = input as InferInput<Sch> & {orgId: string}
                const inner = scope(ctx, orgId)
                const data = fields as unknown as InferInput<Sch>
                command.validate?.(data)
                if (Object.keys(inner.state.organizer.tasks).length >= 500 && 'id' in fields && !fields.id) throw new Error('Достигнут предел 500 задач организации')
                return command.apply(inner, data)
            }})
    }
    return {commands: {
        workSaveTask: scoped(tasks.workSaveTask), workCheckTask: scoped(tasks.workCheckTask), workMoveTask: scoped(tasks.workMoveTask),
        taskFromTicket: schemaCommand({orgId: 'string', ticketId: 'string', revision: 'number'}, {allow: staff,
            apply(ctx: ServiceCommandCtx<SupportState>, input) {
                const inner = scope(ctx, input.orgId)
                const ticket = Object.hasOwn(ctx.state.tickets, input.ticketId) ? ctx.state.tickets[input.ticketId] : undefined
                if (!ticket || ticket.orgId != input.orgId) throw new Error('Обращение недоступно')
                const id = 'ticket-task-' + createHash('sha256').update(JSON.stringify([input.orgId, input.ticketId])).digest('hex')
                const previous = inner.state.organizer.tasks[id]
                if (previous) return {id, revision: previous.revision}
                if (ticket.revision != input.revision) throw new Error('Обращение изменилось. Проверьте свежую версию')
                if (Object.keys(inner.state.organizer.tasks).length >= 500) throw new Error('Достигнут предел 500 задач организации')
                const task: WorkTask = {id, title: ticket.subject, description: 'Работа по обращению. Подробности доступны в исходной переписке.',
                    assignee: ctx.account, createdBy: ctx.account, status: 'todo', due: ticket.dueAt ? new Date(ticket.dueAt).toISOString().slice(0, 10) : '',
                    priority: ticket.priority == 'normal' ? 'normal' : 'high', revision: 1, checklist: [], source: {kind: 'ticket', id: ticket.id, label: ticket.subject}}
                inner.state.organizer.tasks[id] = task
                inner.state.organizer.columns.todo.push(id)
                return {id, revision: 1}
            }})
    }, views: {taskBoards: {allow: staff, project: taskBoards}}}
}
