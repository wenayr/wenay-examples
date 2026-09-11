import {validateTable} from './csv-table'
export {validateTable} from './csv-table'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, type DocumentState, type DocumentItem, type ParsedTable} from './model'
import {validateExtraction} from './model-extraction'

type Ctx = ServiceCommandCtx<DocumentState>
const REVIEW = ['owner', 'reviewer'] as const

function own<T>(values: Record<string, T>, id: string) {return Object.hasOwn(values, id) ? values[id] : undefined}

export function documentRoles(state: DocumentState, account: string) {
    return own(state.accounts, account) ? ['signedIn', ...new Set(Object.values(state.organizations).flatMap(org => own(org.members, account) ?? []))] : []
}

export function organizationAccess(state: DocumentState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = own(state.organizations, orgId)
    const role = org && own(org.members, account)
    const known = !!own(state.accounts, account)
    const allowed = !!role && roles.includes(role)
    if (!known || !org || !allowed) throw new Error('Нет доступа к организации')
    return {org, role}
}

export function documentAccess(state: DocumentState, account: string, orgId: string, id: string, roles: readonly string[] = ROLES) {
    const access = organizationAccess(state, account, orgId, roles)
    const document = own(state.documents, id)
    // Загрузчик видит только свои документы; остальные роли — все документы организации.
    const visible = !!document && document.orgId == orgId && document.status != 'deleted'
    const mine = access.role != 'uploader' || document?.owner == account
    if (!visible || !mine) throw new Error('Документ недоступен')
    return document
}

export function documentWorkspace(state: DocumentState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const person = own(state.accounts, account)
    const organizations = Object.values(state.organizations).flatMap(org => {
        const role = person && own(org.members, account)
        return role ? [{id: org.id, name: org.name, role}] : []
    })
    const roles = new Map(organizations.map(org => [org.id, org.role]))
    return {
        account: {account: person?.account ?? '', name: person?.name ?? ''}, organizations,
        people: organizations.flatMap(org => Object.entries(state.organizations[org.id].members).flatMap(([id, role]) => {
            const found = own(state.accounts, id)
            return found && (org.role != 'uploader' || id == account) ? [{orgId: org.id, account: id, name: found.name, role}] : []
        })),
        documents: Object.values(state.documents).filter(function visible(item) {
            if (!roles.has(item.orgId) || item.status == 'deleted') return false
            return roles.get(item.orgId) != 'uploader' || item.owner == account
        })
            .map(({table, comments, approvals, blobId, provenance, ...item}) => ({
                ...item, rowCount: table.rows.length, columnCount: table.headers.length, approvedRevision: approvals.at(-1)?.revision ?? 0
            })),
        audit: state.audit.filter(entry => roles.has(entry.orgId) && roles.get(entry.orgId) != 'uploader').map(entry => ({...entry}))
    }
}
export type DocumentWorkspace = ReturnType<typeof documentWorkspace>

function expected(document: DocumentItem, revision: number) {
    if (!Number.isSafeInteger(revision) || document.revision != revision) throw new Error('Документ уже изменён. Обновите карточку')
}

export function createDocumentDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    function audit(ctx: Ctx, document: {orgId: string, id: string}, action: string, actor = ctx.account) {
        ctx.state.audit.push({orgId: document.orgId, id: document.id, actor, action, at: now()})
        if (ctx.state.audit.length > 2000) ctx.state.audit.splice(0, ctx.state.audit.length - 2000)
    }
    function internal(ctx: Ctx) {if (ctx.account != 'system') throw new Error('Внутренняя операция обработчика')}
    const reference = {orgId: 'string', id: 'string', revision: 'number'} as const
    const execution = {orgId: 'string', id: 'string', actor: 'string', runId: 'string'} as const
    return {
        commands: {
            documentImport: schemaCommand({orgId: 'string', id: 'string', actor: 'string', name: 'string', blobId: 'string', size: 'number'}, {
                allow: ['system'], apply(ctx: Ctx, input) {
                    internal(ctx)
                    organizationAccess(ctx.state, input.actor, input.orgId)
                    const hashed = /^[a-f0-9]{64}$/.test(input.id) && /^[a-f0-9]{64}$/.test(input.blobId)
                    const named = !!input.name.trim() && input.name.length <= 160
                    const sized = Number.isInteger(input.size) && input.size >= 1 && input.size <= 512 * 1024
                    if (!hashed || !named || !sized) throw new Error('Некорректные данные файла')
                    const previous = own(ctx.state.documents, input.id)
                    if (previous && previous.status != 'deleted') throw new Error('Этот файл уже импортирован')
                    if (!previous && Object.keys(ctx.state.documents).length >= 50) throw new Error('На этом стенде допускается 50 документов')
                    const at = now()
                    const revision = (previous?.revision ?? 0) + 1
                    ctx.state.documents[input.id] = {
                        id: input.id, orgId: input.orgId, owner: input.actor, name: input.name,
                        blobId: input.blobId, size: input.size, revision,
                        sourceVersion: (previous?.sourceVersion ?? 0) + 1,
                        createdAt: at, updatedAt: at, status: 'uploaded',
                        processor: '', activeRun: '', attempt: 0, error: '',
                        table: {headers: [], rows: []}, comments: [], approvals: []
                    }
                    audit(ctx, input, 'document.import', input.actor)
                    return {id: input.id, revision}
                }
            }),
            processingBegin: schemaCommand({...execution, revision: 'number', processor: 'string'}, {
                allow: ['system'], apply(ctx: Ctx, input) {
                    internal(ctx)
                    const document = documentAccess(ctx.state, input.actor, input.orgId, input.id)
                    expected(document, input.revision)
                    if (!['uploaded', 'failed', 'cancelled', 'uncertain'].includes(document.status)) throw new Error('Обработка недоступна в текущем состоянии')
                    document.status = 'processing'
                    document.activeRun = input.runId
                    document.attempt++
                    document.processor = input.processor
                    document.error = ''
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'processing.begin', input.actor)
                    return {id: document.id, revision: document.revision, attempt: document.attempt}
                }
            }),
            processingResult: schemaCommand({
                ...execution, attempt: 'number', headers: {array: 'string'}, rows: {array: {array: 'string'}},
                provenance: {optional: true, object: {
                    sourceVersion: 'number', provider: 'string', demo: 'boolean',
                    fields: {array: {object: {row: 'number', column: 'number', page: 'number', line: 'number', quote: 'string'}}}
                }}
            }, {
                allow: ['system'], apply(ctx: Ctx, input) {
                    internal(ctx)
                    const document = documentAccess(ctx.state, input.actor, input.orgId, input.id)
                    const current = document.activeRun == input.runId && document.attempt == input.attempt
                    if (document.status != 'processing' || !current) throw new Error('Результат устаревшей попытки отклонён')
                    const table = validateTable(input)
                    if (input.provenance) {
                        if (input.provenance.sourceVersion != document.sourceVersion) throw new Error('Происхождение относится к другой версии исходника')
                        validateExtraction({...input.provenance, table})
                    }
                    document.table = table
                    if (input.provenance) document.provenance = {...input.provenance, fields: input.provenance.fields.map(field => ({...field}))}
                    else delete document.provenance
                    document.status = 'review'
                    document.error = ''
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'processing.result', input.actor)
                    return {id: document.id, revision: document.revision}
                }
            }),
            processingFailure: schemaCommand({...execution, status: {enum: ['failed', 'cancelled', 'uncertain']}, error: 'string'}, {
                allow: ['system'], apply(ctx: Ctx, input) {
                    internal(ctx)
                    const document = own(ctx.state.documents, input.id)
                    const running = !!document && document.orgId == input.orgId && document.status == 'processing'
                    if (!running || document.activeRun != input.runId) return {
                        changed: false
                    }
                    document.status = input.status
                    document.error = input.error.slice(0, 300)
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'processing.' + input.status, input.actor)
                    return {changed: true}
                }
            }),
            documentRow: schemaCommand({...reference, index: 'number', values: {array: 'string'}, comment: 'string'}, {
                allow: REVIEW, apply(ctx: Ctx, input) {
                    const document = documentAccess(ctx.state, ctx.account, input.orgId, input.id, REVIEW)
                    expected(document, input.revision)
                    if (document.status != 'review') throw new Error('Редактирование доступно при проверке')
                    const indexed = Number.isInteger(input.index) && !!document.table.rows[input.index]
                    if (!indexed || input.comment.length > 500) throw new Error('Проверьте строку и комментарий')
                    const next = {
                        headers: [...document.table.headers], rows: document.table.rows.map((row, index) => index == input.index ? [...input.values] : [...row])
                    }
                    document.table = validateTable(next)
                    if (input.comment.trim()) document.comments.push({row: input.index, text: input.comment.trim(), by: ctx.account, at: now()})
                    if (document.comments.length > 50) document.comments.splice(0, document.comments.length - 50)
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'document.edit')
                    return {id: document.id, revision: document.revision}
                }
            }),
            documentApprove: schemaCommand(reference, {
                allow: REVIEW, apply(ctx: Ctx, input) {
                    const document = documentAccess(ctx.state, ctx.account, input.orgId, input.id, REVIEW)
                    expected(document, input.revision)
                    if (document.status != 'review') throw new Error('Документ должен пройти проверку')
                    if (document.approvals.length >= 5) throw new Error('До 5 утверждённых версий на документ')
                    const table = validateTable(document.table)
                    document.revision++
                    document.updatedAt = now()
                    document.approvals.push({revision: document.revision, by: ctx.account, at: document.updatedAt, table, sourceVersion: document.sourceVersion,
                        ...(document.provenance ? {provenance: {...document.provenance, fields: document.provenance.fields.map(field => ({...field}))}} : {})})
                    document.status = 'approved'
                    audit(ctx, document, 'document.approve')
                    return {id: document.id, revision: document.revision}
                }
            }),
            documentReopen: schemaCommand(reference, {
                allow: REVIEW, apply(ctx: Ctx, input) {
                    const document = documentAccess(ctx.state, ctx.account, input.orgId, input.id, REVIEW)
                    expected(document, input.revision)
                    if (document.status != 'approved') throw new Error('Возврат доступен для утверждённого документа')
                    document.status = 'review'
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'document.reopen')
                    return {id: document.id, revision: document.revision}
                }
            }),
            documentDelete: schemaCommand(reference, {
                allow: ROLES, apply(ctx: Ctx, input) {
                    const document = documentAccess(ctx.state, ctx.account, input.orgId, input.id)
                    expected(document, input.revision)
                    document.status = 'deleted'
                    document.table = {headers: [], rows: []}
                    document.approvals = []
                    document.comments = []
                    delete document.provenance
                    document.revision++
                    document.updatedAt = now()
                    audit(ctx, document, 'document.delete')
                    return {id: document.id, revision: document.revision}
                }
            }),
            memberRole: schemaCommand({orgId: 'string', account: 'string', role: {enum: ['owner', 'reviewer', 'uploader', 'revoked']}}, {
                allow: ['owner'], apply(ctx: Ctx, input) {
                    const {org} = organizationAccess(ctx.state, ctx.account, input.orgId, ['owner'])
                    const previous = own(org.members, input.account)
                    if (!previous) throw new Error('Участник недоступен')
                    const owners = Object.values(org.members).filter(role => role == 'owner').length
                    const lastOwner = previous == 'owner' && input.role != 'owner' && owners == 1
                    if (lastOwner) throw new Error('Нельзя удалить последнего владельца')
                    if (input.role == 'revoked') delete org.members[input.account]
                    else org.members[input.account] = input.role
                    audit(ctx, {orgId: input.orgId, id: input.account}, 'member.' + input.role)
                    return {ok: true}
                }
            })
        },
        views: {workspace: {allow: ['signedIn'], project: documentWorkspace}}
    }
}

