import {createTaskCommands} from './task-domain'
import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand} from 'wenay-common2/service'
import type {ServiceCommandCtx, tServicePrincipal} from 'wenay-common2/service'
import {hashSecret, type tSecret} from '../backend/identity'
import {WORK_COLUMNS, type WorkState, type WorkTask, type WorkView, type Workload} from './model'
import {createCanvasCommands} from './canvas-domain'
import {emptyCanvas} from './canvas-model'
import {createProposalCommands} from './proposal-domain'

export type WorkHost = {accounts:Record<string,{account:string,name:string,phone:string,roles:string[],secret:tSecret}>,organizer:WorkState}

export function createOrganizer<S extends WorkHost>(deps:{staffRoles:readonly string[],roleOptions:{id:string,title:string}[],sources?:(state:S)=>{id:string,label:string}[],workload?:{allow:readonly string[],project:(state:S)=>Workload}}) {
    const staff = deps.staffRoles
    function manage(roles:readonly string[]) {return roles.includes('manager')||roles.includes('owner')}
    function isStaff(roles:readonly string[]) {return roles.some(role=>staff.includes(role))}
    const commands = {
        ...createCanvasCommands<S>({allow: staff}),
        ...createProposalCommands<S>({allow: staff}),
        ...createTaskCommands<S>(deps),
        workSavePerson:schemaCommand({account:'string',name:'string',position:'string',note:'string',roles:{array:'string'},password:'string'}, {
            allow:['manager','owner'],
            validate(input) {
                if (!/^[a-z][a-z0-9_-]{2,31}$/.test(input.account)||!input.name.trim()||input.name.length>100||input.position.length>100||input.note.length>1000) throw new Error('Проверьте логин, имя и длину полей сотрудника')
                if (!input.roles.length||input.roles.some(role=>!deps.roleOptions.some(option=>option.id==role))) throw new Error('Выберите допустимые роли сотрудника')
            },
            apply(ctx:ServiceCommandCtx<S>,input) {
                const existing = ctx.state.accounts[input.account]
                const owner = ctx.roles.includes('owner')
                const roles = [...new Set(input.roles)]
                if (!isStaff(roles)) throw new Error('В карточке нужна хотя бы одна роль сотрудника')
                if (existing && !isStaff(existing.roles)) throw new Error('Этот логин уже принадлежит другому аккаунту')
                if ((!existing || JSON.stringify([...roles].sort())!=JSON.stringify([...existing.roles].sort()))&&!owner) throw new Error('Создавать аккаунты и менять роли может владелец')
                if (existing?.account==ctx.account && existing.roles.includes('owner')&&!roles.includes('owner')) throw new Error('Нельзя снять собственную роль владельца')
                if (!existing) {
                    if (input.password.length<8||input.password.length>128) throw new Error('Для нового сотрудника нужен пароль от 8 до 128 символов')
                    ctx.state.accounts[input.account]={account:input.account,name:input.name.trim(),phone:'',roles,secret:hashSecret(input.password)}
                } else {existing.name=input.name.trim();existing.roles=roles}
                ctx.state.organizer.profiles[input.account]={position:input.position.trim(),note:input.note.trim()}
                return {account:input.account}
            },
        }),
    }
    const views = {work:{allow:staff,project(state:S,principal:tServicePrincipal|null):WorkView {
        const roles=state.accounts[principal?.account ?? '']?.roles ?? []
        const manager=manage(roles)
        const me=principal?.account ?? ''
        const tasks = Object.fromEntries(Object.entries(state.organizer.tasks).filter(([,task])=>manager||
            (task.automatic ? task.audience?.some(role=>roles.includes(role)) : task.assignee==me||task.createdBy==me)))
        return {tasks,canvas:state.organizer.canvas ?? emptyCanvas(),columns:WORK_COLUMNS.map(column=>({key:column.key,items:state.organizer.columns[column.key].filter(id=>!!tasks[id])})),me,manage:manager,owner:roles.includes('owner'),roleOptions:deps.roleOptions,
            sources:deps.sources?.(state) ?? [],
            ...(deps.workload && roles.some(role=>deps.workload!.allow.includes(role))?{workload:deps.workload.project(state)}:{}),
            people:Object.values(state.accounts).filter(person=>isStaff(person.roles)).map(person=>({account:person.account,name:person.name,roles:[...person.roles],position:state.organizer.profiles[person.account]?.position ?? '',note:manager?state.organizer.profiles[person.account]?.note ?? '':'',canManage:manage(person.roles)})),
        }
    }}}
    return {commands,views}
}

