import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, STAGES, emptyColumns, type CrmState, type Deal, type Company, type Contact, type tRole, type tStage} from './model'

type Ctx = ServiceCommandCtx<CrmState>
export const STAFF = ['owner', 'lead', 'manager'] as const
const leaders = ['owner', 'lead'] as const
export function crmRoles(state: CrmState, account: string) {
    if (!Object.hasOwn(state.accounts, account)) return []
    return [...new Set(['account', ...Object.values(state.organizations).flatMap(org => Object.hasOwn(org.members, account) ? [org.members[account]] : [])])]
}
export function organizationAccess(state: CrmState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = Object.hasOwn(state.organizations, orgId) ? state.organizations[orgId] : undefined
    const role = org && Object.hasOwn(org.members, account) ? org.members[account] : undefined
    const known = Object.hasOwn(state.accounts, account)
    const allowed = !!role && roles.includes(role)
    if (!known || !org || !allowed) throw new Error('Нет доступа к организации')
    return {org, role}
}
export function dealAccess(state: CrmState, account: string, orgId: string, id: string, options: {edit?: boolean, archived?: boolean} = {}) {
    const access = organizationAccess(state, account, orgId)
    const deal = Object.hasOwn(state.deals, id) ? state.deals[id] : undefined
    const live = !!deal && deal.orgId == orgId && (!deal.archived || options.archived)
    const mine = access.role != 'customer' || deal?.customerAccount == account
    if (!live || !mine) throw new Error('Сделка недоступна')
    const ownDeal = access.role != 'manager' || deal.assignee == account
    const editor = access.role != 'customer' && ownDeal
    if (options.edit && !editor) throw new Error('Редактировать может ответственный менеджер или руководитель')
    return {...access, deal}
}
function revision(value: {revision: number}, expected: number) {
    if (!Number.isSafeInteger(expected) || value.revision != expected) throw new Error('Запись уже изменена. Откройте свежую версию')
}
function text(value: string, max: number, required = true) {
    const clean = value.trim()
    if ((required && !clean) || clean.length > max) throw new Error('Текст должен содержать ' + (required ? '1' : '0') + '–' + max + ' символов')
    return clean
}
function amount(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) throw new Error('Сумма — целое число от 0 до 100000000 условных копеек')
}
function operation(ctx: Ctx, kind: string) {
    return kind + '-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId)).digest('hex')
}
function linked<T extends Company | Contact>(records: Record<string, T>, id: string, orgId: string) {
    const value = Object.hasOwn(records, id) ? records[id] : undefined
    if (!value || value.orgId != orgId || value.archived) throw new Error('Связанная запись недоступна или архивирована')
    return value
}
function summary(deal: Deal) {
    const {interactions, draft, proposals, decisions, ...entry} = deal
    const proposal = proposals.at(-1)
    return {...entry, proposalVersion: proposal?.version ?? 0, proposalDecision: decisions.find(value => value.version == proposal?.version)?.decision ?? null}
}
// Клиент видит сотрудников и себя, но не других клиентов организации.
function visibleMembers(state: CrmState, org: {id: string, role: string}, account: string) {
    return Object.entries(state.organizations[org.id].members).filter(function shown([id, role]) {
        return org.role != 'customer' || id == account || role != 'customer'
    })
}

function leads(organizations: {id: string, role: string}[], orgId: string) {
    const org = organizations.find(item => item.id == orgId)
    return !!org && leaders.includes(org.role as typeof leaders[number])
}

// Клиенту не показываем контактные данные сотрудников сделки.
function contactFor(contact: Contact | null | undefined, role: string) {
    if (!contact) return null
    if (role == 'customer') return {...contact, email: '', phone: ''}
    return {...contact}
}

export function crmWorkspace(state: CrmState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const known = Object.hasOwn(state.accounts, account)
    const member = Object.values(state.organizations).filter(org => known && Object.hasOwn(org.members, account))
    const organizations = member.map(function shown(org) {
        return {id: org.id, name: org.name, revision: org.revision, role: org.members[account]}
    })
    const staffOrgs = new Set(organizations.filter(org => org.role != 'customer').map(org => org.id))
    const visible = Object.values(state.deals).filter(function shown(deal) {
        const org = organizations.find(item => item.id == deal.orgId)
        if (!org) return false
        return org.role != 'customer' || deal.customerAccount == account
    })
    const ids = new Set(visible.filter(deal => !deal.archived).map(deal => deal.id))
    return {
        me: Object.hasOwn(state.accounts, account) ? {account, name: state.accounts[account].name} : null,
        organizations,
        people: organizations.flatMap(org => visibleMembers(state, org, account).map(([id, role]) => ({
            orgId: org.id, account: id, name: state.accounts[id]?.name ?? id, role
        }))),
        companies: Object.values(state.companies).filter(company => staffOrgs.has(company.orgId)).map(value => ({...value})),
        contacts: Object.values(state.contacts).filter(contact => staffOrgs.has(contact.orgId)).map(value => ({...value})),
        deals: visible.map(summary),
        columns: organizations.map(org => ({
            orgId: org.id, stages: STAGES.map(key => ({key, items: (state.columns[org.id]?.[key] ?? []).filter(id => ids.has(id))}))
        })),
        audit: state.audit.filter(entry => leads(organizations, entry.orgId)).map(entry => ({
            ...entry
        }))
    }
}
export type CrmWorkspace = ReturnType<typeof crmWorkspace>
export function crmDetail(state: CrmState, account: string, orgId: string, id: string) {
    const {deal, role} = dealAccess(state, account, orgId, id, {archived: true})
    const company = state.companies[deal.companyId], contact = state.contacts[deal.contactId]
    return {deal: {...summary(deal), draft: role == 'customer' || !deal.draft ? null : {...deal.draft},
        interactions: deal.interactions.filter(entry => role != 'customer' || !entry.private).map(entry => ({...entry})),
        proposals: deal.proposals.map(entry => ({...entry})), decisions: deal.decisions.map(entry => ({...entry}))},
        company: company ? {...company} : null,
        contact: contactFor(contact, role)}
}

export function createCrmDomain(deps: {now?: () => number, accepted?: (ctx: Ctx, deal: Deal, version: number) => void} = {}) {
    const now = deps.now ?? Date.now
    function audit(ctx: Ctx, orgId: string, action: string, target: string) {
        ctx.state.audit.push({id: operation(ctx, 'audit'), orgId, actor: ctx.account, action, target, at: now()})
        if (ctx.state.audit.length > 1000) ctx.state.audit.splice(0, ctx.state.audit.length - 1000)
    }
    function changed(ctx: Ctx, deal: Deal, action: string) {
        deal.revision++
        deal.updatedAt = now()
        audit(ctx, deal.orgId, action, deal.id)
        return {id: deal.id, revision: deal.revision}
    }
    function editable(ctx: Ctx, input: {orgId: string, id: string, revision: number}) {
        const access = dealAccess(ctx.state, ctx.account, input.orgId, input.id, {edit: true})
        revision(access.deal, input.revision)
        return access
    }
    function assignee(state: CrmState, orgId: string, account: string) {organizationAccess(state, account, orgId, STAFF)}
    return {commands: {
        orgCreate: schemaCommand({name: 'string'}, {allow: ['account'], limit: {perMinute: 10}, apply(ctx: Ctx, input) {
            if (!Object.hasOwn(ctx.state.accounts, ctx.account)) throw new Error('Войдите в аккаунт')
            const name = text(input.name, 100)
            if (Object.keys(ctx.state.organizations).length >= 20) throw new Error('До 20 организаций на стенде')
            const id = operation(ctx, 'org')
            ctx.state.organizations[id] = {id, name, revision: 1, members: {[ctx.account]: 'owner'}}
            ctx.state.columns[id] = emptyColumns()
            audit(ctx, id, 'organization.created', id)
            return {id, revision: 1}
        }}),
        memberRole: schemaCommand({
            orgId: 'string', revision: 'number', account: 'string', role: {enum: ['none', ...ROLES]}
        }, {allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
            const {org} = organizationAccess(ctx.state, ctx.account, input.orgId, ['owner'])
            revision(org, input.revision)
            if (!Object.hasOwn(ctx.state.accounts, input.account)) throw new Error('Аккаунт не найден')
            const old = Object.hasOwn(org.members, input.account) ? org.members[input.account] : undefined
            const owners = Object.values(org.members).filter(value => value == 'owner').length
            const lastOwner = old == 'owner' && input.role != 'owner' && owners <= 1
            if (lastOwner) throw new Error('Нельзя удалить последнего владельца')
            if (input.role == 'none') delete org.members[input.account]
            else org.members[input.account] = input.role
            org.revision++
            audit(ctx, org.id, 'member.' + input.role, input.account)
            return {id: org.id, revision: org.revision}
        }}),
        companySave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', name: 'string', domain: 'string'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, STAFF)
            const name = text(input.name, 120), domain = text(input.domain, 120, false).toLowerCase()
            if (domain && !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain)) throw new Error('Укажите домен без протокола и пути')
            const previous = input.id ? linked(ctx.state.companies, input.id, input.orgId) : null
            if (previous) revision(previous, input.revision)
            else if (input.revision != 0 || Object.keys(ctx.state.companies).length >= 1000) throw new Error('До 1000 компаний; новая запись с revision 0')
            function sameDomain(value: {orgId: string, domain: string, id: string}) {
                return value.orgId == input.orgId && value.domain == domain && value.id != input.id
            }
            if (domain && Object.values(ctx.state.companies).some(sameDomain)) {
                throw new Error('Компания с таким доменом уже существует, в том числе в архиве')
            }
            const id = previous?.id ?? operation(ctx, 'company'), next = (previous?.revision ?? 0) + 1
            ctx.state.companies[id] = {id, orgId: input.orgId, name, domain, archived: false, revision: next}
            audit(ctx, input.orgId, 'company.saved', id)
            return {id, revision: next}
        }}),
        contactSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', companyId: 'string',
            name: 'string', email: 'string', phone: 'string'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, STAFF)
            const name = text(input.name, 120), email = text(input.email, 160).toLowerCase(), phone = text(input.phone, 50, false)
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Некорректный email контакта')
            linked(ctx.state.companies, input.companyId, input.orgId)
            const previous = input.id ? linked(ctx.state.contacts, input.id, input.orgId) : null
            if (previous) {
                revision(previous, input.revision)
                const linked = Object.values(ctx.state.deals).some(deal => deal.contactId == previous.id)
                if (previous.companyId != input.companyId && linked) {
                    throw new Error('Контакт связан со сделками; смена компании запрещена')
                }
            } else if (input.revision != 0 || Object.keys(ctx.state.contacts).length >= 2000) throw new Error('До 2000 контактов; новая запись с revision 0')
            function sameEmail(value: {orgId: string, email: string, id: string}) {
                return value.orgId == input.orgId && value.email == email && value.id != input.id
            }
            if (Object.values(ctx.state.contacts).some(sameEmail)) {
                throw new Error('Контакт с таким email уже существует, в том числе в архиве')
            }
            const id = previous?.id ?? operation(ctx, 'contact'), next = (previous?.revision ?? 0) + 1
            ctx.state.contacts[id] = {id, orgId: input.orgId, companyId: input.companyId, name, email, phone, archived: false, revision: next}
            audit(ctx, input.orgId, 'contact.saved', id)
            return {id, revision: next}
        }}),
        dealSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', title: 'string',
            description: 'string', companyId: 'string', contactId: 'string',
            assignee: 'string', customerAccount: 'string', amount: 'number'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            const {role} = organizationAccess(ctx.state, ctx.account, input.orgId, STAFF)
            const title = text(input.title, 160), description = text(input.description, 3000, false)
            amount(input.amount)
            linked(ctx.state.companies, input.companyId, input.orgId)
            const contact = linked(ctx.state.contacts, input.contactId, input.orgId)
            if (contact.companyId != input.companyId) throw new Error('Контакт принадлежит другой компании')
            assignee(ctx.state, input.orgId, input.assignee)
            if (role == 'manager' && input.assignee != ctx.account) throw new Error('Назначать другого исполнителя может руководитель')
            if (input.customerAccount) organizationAccess(ctx.state, input.customerAccount, input.orgId, ['customer'])
            const previous = input.id ? editable(ctx, input).deal : null
            if (previous && (previous.stage == 'won' || previous.stage == 'lost')) throw new Error('Верните сделку в работу перед редактированием')
            const published = !!previous && previous.proposals.length > 0
            if (published && previous.customerAccount != input.customerAccount) {
                throw new Error('Нельзя менять клиента после публикации предложения')
            }
            if (!previous && (input.revision != 0 || Object.keys(ctx.state.deals).length >= 2000)) throw new Error('До 2000 сделок; новая запись с revision 0')
            const id = previous?.id ?? operation(ctx, 'deal'), at = now()
            if (previous) {
                Object.assign(previous, {
                    title, description, companyId: input.companyId, contactId: input.contactId,
                    assignee: input.assignee, customerAccount: input.customerAccount, amount: input.amount
                })
                return changed(ctx, previous, 'deal.saved')
            }
            ctx.state.deals[id] = {id, orgId: input.orgId, title, description, companyId: input.companyId, contactId: input.contactId,
                assignee: input.assignee, customerAccount: input.customerAccount, amount: input.amount, stage: 'incoming', archived: false,
                revision: 1, createdAt: at, updatedAt: at, createdBy: ctx.account, interactions: [], draft: null, proposals: [], decisions: []}
            ctx.state.columns[input.orgId].incoming.push(id)
            audit(ctx, input.orgId, 'deal.created', id)
            return {id, revision: 1}
        }}),
        dealMove: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number',
            stage: {enum: STAGES}, beforeId: 'string', reason: 'string'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            const {deal, role} = editable(ctx, input)
            const reason = text(input.reason, 500, false)
            const transitions: Record<tStage, readonly tStage[]> = {
                incoming: ['incoming', 'qualified', 'lost'],
                qualified: ['incoming', 'qualified', 'proposal', 'lost'],
                proposal: ['qualified', 'proposal', 'won', 'lost'],
                won: ['won', 'qualified'],
                lost: ['lost', 'qualified']
            }
            if (!transitions[deal.stage].includes(input.stage)) throw new Error('Переход между этапами недоступен')
            const closed = deal.stage == 'won' || deal.stage == 'lost'
            const reopening = closed && input.stage != deal.stage
            const permitted = leaders.includes(role as typeof leaders[number]) && !!reason
            if (reopening && !permitted) throw new Error('Вернуть закрытую сделку может руководитель с причиной')
            if (input.stage == 'lost' && !reason) throw new Error('Укажите причину отказа')
            if (input.stage == 'proposal' && !deal.proposals.length) throw new Error('Сначала опубликуйте предложение')
            function accepted(value: {version: number, decision: string}) {
                return value.version == deal.proposals.at(-1)?.version && value.decision == 'accept'
            }
            if (input.stage == 'won' && !deal.decisions.some(accepted)) {
                throw new Error('Клиент должен принять актуальную версию предложения')
            }
            const columns = ctx.state.columns[input.orgId]
            if (input.beforeId && (input.beforeId == deal.id || !columns[input.stage].includes(input.beforeId))) throw new Error('Порядок колонки изменился')
            if (reason && deal.interactions.length >= 200) throw new Error('До 200 взаимодействий в сделке')
            for (const stage of STAGES) columns[stage] = columns[stage].filter(id => id != deal.id)
            const target = columns[input.stage]
            target.splice(input.beforeId ? target.indexOf(input.beforeId) : target.length, 0, deal.id)
            deal.stage = input.stage
            if (reason) {
                deal.interactions.push({id: operation(ctx, 'transition'), author: ctx.account, body: reason, private: true, at: now()})
            }
            return changed(ctx, deal, 'deal.moved.' + input.stage)
        }}),
        interactionAdd: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', body: 'string', private: 'boolean'
        }, {allow: ROLES, apply(ctx: Ctx, input) {
            const {deal, role} = dealAccess(ctx.state, ctx.account, input.orgId, input.id)
            revision(deal, input.revision)
            if (role != 'customer') dealAccess(ctx.state, ctx.account, input.orgId, input.id, {edit: true})
            if (role == 'customer' && input.private) throw new Error('Клиенту доступны только публичные сообщения')
            const body = text(input.body, 3000)
            if (deal.interactions.length >= 200) throw new Error('До 200 взаимодействий в сделке')
            deal.interactions.push({id: operation(ctx, 'interaction'), author: ctx.account, body, private: input.private, at: now()})
            return changed(ctx, deal, input.private ? 'note.added' : 'message.added')
        }}),
        proposalSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number',
            title: 'string', body: 'string', amount: 'number'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            const {deal} = editable(ctx, input)
            const title = text(input.title, 160), body = text(input.body, 10000)
            amount(input.amount)
            if (deal.stage == 'won' || deal.stage == 'lost') throw new Error('Сделка закрыта')
            deal.draft = {title, body, amount: input.amount, updatedAt: now()}
            return changed(ctx, deal, 'proposal.draft')
        }}),
        proposalPublish: schemaCommand({orgId: 'string', id: 'string', revision: 'number'}, {allow: STAFF, apply(ctx: Ctx, input) {
            const {deal} = editable(ctx, input)
            const open = deal.stage != 'won' && deal.stage != 'lost'
            if (!deal.draft || !deal.customerAccount || !open) throw new Error('Нужны черновик, клиент и открытая сделка')
            organizationAccess(ctx.state, deal.customerAccount, input.orgId, ['customer'])
            if (deal.proposals.length >= 20) throw new Error('До 20 опубликованных версий предложения')
            const version = (deal.proposals.at(-1)?.version ?? 0) + 1
            deal.proposals.push({...deal.draft, version, publishedAt: now(), publishedBy: ctx.account})
            deal.draft = null
            return {...changed(ctx, deal, 'proposal.published'), version}
        }}),
        proposalRespond: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', version: 'number',
            decision: {enum: ['accept', 'changes']}, body: 'string'
        }, {allow: ['customer'], apply(ctx: Ctx, input) {
            const {deal, role} = dealAccess(ctx.state, ctx.account, input.orgId, input.id)
            revision(deal, input.revision)
            if (role != 'customer' || deal.customerAccount != ctx.account) throw new Error('Ответить может клиент этой сделки')
            if (deal.stage == 'won' || deal.stage == 'lost') throw new Error('Сделка закрыта')
            const latest = deal.proposals.at(-1)?.version == input.version
            if (!Number.isSafeInteger(input.version) || !latest) throw new Error('Предложение уже заменено новой версией')
            if (deal.decisions.some(value => value.version == input.version)) throw new Error('Ответ на эту версию уже зафиксирован')
            const body = text(input.body, 2000, input.decision == 'changes')
            if (input.decision == 'accept') deps.accepted?.(ctx, deal, input.version)
            deal.decisions.push({version: input.version, decision: input.decision, body, account: ctx.account, at: now()})
            return changed(ctx, deal, 'proposal.' + input.decision)
        }}),
        archiveRecord: schemaCommand({
            orgId: 'string', kind: {enum: ['company', 'contact', 'deal']},
            id: 'string', revision: 'number', archived: 'boolean'
        }, {allow: STAFF, apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, input.kind == 'deal' ? STAFF : leaders)
            type Archivable = {id: string, orgId: string, archived: boolean, revision: number}
            let table = ctx.state.contacts as Record<string, Archivable>
            if (input.kind == 'deal') table = ctx.state.deals
            else if (input.kind == 'company') table = ctx.state.companies
            const entry = Object.hasOwn(table, input.id) ? table[input.id] : undefined
            if (!entry || entry.orgId != input.orgId) throw new Error('Запись недоступна')
            revision(entry, input.revision)
            if (input.kind == 'deal') dealAccess(ctx.state, ctx.account, input.orgId, input.id, {edit: true, archived: true})
            const liveContacts = Object.values(ctx.state.contacts).some(function inCompany(contact) {
                return contact.companyId == input.id && !contact.archived
            })
            const liveDeals = Object.values(ctx.state.deals).some(function inCompany(deal) {
                return deal.companyId == input.id && !deal.archived
            })
            const blocked = liveContacts || liveDeals
            if (input.archived && input.kind == 'company' && blocked) {
                throw new Error('Сначала архивируйте связанные контакты и сделки')
            }
            const liveForContact = Object.values(ctx.state.deals).some(function onContact(deal) {
                return deal.contactId == input.id && !deal.archived
            })
            if (input.archived && input.kind == 'contact' && liveForContact) {
                throw new Error('Сначала архивируйте связанные сделки')
            }
            if (!input.archived) {
                if (input.kind == 'contact') linked(ctx.state.companies, (entry as Contact).companyId, input.orgId)
                if (input.kind == 'deal') {
                    linked(ctx.state.companies, (entry as Deal).companyId, input.orgId)
                    linked(ctx.state.contacts, (entry as Deal).contactId, input.orgId)
                }
            }
            entry.archived = input.archived
            entry.revision++
            audit(ctx, input.orgId, input.kind + (input.archived ? '.archived' : '.restored'), entry.id)
            return {id: entry.id, revision: entry.revision}
        }}),
        batchAssign: schemaCommand({
            orgId: 'string', items: {array: {object: {id: 'string', revision: 'number'}}}, assignee: 'string'
        }, {allow: leaders, apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, leaders)
            const unique = new Set(input.items.map(item => item.id)).size == input.items.length
            const sized = input.items.length >= 1 && input.items.length <= 50
            if (!sized || !unique) throw new Error('Выберите от 1 до 50 разных сделок')
            assignee(ctx.state, input.orgId, input.assignee)
            const entries = input.items.map(item => editable(ctx, {...item, orgId: input.orgId}).deal)
            for (const deal of entries) {deal.assignee = input.assignee; changed(ctx, deal, 'deal.assigned')}
            return {items: entries.map(deal => ({id: deal.id, revision: deal.revision}))}
        }})
    }, views: {workspace: {allow: ROLES, project: crmWorkspace}}}
}
