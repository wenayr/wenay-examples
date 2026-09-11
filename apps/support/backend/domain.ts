import {createHash, createHmac} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, STATUSES, PRIORITIES, type SupportState, type tRole, type Ticket, type Article, type AuditEntry} from './model'

const STAFF = ['owner', 'lead', 'agent'] as const
const MANAGERS = ['owner', 'lead'] as const
type Ctx = ServiceCommandCtx<SupportState>

function own<T>(values: Record<string, T>, key: string) {
    return Object.hasOwn(values, key) ? values[key] : undefined
}

export function supportRoles(state: SupportState, account: string) {
    if (!own(state.accounts, account)) return []
    return ['signedIn', ...new Set(Object.values(state.organizations).flatMap(org => own(org.members, account) ?? []))]
}

export function authorizeOrganization(state: SupportState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = own(state.organizations, orgId)
    const role = org && own(org.members, account)
    if (!own(state.accounts, account) || !org || !role || !roles.includes(role)) throw new Error('Нет доступа к этой организации')
    return {org, role}
}

export function workspaceView(state: SupportState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const current = own(state.accounts, account)
    const organizations = Object.values(state.organizations).flatMap(org => {
        const role = current && own(org.members, account)
        return role ? [{id: org.id, name: org.name, role, revision: org.revision}] : []
    })
    const roles = new Map(organizations.map(org => [org.id, org.role]))
    function staff(orgId: string) {return STAFF.includes(roles.get(orgId) as typeof STAFF[number])}
    function manage(orgId: string) {return MANAGERS.includes(roles.get(orgId) as typeof MANAGERS[number])}
    return {
        account: {account: current?.account ?? '', name: current?.name ?? ''},
        organizations,
        people: organizations.flatMap(org => Object.entries(state.organizations[org.id].members).flatMap(([id, role]) => {
            const person = own(state.accounts, id)
            return person && (staff(org.id) || id == account || role != 'customer') ? [{orgId: org.id, account: id, name: person.name, role}] : []
        })),
        tickets: Object.values(state.tickets).filter(ticket => roles.has(ticket.orgId) && (staff(ticket.orgId) || ticket.customer == account))
            .map(ticket => {
                const messages = ticket.messages.filter(message => staff(ticket.orgId) || !message.private)
                return {...ticket, messageCount: messages.length, messages: messages.slice(-20).map(message => ({...message}))}
            }),
        articles: Object.values(state.articles).filter(article => roles.has(article.orgId) && (staff(article.orgId) || article.status == 'published'))
            .map(article => ({...article, history: staff(article.orgId) ? (article.history ?? []).map(version => ({...version})) : []})),
        audit: state.audit.filter(entry => manage(entry.orgId)).map(entry => ({...entry})),
        invites: Object.values(state.invites).filter(invite => manage(invite.orgId)).map(({tokenHash, ...invite}) => invite)
    }
}

export type SupportWorkspace = ReturnType<typeof workspaceView>

export function searchWorkspace(state: SupportState, account: string, orgId: string, query: string) {
    authorizeOrganization(state, account, orgId)
    const view = workspaceView(state, {account, roles: supportRoles(state, account)})
    const needle = query.trim().slice(0, 200).toLocaleLowerCase()
    return {
        tickets: view.tickets.filter(ticket => ticket.orgId == orgId && [ticket.subject, ...state.tickets[ticket.id].messages.filter(message => view.organizations.find(org => org.id == orgId)?.role != 'customer' || !message.private).map(message => message.body)].some(text => text.toLocaleLowerCase().includes(needle))).slice(0, 50),
        articles: view.articles.filter(article => article.orgId == orgId && (article.title + '\n' + article.body).toLocaleLowerCase().includes(needle)).slice(0, 50)
    }
}

function text(value: string, label: string, maximum: number) {
    if (!value.trim() || value.length > maximum) throw new Error(label + ': от 1 до ' + maximum + ' символов')
    return value.trim()
}

function revision(entity: {revision: number}, expected: number) {
    if (!Number.isSafeInteger(expected) || expected != entity.revision) throw new Error('Карточка уже изменена. Обновите её и повторите действие')
}

function requestId(ctx: Ctx, prefix: string) {
    return prefix + '-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId)).digest('hex')
}

function bound(count: number, maximum: number, label: string) {
    if (count >= maximum) throw new Error('Достигнут лимит примера: ' + label + ' (' + maximum + ')')
}

function articleHistory(article: Article) {
    const {title, body, status, revision, updatedAt} = article
    return [...(article.history ?? []).map(version => ({...version})), {title, body, status, revision, updatedAt}].slice(-20)
}

export function createSupportDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    function audit(ctx: Ctx, orgId: string, action: string, target: string, at: number) {
        const entry: AuditEntry = {id: requestId(ctx, 'audit'), orgId, actor: ctx.account, action, target, at}
        ctx.state.audit.push(entry)
        const tenant = ctx.state.audit.filter(value => value.orgId == orgId)
        if (tenant.length > 1000) {
            const remove = new Set(tenant.slice(0, tenant.length - 1000).map(value => value.id))
            ctx.state.audit = ctx.state.audit.filter(value => !remove.has(value.id))
        }
    }
    function ticketFor(ctx: Ctx, input: {orgId: string, id: string, revision: number}, staffOnly = false) {
        const access = authorizeOrganization(ctx.state, ctx.account, input.orgId, staffOnly ? STAFF : ROLES)
        const ticket = own(ctx.state.tickets, input.id)
        if (!ticket || ticket.orgId != input.orgId || (access.role == 'customer' && ticket.customer != ctx.account)) throw new Error('Обращение недоступно')
        revision(ticket, input.revision)
        return {ticket, role: access.role}
    }
    function articleFor(ctx: Ctx, input: {orgId: string, id: string, revision: number}, roles: readonly string[]) {
        authorizeOrganization(ctx.state, ctx.account, input.orgId, roles)
        const article = own(ctx.state.articles, input.id)
        if (!article || article.orgId != input.orgId) throw new Error('Статья недоступна')
        revision(article, input.revision)
        return article
    }
    return {
        commands: {
            orgCreate: schemaCommand({name: 'string'}, {
                allow: ['signedIn'],
                apply(ctx: Ctx, input) {
                    if (!own(ctx.state.accounts, ctx.account)) throw new Error('Войдите в аккаунт')
                    const name = text(input.name, 'Название организации', 100)
                    bound(Object.values(ctx.state.organizations).filter(org => own(org.members, ctx.account) == 'owner').length, 8, 'организаций владельца')
                    bound(Object.keys(ctx.state.organizations).length, 64, 'организаций на стенде')
                    const id = requestId(ctx, 'org')
                    if (own(ctx.state.organizations, id)) throw new Error('Запрос создания уже использован')
                    ctx.state.organizations[id] = {id, name, revision: 1, members: {[ctx.account]: 'owner'}}
                    audit(ctx, id, 'org.create', id, now())
                    return {id, revision: 1}
                }
            }),
            inviteCreate: schemaCommand({orgId: 'string', role: {enum: ['lead', 'agent', 'customer']}, hours: 'number'}, {
                allow: MANAGERS,
                apply(ctx: Ctx, input) {
                    const {role} = authorizeOrganization(ctx.state, ctx.account, input.orgId, MANAGERS)
                    if (role == 'lead' && input.role == 'lead') throw new Error('Руководителя приглашает владелец')
                    if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 168) throw new Error('Приглашение действует от 1 до 168 часов')
                    const at = now()
                    const expired = Object.values(ctx.state.invites).filter(invite => invite.orgId == input.orgId && (invite.expiresAt <= at || invite.revoked || invite.usedBy))
                    const active = Object.values(ctx.state.invites).filter(invite => invite.orgId == input.orgId).length - expired.length
                    bound(active, 64, 'активных приглашений')
                    const id = requestId(ctx, 'invite')
                    if (own(ctx.state.invites, id)) throw new Error('Запрос приглашения уже использован')
                    // The token is unpredictable without account credentials, but stable for this authority operation.
                    const token = createHmac('sha256', ctx.state.accounts[ctx.account].secret.hash).update(id).digest('base64url')
                    for (const invite of expired) delete ctx.state.invites[invite.id]
                    const expiresAt = at + input.hours * 3600_000
                    ctx.state.invites[id] = {id, orgId: input.orgId, role: input.role, tokenHash: createHash('sha256').update(token).digest('hex'), createdBy: ctx.account, expiresAt, usedBy: '', revoked: false}
                    audit(ctx, input.orgId, 'invite.create', id, at)
                    return {id, token, expiresAt}
                }
            }),
            inviteAccept: schemaCommand({token: 'string'}, {
                allow: ['signedIn'],
                apply(ctx: Ctx, input) {
                    if (!own(ctx.state.accounts, ctx.account)) throw new Error('Войдите в аккаунт')
                    if (!/^[\w-]{43}$/.test(input.token)) throw new Error('Приглашение недоступно или истекло')
                    const tokenHash = createHash('sha256').update(input.token).digest('hex')
                    const invite = Object.values(ctx.state.invites).find(value => value.tokenHash == tokenHash)
                    const at = now()
                    if (!invite || invite.usedBy || invite.revoked || invite.expiresAt <= at) throw new Error('Приглашение недоступно или истекло')
                    const org = own(ctx.state.organizations, invite.orgId)
                    if (!org) throw new Error('Организация недоступна')
                    if (own(org.members, ctx.account)) throw new Error('Вы уже участник организации')
                    bound(Object.keys(org.members).length, 64, 'участников организации')
                    org.members[ctx.account] = invite.role
                    org.revision++
                    invite.usedBy = ctx.account
                    audit(ctx, org.id, 'invite.accept', ctx.account, at)
                    return {id: org.id, revision: org.revision}
                }
            }),
            inviteRevoke: schemaCommand({orgId: 'string', id: 'string'}, {
                allow: MANAGERS,
                apply(ctx: Ctx, input) {
                    const {role} = authorizeOrganization(ctx.state, ctx.account, input.orgId, MANAGERS)
                    const invite = own(ctx.state.invites, input.id)
                    if (!invite || invite.orgId != input.orgId) throw new Error('Приглашение недоступно')
                    if (role == 'lead' && invite.role == 'lead') throw new Error('Приглашением руководителя управляет владелец')
                    invite.revoked = true
                    audit(ctx, input.orgId, 'invite.revoke', input.id, now())
                    return {id: input.id}
                }
            }),
            memberRole: schemaCommand({orgId: 'string', account: 'string', role: {enum: ['owner', 'lead', 'agent', 'customer', 'revoked']}}, {
                allow: ['owner'],
                apply(ctx: Ctx, input) {
                    const {org} = authorizeOrganization(ctx.state, ctx.account, input.orgId, ['owner'])
                    const previous = own(org.members, input.account)
                    if (!previous) throw new Error('Участник недоступен')
                    if (previous == 'owner' && input.role != 'owner' && Object.values(org.members).filter(role => role == 'owner').length == 1) throw new Error('Нельзя удалить последнего владельца')
                    const at = now()
                    if (input.role == 'revoked') delete org.members[input.account]
                    else org.members[input.account] = input.role
                    org.revision++
                    for (const invite of Object.values(ctx.state.invites)) {
                        if (invite.orgId == org.id && invite.createdBy == input.account &&
                            (!MANAGERS.includes(input.role as typeof MANAGERS[number]) || (invite.role == 'lead' && input.role != 'owner'))) invite.revoked = true
                    }
                    if (input.role == 'revoked' || input.role == 'customer') {
                        for (const ticket of Object.values(ctx.state.tickets)) if (ticket.orgId == org.id && ticket.assignee == input.account) {
                            ticket.assignee = ''
                            ticket.revision++
                            ticket.updatedAt = at
                        }
                    }
                    audit(ctx, org.id, 'member.' + input.role, input.account, at)
                    return {id: org.id, revision: org.revision}
                }
            }),
            ticketCreate: schemaCommand({orgId: 'string', subject: 'string', body: 'string', priority: {enum: PRIORITIES}}, {
                allow: ROLES,
                apply(ctx: Ctx, input) {
                    authorizeOrganization(ctx.state, ctx.account, input.orgId)
                    const subject = text(input.subject, 'Тема', 180)
                    const body = text(input.body, 'Сообщение', 8000)
                    bound(Object.values(ctx.state.tickets).filter(ticket => ticket.orgId == input.orgId).length, 500, 'обращений организации')
                    const id = requestId(ctx, 'ticket')
                    if (own(ctx.state.tickets, id)) throw new Error('Запрос создания уже использован')
                    const at = now()
                    const hours = {normal: 24, high: 4, urgent: 1}[input.priority]
                    const ticket: Ticket = {id, orgId: input.orgId, customer: ctx.account, subject, priority: input.priority, status: 'open', assignee: '', revision: 1, createdAt: at, updatedAt: at, dueAt: at + hours * 3600_000, messages: [{id: requestId(ctx, 'message'), author: ctx.account, body, private: false, at}]}
                    ctx.state.tickets[id] = ticket
                    audit(ctx, input.orgId, 'ticket.create', id, at)
                    return {id, revision: ticket.revision}
                }
            }),
            ticketAssign: schemaCommand({orgId: 'string', id: 'string', revision: 'number', assignee: 'string'}, {
                allow: STAFF,
                apply(ctx: Ctx, input) {
                    const {ticket, role} = ticketFor(ctx, input, true)
                    if (role == 'agent' && (input.assignee != ctx.account || (ticket.assignee && ticket.assignee != ctx.account))) throw new Error('Оператор может взять только свободное обращение')
                    if (input.assignee) authorizeOrganization(ctx.state, input.assignee, input.orgId, STAFF)
                    ticket.assignee = input.assignee
                    ticket.revision++
                    ticket.updatedAt = now()
                    audit(ctx, input.orgId, 'ticket.assign', ticket.id, ticket.updatedAt)
                    return {id: ticket.id, revision: ticket.revision}
                }
            }),
            ticketReply: schemaCommand({orgId: 'string', id: 'string', revision: 'number', body: 'string', private: 'boolean'}, {
                allow: ROLES,
                apply(ctx: Ctx, input) {
                    const {ticket, role} = ticketFor(ctx, input)
                    if (input.private && role == 'customer') throw new Error('Внутренние заметки доступны сотрудникам')
                    const body = text(input.body, 'Сообщение', 8000)
                    bound(ticket.messages.length, 200, 'сообщений обращения')
                    const at = now()
                    const id = requestId(ctx, 'message')
                    if (ticket.messages.some(message => message.id == id)) throw new Error('Запрос сообщения уже использован')
                    ticket.messages.push({id, author: ctx.account, body, private: input.private, at})
                    if (!input.private) ticket.status = role == 'customer' ? 'open' : 'waiting'
                    if (!input.private && role != 'customer' && ticket.firstResponseAt == undefined) ticket.firstResponseAt = at
                    ticket.revision++
                    ticket.updatedAt = at
                    audit(ctx, input.orgId, input.private ? 'ticket.note' : 'ticket.reply', ticket.id, at)
                    return {id: ticket.id, revision: ticket.revision}
                }
            }),
            ticketDue: schemaCommand({orgId: 'string', id: 'string', revision: 'number', dueAt: 'number'}, {
                allow: STAFF,
                apply(ctx: Ctx, input) {
                    const {ticket} = ticketFor(ctx, input, true)
                    if (ticket.firstResponseAt != undefined) throw new Error('Первый ответ уже отправлен: его срок зафиксирован')
                    const at = now()
                    if (!Number.isSafeInteger(input.dueAt) || input.dueAt <= at || input.dueAt > at + 30 * 86400_000) throw new Error('Срок ответа должен быть в будущем, в пределах 30 дней')
                    ticket.dueAt = input.dueAt
                    ticket.revision++
                    ticket.updatedAt = at
                    audit(ctx, input.orgId, 'ticket.due', ticket.id, at)
                    return {id: ticket.id, revision: ticket.revision}
                }
            }),
            ticketStatus: schemaCommand({orgId: 'string', id: 'string', revision: 'number', status: {enum: STATUSES}, priority: {enum: PRIORITIES}}, {
                allow: ROLES,
                apply(ctx: Ctx, input) {
                    const {ticket, role} = ticketFor(ctx, input)
                    if (role == 'customer' && (input.status == 'waiting' || input.priority != ticket.priority)) throw new Error('Клиент может закрыть или переоткрыть своё обращение')
                    ticket.status = input.status
                    ticket.priority = input.priority
                    ticket.revision++
                    ticket.updatedAt = now()
                    audit(ctx, input.orgId, 'ticket.' + input.status, ticket.id, ticket.updatedAt)
                    return {id: ticket.id, revision: ticket.revision}
                }
            }),
            articleSave: schemaCommand({orgId: 'string', id: 'string', revision: 'number', title: 'string', body: 'string'}, {
                allow: STAFF,
                apply(ctx: Ctx, input) {
                    authorizeOrganization(ctx.state, ctx.account, input.orgId, STAFF)
                    const previous = input.id ? articleFor(ctx, input, STAFF) : undefined
                    if (!previous && input.revision != 0) throw new Error('Новая статья должна иметь ревизию 0')
                    const title = text(input.title, 'Заголовок', 180)
                    const body = text(input.body, 'Статья', 30000)
                    if (!previous) bound(Object.values(ctx.state.articles).filter(article => article.orgId == input.orgId).length, 200, 'статей организации')
                    const id = previous?.id ?? requestId(ctx, 'article')
                    if (!previous && own(ctx.state.articles, id)) throw new Error('Запрос создания уже использован')
                    const article: Article = {id, orgId: input.orgId, title, body, status: 'draft', revision: (previous?.revision ?? 0) + 1, updatedAt: now(), history: previous ? articleHistory(previous) : []}
                    ctx.state.articles[id] = article
                    audit(ctx, input.orgId, 'article.save', id, article.updatedAt)
                    return {id, revision: article.revision}
                }
            }),
            articlePublish: schemaCommand({orgId: 'string', id: 'string', revision: 'number', status: {enum: ['published', 'archived', 'draft']}}, {
                allow: MANAGERS,
                apply(ctx: Ctx, input) {
                    const article = articleFor(ctx, input, MANAGERS)
                    article.history = articleHistory(article)
                    article.status = input.status
                    article.revision++
                    article.updatedAt = now()
                    audit(ctx, input.orgId, 'article.' + input.status, article.id, article.updatedAt)
                    return {id: article.id, revision: article.revision}
                }
            }),
            articleRestore: schemaCommand({orgId: 'string', id: 'string', revision: 'number', version: 'number'}, {
                allow: MANAGERS,
                apply(ctx: Ctx, input) {
                    const article = articleFor(ctx, input, MANAGERS)
                    const selected = article.history?.find(value => value.revision == input.version)
                    if (!Number.isSafeInteger(input.version) || !selected) throw new Error('Версия недоступна в истории статьи')
                    const version = {...selected}
                    article.history = articleHistory(article)
                    article.title = version.title
                    article.body = version.body
                    article.status = 'draft'
                    article.revision++
                    article.updatedAt = now()
                    audit(ctx, input.orgId, 'article.restore.' + input.version, article.id, article.updatedAt)
                    return {id: article.id, revision: article.revision}
                }
            })
        },
        views: {workspace: {allow: ['signedIn'], project: workspaceView}}
    }
}
