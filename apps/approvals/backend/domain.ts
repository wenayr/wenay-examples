import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, type ApprovalState, type Request, type Receipt} from './model'
import {validateAnswers} from './questions'

type Ctx = ServiceCommandCtx<ApprovalState>
const reviewers = ['owner', 'reviewer'] as const
const editable = ['draft', 'changes', 'withdrawn']
const MAX_VERSIONS = 20
const MAX_REQUESTS = 1000
const MAX_INTENTS = 5000

function hash(value: string) {
    return createHash('sha256').update(value).digest('hex')
}

// ===== Доступ и проекция =====

export function organizationAccess(state: ApprovalState, account: string, orgId: string) {
    const org = Object.hasOwn(state.organizations, orgId) ? state.organizations[orgId] : undefined
    const role = org && Object.hasOwn(org.members, account) ? org.members[account] : undefined
    const known = Object.hasOwn(state.accounts, account)
    if (!org || !role || !known) throw new Error('Нет доступа к организации')
    return {org, role}
}

export function approvalRoles(state: ApprovalState, account: string) {
    if (!Object.hasOwn(state.accounts, account)) return []
    const memberships = Object.values(state.organizations)
    const held = memberships.filter(org => Object.hasOwn(org.members, account)).map(org => org.members[account])
    return [...new Set(['account', ...held])]
}

export function approvalWorkspace(state: ApprovalState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const member = Object.values(state.organizations).filter(org => Object.hasOwn(org.members, account))
    const organizations = member.map(org => ({id: org.id, name: org.name, revision: org.revision, role: org.members[account]}))

    // Автор видит свои заявки; проверяющий и владелец — только отправленные версии команды.
    function visible(row: Request) {
        const org = organizations.find(item => item.id == row.orgId)
        if (!org) return false
        if (row.author == account) return true
        return org.role != 'requester' && row.versions.length > 0
    }
    // Состав команды показывается только владельцу этой организации.
    function team(org: {id: string}) {
        const members = Object.entries(state.organizations[org.id].members)
        return members.map(([member, role]) => ({orgId: org.id, account: member, role}))
    }

    const me = Object.hasOwn(state.accounts, account) ? {account, name: state.accounts[account].name} : null
    return {
        me,
        organizations,
        fields: state.fields,
        requests: Object.values(state.requests).filter(visible),
        people: organizations.filter(org => org.role == 'owner').flatMap(team)
    }
}

export type ApprovalWorkspace = ReturnType<typeof approvalWorkspace>

// ===== Команды =====

export function createApprovalDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now

    function request(ctx: Ctx, input: {orgId: string, id: string, revision: number}) {
        const row = Object.hasOwn(ctx.state.requests, input.id) ? ctx.state.requests[input.id] : undefined
        if (!row || row.orgId != input.orgId) throw new Error('Заявка недоступна')
        if (row.revision != input.revision) throw new Error('Заявка изменилась. Откройте свежую версию')
        return row
    }

    function result(row: Request): Receipt {
        return {id: row.id, revision: row.revision, status: row.status, version: row.versions.length}
    }

    // Ключ намерения принадлежит приложению и дополняет receipt библиотеки:
    // одно действие пользователя может прийти разными командами после повтора.
    function intent(ctx: Ctx, kind: string, input: {orgId: string, key: string}, apply: () => Receipt) {
        organizationAccess(ctx.state, ctx.account, input.orgId)
        if (!/^[\w:-]{8,120}$/.test(input.key)) throw new Error('Нужен ключ одного действия')
        const key = hash(JSON.stringify([ctx.account, input.key]))
        const signature = hash(JSON.stringify([kind, input]))
        const previous = ctx.state.intents[key]
        if (previous) {
            if (previous.signature != signature) throw new Error('Ключ уже использован для другого действия')
            return previous.result
        }
        if (Object.keys(ctx.state.intents).length >= MAX_INTENTS) throw new Error('Достигнут предел 5000 действий')
        const value = apply()
        ctx.state.intents[key] = {signature, result: value}
        return value
    }

    const keyInput = {orgId: 'string', id: 'string', revision: 'number', key: 'string'} as const
    const decisionInput = {...keyInput, version: 'number', decision: {enum: ['approved', 'changes', 'rejected']}, body: 'string'} as const
    const roleInput = {orgId: 'string', revision: 'number', account: 'string', role: {enum: ['none', ...ROLES]}} as const

    const requestSave = schemaCommand({...keyInput, title: 'string', answersJson: 'string'}, {
        allow: ROLES,
        apply(ctx: Ctx, input) {
            return intent(ctx, 'save', input, function save() {
                const titled = input.title.trim() && input.title.length <= 160
                const small = Buffer.byteLength(input.answersJson) <= 32768
                if (!titled || !small) throw new Error('Название до 160 символов, ответы до 32 KiB')
                const answers = validateAnswers({fields: ctx.state.fields}, JSON.parse(input.answersJson))
                const row = input.id ? request(ctx, input) : null
                if (row && (row.author != ctx.account || !editable.includes(row.status))) {
                    throw new Error('Можно менять только свою заявку до отправки или после возврата/отзыва')
                }
                if (!row && (input.revision != 0 || Object.keys(ctx.state.requests).length >= MAX_REQUESTS)) {
                    throw new Error('До 1000 заявок, новая revision 0')
                }
                if (row) {
                    row.title = input.title.trim()
                    row.answers = answers
                    row.revision++
                    row.status = 'draft'
                    row.updatedAt = now()
                    return result(row)
                }
                const id = 'req-' + hash(JSON.stringify([ctx.account, input.key]))
                ctx.state.requests[id] = {
                    id, orgId: input.orgId, author: ctx.account, revision: 1, title: input.title.trim(),
                    answers, status: 'draft', versions: [], history: [], updatedAt: now()
                }
                return result(ctx.state.requests[id])
            })
        }
    })

    const requestSubmit = schemaCommand(keyInput, {
        allow: ROLES,
        apply(ctx: Ctx, input) {
            return intent(ctx, 'submit', input, function submit() {
                const row = request(ctx, input)
                const own = row.author == ctx.account && editable.includes(row.status)
                if (!own || row.versions.length >= MAX_VERSIONS) throw new Error('Отправьте свой черновик; не более 20 версий')
                const answers = validateAnswers({fields: ctx.state.fields}, row.answers)
                const version = row.versions.length + 1
                // Версия хранит собственную копию анкеты: решение относится к тому, что видел автор.
                const fields = ctx.state.fields.map(field => ({...field, choices: [...field.choices]}))
                row.versions.push({version, title: row.title, answers, fields, at: now()})
                row.status = 'pending'
                row.revision++
                row.updatedAt = now()
                row.history.push({version, kind: 'submitted', actor: ctx.account, body: '', at: now()})
                return result(row)
            })
        }
    })

    const requestDecide = schemaCommand(decisionInput, {
        allow: reviewers,
        apply(ctx: Ctx, input) {
            const {role} = organizationAccess(ctx.state, ctx.account, input.orgId)
            if (role == 'requester') throw new Error('Решение доступно проверяющему')
            return intent(ctx, 'decide', input, function decide() {
                const row = request(ctx, input)
                if (row.author == ctx.account) throw new Error('Свою заявку согласовать нельзя')
                const awaiting = row.status == 'pending' && row.versions.length == input.version
                if (!awaiting) throw new Error('Эта версия уже не ожидает решения')
                const explained = input.decision == 'approved' || input.body.trim()
                if (input.body.length > 2000 || !explained) throw new Error('Объясните возврат или отказ; до 2000 символов')
                row.status = input.decision
                row.revision++
                row.updatedAt = now()
                row.history.push({version: input.version, kind: input.decision, actor: ctx.account, body: input.body.trim(), at: now()})
                return result(row)
            })
        }
    })

    const requestWithdraw = schemaCommand(keyInput, {
        allow: ROLES,
        apply(ctx: Ctx, input) {
            return intent(ctx, 'withdraw', input, function withdraw() {
                const row = request(ctx, input)
                if (row.author != ctx.account || row.status != 'pending') {
                    throw new Error('Можно отозвать только свою ожидающую заявку')
                }
                row.status = 'withdrawn'
                row.revision++
                row.updatedAt = now()
                row.history.push({version: row.versions.length, kind: 'withdrawn', actor: ctx.account, body: '', at: now()})
                return result(row)
            })
        }
    })

    const memberRole = schemaCommand(roleInput, {
        allow: ['owner'],
        apply(ctx: Ctx, input) {
            const {org, role} = organizationAccess(ctx.state, ctx.account, input.orgId)
            const known = Object.hasOwn(ctx.state.accounts, input.account)
            if (role != 'owner' || org.revision != input.revision || !known) {
                throw new Error('Нет доступа или состав команды изменился')
            }
            const owners = Object.values(org.members).filter(member => member == 'owner').length
            const lastOwner = org.members[input.account] == 'owner' && input.role != 'owner' && owners == 1
            if (lastOwner) throw new Error('Нужен хотя бы один владелец')
            if (input.role == 'none') delete org.members[input.account]
            else org.members[input.account] = input.role
            org.revision++
            return {revision: org.revision}
        }
    })

    const commands = {requestSave, requestSubmit, requestDecide, requestWithdraw, memberRole}
    return {commands, views: {workspace: {allow: ROLES, project: approvalWorkspace}}}
}
