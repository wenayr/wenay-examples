import {createHash} from 'node:crypto'
import {Command} from 'wenay-common2'
import {schemaCommand, buildInputValidate, type tInputSchema, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {STAFF, FIELD_TYPES, type FormsState, type Form, type Field, type PublishedVersion, type Answers} from './model'

type Ctx = ServiceCommandCtx<FormsState>
export const EDITORS = ['owner', 'author'] as const
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor'])
export function hash(value: string) {return createHash('sha256').update(value).digest('hex')}
export function organizationAccess(state: FormsState, account: string, orgId: string, roles: readonly string[] = STAFF) {
    const org = Object.hasOwn(state.organizations, orgId) ? state.organizations[orgId] : undefined
    const role = org && Object.hasOwn(org.members, account) ? org.members[account] : undefined
    const known = Object.hasOwn(state.accounts, account)
    const allowed = !!role && roles.includes(role)
    if (!org || !known || !allowed) throw new Error('Нет доступа к организации')
    return {org, role}
}
export function formAccess(state: FormsState, account: string, orgId: string, id: string, roles: readonly string[] = STAFF) {
    const access = organizationAccess(state, account, orgId, roles)
    const form = Object.hasOwn(state.forms, id) ? state.forms[id] : undefined
    if (!form || form.orgId != orgId) throw new Error('Форма недоступна')
    return {...access, form}
}
export function publicForm(state: FormsState, account: string) {
    const match = /^form:([^:]+):(\d+)$/.exec(account)
    const form = match && Object.hasOwn(state.forms, match[1]) ? state.forms[match[1]] : undefined
    const live = !!form && form.enabled && !!form.publishedVersion
    if (!live || form.accessGeneration != Number(match![2])) throw new Error('Публичная ссылка закрыта или обновлена')
    return {form, version: form.versions.find(value => value.version == form.publishedVersion)!}
}
export function formsRoles(state: FormsState, account: string) {
    if (account.startsWith('form:')) {
        try {
            publicForm(state, account)
            return ['respondent']
        } catch {
            return []
        }
    }
    if (!Object.hasOwn(state.accounts, account)) return []
    return [...new Set(['account', ...Object.values(state.organizations).flatMap(org => Object.hasOwn(org.members, account) ? [org.members[account]] : [])])]
}
export function validateFields(fields: Field[]) {
    if (!Array.isArray(fields) || !fields.length || fields.length > 20) throw new Error('От 1 до 20 полей')
    const found = new Map<string, Field>()
    for (const field of fields) {
        const named = !!field && /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.id)
        const free = named && !forbiddenKeys.has(field.id) && !found.has(field.id)
        if (!free) throw new Error('Идентификаторы полей должны быть безопасными и уникальными')
        const labelled = !!field.label.trim() && field.label.length <= 160 && FIELD_TYPES.includes(field.kind)
        const typed = typeof field.required == 'boolean'
        const conditioned = typeof field.whenField == 'string' && typeof field.whenEquals == 'string'
        if (!labelled || !typed || !conditioned) throw new Error('Некорректное описание поля')
        function badChoice(value: unknown) {
            return typeof value != 'string' || !value.trim() || value.length > 80
        }
        const listed = Array.isArray(field.choices) && field.choices.length <= 20
        const clean = listed && !field.choices.some(badChoice)
        const unique = clean && new Set(field.choices).size == field.choices.length
        const filled = field.kind != 'choice' || field.choices.length > 0
        if (!unique || !filled) throw new Error('До 20 разных вариантов выбора')
        const finite = Number.isFinite(field.min) && Number.isFinite(field.max)
        const bounded = finite && Math.abs(field.min) <= 1e9 && Math.abs(field.max) <= 1e9
        if (!bounded || field.min > field.max) throw new Error('Некорректный диапазон поля')
        if (field.kind == 'text' || field.kind == 'longtext') {
            const ceiling = field.kind == 'text' ? 200 : 2000
            const whole = Number.isInteger(field.min) && Number.isInteger(field.max)
            const sized = whole && field.min >= 0 && field.max >= 1 && field.max <= ceiling
            if (!sized) throw new Error('Текст до 200, длинный текст до 2000 символов')
        }
        found.set(field.id, field)
    }
    const visiting = new Set<string>(), done = new Set<string>()
    function visit(id: string) {
        if (visiting.has(id)) throw new Error('Условия полей образуют цикл')
        if (done.has(id)) return
        visiting.add(id)
        const field = found.get(id)!
        if (field.whenField) {
            const parent = found.get(field.whenField)
            const branching = !!parent && ['choice', 'boolean'].includes(parent.kind)
            const values = parent?.kind == 'boolean' ? ['true', 'false'] : parent?.choices ?? []
            if (!branching || !values.includes(field.whenEquals)) {
                throw new Error('Условие ссылается на существующий выбор или да/нет')
            }
            visit(parent.id)
        }
        visiting.delete(id)
        done.add(id)
    }
    fields.forEach(field => visit(field.id))
    return fields.map(field => ({...field, label: field.label.trim(), choices: [...field.choices]}))
}
// Тип поля превращается в правило публичной схемы common2.
function fieldRule(field: Field) {
    if (field.kind == 'choice') {
        const optional = field.required ? {} : {optional: true as const}
        return {enum: field.choices, ...optional}
    }
    if (field.kind == 'number') return field.required ? 'number' : 'number?'
    if (field.kind == 'boolean') return field.required ? 'boolean' : 'boolean?'
    return field.required ? 'string' : 'string?'
}

export function validateAnswers(version: PublishedVersion, input: unknown): Answers {
    const shaped = !!input && typeof input == 'object' && !Array.isArray(input)
    const safe = shaped && !Object.keys(input).some(key => forbiddenKeys.has(key))
    if (!safe) throw new Error('Ожидается объект ответов')
    const values = input as Answers
    const fields = new Map(version.fields.map(field => [field.id, field]))
    const visibility = new Map<string, boolean>()
    function visible(field: Field): boolean {
        if (visibility.has(field.id)) return visibility.get(field.id)!
        const parent = field.whenField ? fields.get(field.whenField)! : null
        const result = !parent || visible(parent) && Object.hasOwn(values, parent.id) && String(values[parent.id]) == field.whenEquals
        visibility.set(field.id, result)
        return result
    }
    const schema: tInputSchema = {}
    for (const field of version.fields.filter(visible)) {
        schema[field.id] = fieldRule(field)
    }
    buildInputValidate(schema)(input)
    const result: Answers = {}
    for (const field of version.fields.filter(visible)) {
        if (!Object.hasOwn(values, field.id) || values[field.id] === undefined) continue
        const value = values[field.id]
        if (field.kind == 'text' || field.kind == 'longtext') {
            const least = Math.max(field.min, field.required ? 1 : 0)
            const sized = typeof value == 'string' && value.length >= least && value.length <= field.max
            const filled = !field.required || (typeof value == 'string' && !!value.trim())
            if (!sized || !filled) throw new Error('Проверьте длину поля «' + field.label + '»')
        }
        const inRange = typeof value == 'number' && value >= field.min && value <= field.max
        if (field.kind == 'number' && !inRange) throw new Error('Число за пределами диапазона')
        result[field.id] = value
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw new Error('Ответ до 32 KiB')
    return result
}
export function formsWorkspace(state: FormsState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const known = Object.hasOwn(state.accounts, account)
    const member = Object.values(state.organizations).filter(org => known && Object.hasOwn(org.members, account))
    const organizations = member.map(function shown(org) {
        return {id: org.id, name: org.name, revision: org.revision, role: org.members[account]}
    })
    const allowed = new Set(organizations.map(org => org.id))
    return {me: Object.hasOwn(state.accounts, account) ? {account, name: state.accounts[account].name} : null, organizations,
        forms: Object.values(state.forms).filter(form => allowed.has(form.orgId)).map(({tokenHash, fields, versions, ...form}) => ({
            ...form, fields: fields.length, versions: versions.length
        })),
        people: organizations.flatMap(org => Object.entries(state.organizations[org.id].members).map(([account, role]) => ({orgId: org.id, account, role}))),
        aggregates: Object.values(state.aggregates).filter(entry => allowed.has(state.forms[entry.formId]?.orgId)).map(entry => {
            const version = state.forms[entry.formId].versions.find(value => value.version == entry.version)!
            return {formId: entry.formId, version: entry.version, count: entry.count, fields: version.fields.map(field => {
                const current = entry.fields[field.id] ?? {answered: 0, sum: 0, values: {}}
                let labels: string[] = []
                if (field.kind == 'boolean') labels = ['true', 'false']
                else if (field.kind == 'choice') labels = field.choices
                return {id: field.id, label: field.label, kind: field.kind, answered: current.answered, sum: current.sum,
                    average: field.kind == 'number' && current.answered ? current.sum / current.answered : null,
                    values: labels.map(value => ({value, count: current.values[hash(value)] ?? 0}))}
            })}
        })}
}
export type FormsWorkspace = ReturnType<typeof formsWorkspace>
const fieldSchema = {
    id: 'string', label: 'string', kind: {enum: FIELD_TYPES}, required: 'boolean',
    choices: {array: 'string'}, min: 'number', max: 'number',
    whenField: 'string', whenEquals: 'string'
} as const
export function createFormsDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    function revision(form: Form, value: number) {if (form.revision != value) throw new Error('Форма изменилась. Откройте свежую версию')}
    function internal(ctx: Ctx) {if (ctx.account != 'system') throw new Error('Внутренняя операция')}
    function updateAggregate(state: FormsState, form: Form, version: number, answers: Answers, delta: 1 | -1) {
        const key = form.id + ':' + version
        state.aggregates[key] ??= {formId: form.id, version, count: 0, fields: {}}
        const aggregate = state.aggregates[key]
        aggregate.count += delta
        const fields = form.versions.find(value => value.version == version)!.fields
        for (const field of fields) if (Object.hasOwn(answers, field.id)) {
            aggregate.fields[field.id] ??= {answered: 0, sum: 0, values: {}}
            const entry = aggregate.fields[field.id], value = answers[field.id]
            entry.answered += delta
            if (field.kind == 'number') entry.sum += (value as number) * delta
            if (field.kind == 'choice' || field.kind == 'boolean') {
                const bucket = hash(String(value))
                entry.values[bucket] = (entry.values[bucket] ?? 0) + delta
            }
        }
    }
    function remove(state: FormsState, id: string) {
        const entry = state.submissions[id]
        if (!entry) return false
        const form = state.forms[entry.formId]
        updateAggregate(state, form, entry.version, entry.answers, -1)
        delete state.submissions[id]
        const receipt = state.receipts[id]
        if (receipt) {
            receipt.signature = ''
            receipt.deleted = true
        }
        form.answersRevision++
        state.erasureRevision = (state.erasureRevision ?? 0) + 1
        return true
    }
    return {commands: {
        formSave: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number', title: 'string',
            description: 'string', fields: {array: {object: fieldSchema}}, retentionDays: 'number'
        }, {allow: EDITORS, limit: {perMinute: 30}, apply(ctx: Ctx, input) {
            organizationAccess(ctx.state, ctx.account, input.orgId, EDITORS)
            const titled = !!input.title.trim() && input.title.length <= 160 && input.description.length <= 2000
            const kept = Number.isInteger(input.retentionDays) && input.retentionDays >= 1 && input.retentionDays <= 365
            if (!titled || !kept) throw new Error('Название до 160, описание до 2000, хранение от 1 до 365 дней')
            const fields = validateFields(input.fields)
            const previous = input.id ? formAccess(ctx.state, ctx.account, input.orgId, input.id, EDITORS).form : null
            if (previous) revision(previous, input.revision)
            else if (input.revision != 0 || Object.keys(ctx.state.forms).length >= 100) throw new Error('До 100 форм; новая форма с revision 0')
            const id = previous?.id ?? 'f-' + hash(Command.commandReceiptKey(ctx.account, ctx.requestId))
            if (previous) {
                previous.title = input.title.trim()
                previous.description = input.description.trim()
                previous.fields = fields
                previous.retentionDays = input.retentionDays
                previous.revision++
            }
            else ctx.state.forms[id] = {
                id, orgId: input.orgId, title: input.title.trim(),
                description: input.description.trim(), fields, retentionDays: input.retentionDays,
                revision: 1, enabled: false, publishedVersion: 0, accessGeneration: 0, tokenHash: '', versions: [], answersRevision: 0, createdAt: now()}
            return {id, revision: ctx.state.forms[id].revision}
        }}),
        formPublish: schemaCommand({
            orgId: 'string', id: 'string', revision: 'number',
            actor: 'string', tokenHash: 'string', publication: 'string'
        }, {allow: ['system'], apply(ctx: Ctx, input) {
            internal(ctx)
            const {form} = formAccess(ctx.state, input.actor, input.orgId, input.id, EDITORS)
            revision(form, input.revision)
            const hashed = /^[a-f0-9]{64}$/.test(input.tokenHash) && /^[a-f0-9]{64}$/.test(input.publication)
            if (!hashed || form.versions.length >= 20) throw new Error('До 20 версий; корректный внутренний запрос публикации')
            const fields = validateFields(form.fields), version = form.versions.length + 1
            form.versions.push({version, title: form.title, description: form.description, fields, publishedAt: now()})
            form.publishedVersion = version
            form.enabled = true
            form.accessGeneration++
            form.tokenHash = input.tokenHash
            form.revision++
            ctx.state.publications ??= {}
            ctx.state.publications[input.publication] = {orgId: form.orgId, formId: form.id, revision: input.revision, version}
            return {id: form.id, version, revision: form.revision}
        }}),
        formDisable: schemaCommand({orgId: 'string', id: 'string', revision: 'number'}, {allow: EDITORS, apply(ctx: Ctx, input) {
            const {form} = formAccess(ctx.state, ctx.account, input.orgId, input.id, EDITORS)
            revision(form, input.revision)
            form.enabled = false
            form.tokenHash = ''
            form.accessGeneration++
            form.revision++
            return {id: form.id, revision: form.revision}
        }}),
        answerSubmit: schemaCommand({
            formId: 'string', version: 'number', nonce: 'string', answersJson: 'string'
        }, {allow: ['respondent'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
            const {form, version} = publicForm(ctx.state, ctx.account)
            if (input.formId != form.id || input.version != version.version) throw new Error('Публикация изменилась. Перезагрузите форму')
            const keyed = /^[\w:-]{8,120}$/.test(input.nonce)
            if (!keyed || Buffer.byteLength(input.answersJson) > 32768) throw new Error('Некорректный nonce или ответ больше 32 KiB')
            const answers = validateAnswers(version, JSON.parse(input.answersJson))
            const id = hash(JSON.stringify([form.id, form.accessGeneration, input.nonce]))
            const signature = hash(JSON.stringify([input.version, Object.entries(answers).sort(([a], [b]) => a.localeCompare(b))]))
            const old = ctx.state.receipts[id]
            if (old) {
                if (!old.deleted && old.signature != signature) throw new Error('Nonce уже использован для другого ответа')
                return {id, duplicate: true, deleted: old.deleted}
            }
            if (Object.keys(ctx.state.receipts).length >= 5000) throw new Error('До 5000 приёмов ответов; требуется архивирование ключей повторов')
            const at = now()
            ctx.state.submissions[id] = {
                id, formId: form.id, orgId: form.orgId, version: version.version, answers, createdAt: at, expiresAt: at + form.retentionDays * 86400000
            }
            ctx.state.receipts[id] = {id, formId: form.id, version: version.version, signature, deleted: false}
            updateAggregate(ctx.state, form, version.version, answers, 1)
            form.answersRevision++
            return {id, duplicate: false, deleted: false}
        }}),
        answerDelete: schemaCommand({orgId: 'string', formId: 'string', id: 'string'}, {allow: ['owner'], apply(ctx: Ctx, input) {
            formAccess(ctx.state, ctx.account, input.orgId, input.formId, ['owner'])
            const entry = Object.hasOwn(ctx.state.submissions, input.id) ? ctx.state.submissions[input.id] : undefined
            if (!entry || entry.formId != input.formId) throw new Error('Ответ недоступен')
            return {deleted: remove(ctx.state, input.id)}
        }}),
        answerCorrect: schemaCommand({
            orgId: 'string', formId: 'string', id: 'string',
            answersRevision: 'number', answersJson: 'string'
        }, {allow: ['owner'], apply(ctx: Ctx, input) {
            const {form} = formAccess(ctx.state, ctx.account, input.orgId, input.formId, ['owner'])
            const entry = Object.hasOwn(ctx.state.submissions, input.id) ? ctx.state.submissions[input.id] : undefined
            const live = !!entry && entry.formId == form.id && entry.expiresAt > now()
            if (!live || form.answersRevision != input.answersRevision) throw new Error('Ответ удалён, просрочен или изменился')
            if (Buffer.byteLength(input.answersJson) > 32768) throw new Error('Ответ до 32 KiB')
            const version = form.versions.find(value => value.version == entry.version)!
            const answers = validateAnswers(version, JSON.parse(input.answersJson))
            updateAggregate(ctx.state, form, entry.version, entry.answers, -1)
            entry.answers = answers
            updateAggregate(ctx.state, form, entry.version, answers, 1)
            form.answersRevision++
            ctx.state.erasureRevision = (ctx.state.erasureRevision ?? 0) + 1
            return {id: entry.id, answersRevision: form.answersRevision}
        }}),
        retentionSweep: schemaCommand({}, {
            allow: ['system'], apply(ctx: Ctx) {
                internal(ctx)
                let deleted = 0
                for (const entry of Object.values(ctx.state.submissions)) if (entry.expiresAt <= now()) {remove(ctx.state, entry.id); deleted++}
                return {deleted}
            }
        }),
        memberRole: schemaCommand({
            orgId: 'string', revision: 'number', account: 'string', role: {enum: ['none', ...STAFF]}
        }, {allow: ['owner'], limit: {perMinute: 30}, apply(ctx: Ctx, input) {
            const {org} = organizationAccess(ctx.state, ctx.account, input.orgId, ['owner'])
            const known = Object.hasOwn(ctx.state.accounts, input.account)
            if (org.revision != input.revision || !known) throw new Error('Организация изменилась или аккаунт недоступен')
            const owners = Object.values(org.members).filter(value => value == 'owner').length
            const lastOwner = org.members[input.account] == 'owner' && input.role != 'owner' && owners == 1
            if (lastOwner) throw new Error('Нельзя удалить последнего владельца')
            if (input.role == 'none') delete org.members[input.account]
            else org.members[input.account] = input.role
            org.revision++
            return {revision: org.revision}
        }})
    }, views: {workspace: {allow: STAFF, project: formsWorkspace}}}
}
