import {schemaCommand, type InferInput, type tInputSchema, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {createTaskCommands, type TaskHost} from '../organizer/task-domain'
import {WORK_COLUMNS, type TaskState, type WorkTask} from '../organizer/task-model'
import type {MonitoringState, Monitor} from './model'
import {organizationAccess} from './domain'
const STAFF = ['owner', 'oncall'] as const
type ScopedHost = TaskHost & {sources: {id: string, label: string, kind: 'incident'}[]}
function empty(): TaskState {return {tasks: {}, columns: {todo: [], doing: [], done: []}}}
function role(value: string) {return value == 'oncall' ? 'manager' : value}
export function taskBoards(state: MonitoringState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    return {boards: Object.values(state.organizations).flatMap(org => {
        if (!STAFF.includes(org.members[account] as typeof STAFF[number])) return []
        const work = state.workspaces?.[org.id] ?? empty()
        const staff = Object.entries(org.members).filter(([, role]) => role == 'owner' || role == 'oncall')
        const incidents = Object.values(state.incidents).filter(item => item.orgId == org.id)
        return [{
            orgId: org.id,
            me: account,
            manager: true,
            tasks: Object.values(work.tasks).map(function copy(task) {
                return {
                    ...task,
                    source: task.source ? {...task.source} : undefined,
                    checklist: task.checklist?.map(item => ({...item}))
                }
            }),
            columns: WORK_COLUMNS.map(column => ({...column, items: [...work.columns[column.key]]})),
            people: staff.map(([member]) => ({account: member, name: state.accounts[member]?.name ?? member})),
            sources: incidents.map(item => ({id: item.id, label: item.title}))
        }]
    })}
}
export type TaskBoards = ReturnType<typeof taskBoards>
export function createTenantOrganizer() {
    const commands = createTaskCommands<ScopedHost>({staffRoles: ['owner', 'manager'], sources: state => state.sources})
    function scope(ctx: ServiceCommandCtx<MonitoringState>, orgId: string) {
        const access = organizationAccess(ctx.state, ctx.account, orgId, STAFF)
        ctx.state.workspaces ??= {}
        ctx.state.workspaces[orgId] ??= empty()
        const members = Object.entries(access.org.members)
        const accounts = Object.fromEntries(members.map(function membership([member, value]) {
            return [member, {roles: [role(value)]}]
        }))
        const incidents = Object.values(ctx.state.incidents).filter(item => item.orgId == orgId)
        return {
            ...ctx,
            roles: [role(access.role)],
            state: {
                organizer: ctx.state.workspaces[orgId],
                accounts,
                sources: incidents.map(item => ({id: item.id, label: item.title, kind: 'incident' as const}))
            }
        }
    }
    type ScopedCommand<Sch extends tInputSchema, R> = {
        input: Sch,
        validate?: (input: InferInput<Sch>) => void,
        apply: (ctx: ServiceCommandCtx<ScopedHost>, input: InferInput<Sch>) => R
    }

    function scoped<const Sch extends tInputSchema, R>(command: ScopedCommand<Sch, R>) {
        return schemaCommand({...command.input, orgId: 'string'}, {allow: STAFF, apply(ctx: ServiceCommandCtx<MonitoringState>, input) {
            const {orgId, ...fields} = input as InferInput<Sch> & {orgId: string}
            const inner = scope(ctx, orgId)
            const data = fields as unknown as InferInput<Sch>
            command.validate?.(data)
            const full = Object.keys(inner.state.organizer.tasks).length >= 500
            if (full && 'id' in fields && !fields.id) throw new Error('До 500 задач организации')
            return command.apply(inner, data)
        }})
    }
    function incidentOpened(ctx: ServiceCommandCtx<MonitoringState>, monitor: Monitor, incidentId: string) {
        const work = ctx.state.workspaces?.[monitor.orgId]
        if (work?.tasks[incidentId]) return
        if (Object.keys(work?.tasks ?? {}).length >= 500) throw new Error('До 500 задач организации')
        const members = Object.entries(ctx.state.organizations[monitor.orgId].members)
        const assignee = members.find(([, role]) => role == 'oncall')?.[0] ?? members.find(([, role]) => role == 'owner')?.[0]
        if (!assignee) throw new Error('У инцидента должен быть ответственный')
        const description = 'Проверить факты и подтвердить восстановление.'
            + ' Автоматического действия в хостинге нет.'
        const task: WorkTask = {
            id: incidentId,
            title: monitor.name + ': проверить инцидент',
            description,
            assignee,
            createdBy: assignee,
            status: 'todo',
            priority: 'high',
            due: '',
            revision: 1,
            source: {id: incidentId, label: monitor.name, kind: 'incident'},
            checklist: [
                {title: 'Проверить факты инцидента', done: false},
                {title: 'Подтвердить восстановление', done: false}
            ]
        }
        ctx.state.workspaces ??= {}
        ctx.state.workspaces[monitor.orgId] ??= empty()
        ctx.state.workspaces[monitor.orgId].tasks[incidentId] = task
        ctx.state.workspaces[monitor.orgId].columns.todo.push(incidentId)
    }
    return {
        incidentOpened,
        commands: {
            workSaveTask: scoped(commands.workSaveTask),
            workCheckTask: scoped(commands.workCheckTask),
            workMoveTask: scoped(commands.workMoveTask)
        },
        views: {taskBoards: {allow: STAFF, project: taskBoards}}
    }
}
