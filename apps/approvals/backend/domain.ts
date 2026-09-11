import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, type ApprovalState, type Request, type Receipt} from './model'
import {validateAnswers} from './questions'
type Ctx = ServiceCommandCtx<ApprovalState>
const reviewers = ['owner', 'reviewer'] as const
function hash(value: string) {return createHash('sha256').update(value).digest('hex')}
export function organizationAccess(state: ApprovalState, account: string, orgId: string) {
    const org = Object.hasOwn(state.organizations, orgId) ? state.organizations[orgId] : undefined
    const role = org && Object.hasOwn(org.members, account) ? org.members[account] : undefined
    if (!org || !role || !Object.hasOwn(state.accounts, account)) throw new Error('Нет доступа к организации')
    return {org, role}
}
export function approvalRoles(state: ApprovalState, account: string) {
    return Object.hasOwn(state.accounts, account) ? [...new Set(['account', ...Object.values(state.organizations).flatMap(org => Object.hasOwn(org.members, account) ? [org.members[account]] : [])])] : []
}
export function approvalWorkspace(state: ApprovalState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const organizations = Object.values(state.organizations).flatMap(org => Object.hasOwn(org.members, account) ? [{id: org.id, name: org.name, revision: org.revision, role: org.members[account]}] : [])
    return {me: Object.hasOwn(state.accounts, account) ? {account, name: state.accounts[account].name} : null, organizations, fields: state.fields,
        requests: Object.values(state.requests).filter(row => organizations.some(org => org.id == row.orgId && (row.author == account || org.role != 'requester' && row.versions.length > 0))),
        people: organizations.filter(org => org.role == 'owner').flatMap(org => Object.entries(state.organizations[org.id].members).map(([account, role]) => ({orgId: org.id, account, role})))}
}
export type ApprovalWorkspace = ReturnType<typeof approvalWorkspace>
export function createApprovalDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    function request(ctx: Ctx, input: {orgId: string, id: string, revision: number}) {
        const row = Object.hasOwn(ctx.state.requests, input.id) ? ctx.state.requests[input.id] : undefined
        if (!row || row.orgId != input.orgId) throw new Error('Заявка недоступна')
        if (row.revision != input.revision) throw new Error('Заявка изменилась. Откройте свежую версию')
        return row
    }
    function result(row: Request): Receipt {return {id: row.id, revision: row.revision, status: row.status, version: row.versions.length}}
    function intent(ctx: Ctx, kind: string, input: {orgId: string, key: string}, apply: () => Receipt) {
        organizationAccess(ctx.state, ctx.account, input.orgId)
        if (!/^[\w:-]{8,120}$/.test(input.key)) throw new Error('Нужен ключ одного действия')
        const key = hash(JSON.stringify([ctx.account, input.key])), signature = hash(JSON.stringify([kind, input]))
        const previous = ctx.state.intents[key]
        if (previous) {if (previous.signature != signature) throw new Error('Ключ уже использован для другого действия'); return previous.result}
        if (Object.keys(ctx.state.intents).length >= 5000) throw new Error('Достигнут предел 5000 действий')
        const value = apply()
        ctx.state.intents[key] = {signature, result: value}
        return value
    }
    const keyInput = {orgId: 'string', id: 'string', revision: 'number', key: 'string'} as const
    return {commands: {
        requestSave: schemaCommand({...keyInput, title: 'string', answersJson: 'string'}, {allow: ROLES, apply(ctx: Ctx, input) {
            return intent(ctx, 'save', input, function save() {
                if (!input.title.trim() || input.title.length > 160 || Buffer.byteLength(input.answersJson) > 32768) throw new Error('Название до 160 символов, ответы до 32 KiB')
                const answers = validateAnswers({fields: ctx.state.fields}, JSON.parse(input.answersJson))
                const row = input.id ? request(ctx, input) : null
                if (row && (row.author != ctx.account || !['draft', 'changes', 'withdrawn'].includes(row.status))) throw new Error('Можно менять только свою заявку до отправки или после возврата/отзыва')
                if (!row && (input.revision != 0 || Object.keys(ctx.state.requests).length >= 1000)) throw new Error('До 1000 заявок, новая revision 0')
                const id = row?.id ?? 'req-' + hash(JSON.stringify([ctx.account, input.key]))
                if (row) {row.title = input.title.trim(); row.answers = answers; row.revision++; row.status = 'draft'; row.updatedAt = now()}
                else ctx.state.requests[id] = {id, orgId: input.orgId, author: ctx.account, revision: 1, title: input.title.trim(), answers, status: 'draft', versions: [], history: [], updatedAt: now()}
                return result(ctx.state.requests[id])
            })
        }}),
        requestSubmit: schemaCommand(keyInput, {allow: ROLES, apply(ctx: Ctx, input) {
            return intent(ctx, 'submit', input, function submit() {
                const row = request(ctx, input)
                if (row.author != ctx.account || !['draft', 'changes', 'withdrawn'].includes(row.status) || row.versions.length >= 20) throw new Error('Отправьте свой черновик; не более 20 версий')
                const answers = validateAnswers({fields: ctx.state.fields}, row.answers), version = row.versions.length + 1
                row.versions.push({version, title: row.title, answers, fields: ctx.state.fields.map(field => ({...field, choices: [...field.choices]})), at: now()})
                row.status = 'pending'; row.revision++; row.updatedAt = now()
                row.history.push({version, kind: 'submitted', actor: ctx.account, body: '', at: now()})
                return result(row)
            })
        }}),
        requestDecide: schemaCommand({...keyInput, version: 'number', decision: {enum: ['approved', 'changes', 'rejected']}, body: 'string'}, {allow: reviewers, apply(ctx: Ctx, input) {
            const {role} = organizationAccess(ctx.state, ctx.account, input.orgId)
            if (role == 'requester') throw new Error('Решение доступно проверяющему')
            return intent(ctx, 'decide', input, function decide() {
                const row = request(ctx, input)
                if (row.author == ctx.account) throw new Error('Свою заявку согласовать нельзя')
                if (row.status != 'pending' || row.versions.length != input.version) throw new Error('Эта версия уже не ожидает решения')
                if (input.body.length > 2000 || input.decision != 'approved' && !input.body.trim()) throw new Error('Объясните возврат или отказ; до 2000 символов')
                row.status = input.decision; row.revision++; row.updatedAt = now()
                row.history.push({version: input.version, kind: input.decision, actor: ctx.account, body: input.body.trim(), at: now()})
                return result(row)
            })
        }}),
        requestWithdraw: schemaCommand(keyInput, {allow: ROLES, apply(ctx: Ctx, input) {
            return intent(ctx, 'withdraw', input, function withdraw() {
                const row = request(ctx, input)
                if (row.author != ctx.account || row.status != 'pending') throw new Error('Можно отозвать только свою ожидающую заявку')
                row.status = 'withdrawn'; row.revision++; row.updatedAt = now()
                row.history.push({version: row.versions.length, kind: 'withdrawn', actor: ctx.account, body: '', at: now()})
                return result(row)
            })
        }}),
        memberRole: schemaCommand({orgId: 'string', revision: 'number', account: 'string', role: {enum: ['none', ...ROLES]}}, {allow: ['owner'], apply(ctx: Ctx, input) {
            const {org, role} = organizationAccess(ctx.state, ctx.account, input.orgId)
            if (role != 'owner' || org.revision != input.revision || !Object.hasOwn(ctx.state.accounts, input.account)) throw new Error('Нет доступа или состав команды изменился')
            if (org.members[input.account] == 'owner' && input.role != 'owner' && Object.values(org.members).filter(role => role == 'owner').length == 1) throw new Error('Нужен хотя бы один владелец')
            if (input.role == 'none') delete org.members[input.account]; else org.members[input.account] = input.role
            org.revision++
            return {revision: org.revision}
        }})
    }, views: {workspace: {allow: ROLES, project: approvalWorkspace}}}
}
