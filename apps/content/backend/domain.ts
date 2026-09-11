import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServicePrincipal} from 'wenay-common2/service'
import {ROLES, WRITERS, REVIEWERS, PUBLISHERS, type Block, type ContentState, type Draft, type Page, type Receipt, type Snapshot} from './model'

type Ctx = ServiceCommandCtx<ContentState>
export function own<T>(values: Record<string, T>, key: string) {return Object.hasOwn(values, key) ? values[key] : undefined}
export function hash(...parts: unknown[]) {return createHash('sha256').update(JSON.stringify(parts)).digest('hex')}
function copyDraft(draft: Draft) {return {...draft, blocks: draft.blocks.map(block => ({...block}))}}
export function access(state: ContentState, account: string, orgId: string, roles: readonly string[] = ROLES) {
    const org = own(state.organizations, orgId), role = org && own(org.members, account)
    if (!own(state.accounts, account) || !role || !roles.includes(role)) throw new Error('Нет доступа к организации или роли')
    return role
}
export function contentRoles(state: ContentState, account: string) {
    return own(state.accounts, account) ? ['account', ...new Set(Object.values(state.organizations).flatMap(org => own(org.members, account) ?? []))] : []
}
const writers = ['owner', 'author', 'editor', 'publisher'] as const

export function pageAccess(state: ContentState, account: string, orgId: string, id: string, roles: readonly string[] = writers) {
    access(state, account, orgId, roles)
    const page = own(state.pages, id)
    if (!page || page.orgId != orgId) throw new Error('Страница недоступна')
    return page
}
export function writeAccess(state: ContentState, account: string, orgId: string, id: string) {
    const page = pageAccess(state, account, orgId, id, WRITERS)
    if (access(state, account, orgId) == 'author' && page.author != account) throw new Error('Автор может менять только свои страницы')
    return page
}
export function checkRevision(value: {revision: number}, revision: number) {
    if (!Number.isSafeInteger(revision) || value.revision != revision) throw new Error('Версия уже изменилась. Обновите данные')
}
export function cleanText(value: string, max: number, required = true) {
    if (typeof value != 'string') throw new Error('Ожидался текст')
    const text = value.trim()
    if (text.length > max || required && !text) throw new Error('Проверьте длину текста: до ' + max)
    return text
}
export function validateDraft(state: ContentState, orgId: string, draft: Draft): Draft {
    const title = cleanText(draft.title, 160), slug = cleanText(draft.slug, 80)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Адрес: латинские буквы, цифры и дефисы')
    if (!Array.isArray(draft.blocks) || !draft.blocks.length || draft.blocks.length > 30) throw new Error('Нужно от 1 до 30 блоков')
    const ids = new Set<string>()
    const blocks = draft.blocks.map(block => {
        const id = cleanText(block.id, 80), text = cleanText(block.text, block.kind == 'text' || block.kind == 'quote' ? 4000 : 500, block.kind != 'image')
        if (!/^[\w-]+$/.test(id) || ids.has(id)) throw new Error('Идентификаторы блоков должны быть уникальными')
        ids.add(id)
        if (!['heading', 'text', 'image', 'quote', 'button'].includes(block.kind)) throw new Error('Неизвестный тип блока')
        if (block.kind == 'image') {
            const asset = own(state.assets, block.assetId)
            if (!asset || asset.orgId != orgId || asset.removedAt) throw new Error('Изображение недоступно')
            if (!text) throw new Error('Добавьте описание изображения')
        } else if (block.assetId) throw new Error('Изображение допустимо только в блоке image')
        if (block.kind == 'button') {
            let url: URL
            try {url = new URL(block.href)} catch {throw new Error('Кнопке нужен полный HTTPS адрес')}
            const plain = !url.username && !url.password && block.href.length <= 1000
            if (url.protocol != 'https:' || !plain) throw new Error('Кнопке нужен безопасный HTTPS адрес')
        } else if (block.href) throw new Error('Ссылка допустима только у кнопки')
        return {id, kind: block.kind, text, assetId: block.assetId, href: block.href}
    })
    if (JSON.stringify(blocks).length > 50000) throw new Error('Страница слишком большая')
    return {title, slug, blocks}
}
export function assetReferenced(state: ContentState, id: string) {
    function used(draft: {blocks: {assetId: string}[]}) {
        return draft.blocks.some(block => block.assetId == id)
    }
    return Object.values(state.pages).some(page => [page.draft, ...page.snapshots].some(used))
}
export function publicPage(state: ContentState, page: Page) {
    const snapshot = page.snapshots.find(value => value.version == page.publishedVersion)
    if (!snapshot) return null
    return {
        id: page.id,
        orgId: page.orgId,
        version: snapshot.version,
        publicationRevision: page.publicationRevision,
        title: snapshot.title,
        slug: snapshot.slug,
        blocks: snapshot.blocks.map(block => ({...block})),
        publishedAt: page.publications.at(-1)?.at ?? 0
    }
}
export function publishedView(state: ContentState) {return {pages: Object.values(state.pages).flatMap(page => {
    const value = publicPage(state, page)
    return value ? [value] : []})}
}
// Состав организации показывается только сотрудникам, читателю — нет.
function teamOf(state: ContentState, orgId: string) {
    return Object.entries(state.organizations[orgId].members)
}

export function contentWorkspace(state: ContentState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const known = !!own(state.accounts, account)
    const member = Object.values(state.organizations).filter(org => known && !!own(org.members, account))
    const organizations = member.map(org => ({id: org.id, name: org.name, role: org.members[account]}))
    const staff = new Set(organizations.filter(org => org.role != 'reader').map(org => org.id))
    const inside = organizations.filter(org => staff.has(org.id))
    return {account: {account, name: own(state.accounts, account)?.name ?? ''}, organizations,
        people: inside.flatMap(org => teamOf(state, org.id).map(([account, role]) => ({
            orgId: org.id, account, name: state.accounts[account]?.name ?? account, role
        }))),
        pages: Object.values(state.pages).filter(page => staff.has(page.orgId)).map(page => ({
            ...page,
            draft: copyDraft(page.draft),
            snapshots: page.snapshots.map(value => ({...value, ...copyDraft(value)})),
            reviews: page.reviews.map(value => ({...value})),
            comments: page.comments.map(value => ({...value})),
            publications: page.publications.map(value => ({...value})),
            schedules: page.schedules.map(value => ({
                ...value
            }))
        })),
        assets: Object.values(state.assets).filter(asset => staff.has(asset.orgId) && !asset.removedAt).map(asset => ({...asset})),
        audit: state.audit.filter(entry => staff.has(entry.orgId)).map(entry => ({...entry}))}
}
export type ContentWorkspace = ReturnType<typeof contentWorkspace>
export type PublishedPage = NonNullable<ReturnType<typeof publicPage>>
function snapshot(page: Page, version: number) {
    const value = page.snapshots.find(item => item.version == version)
    if (!value) throw new Error('Версия снимка недоступна')
    return value
}
function approved(page: Page, version: number, current: boolean) {
    const value = snapshot(page, version), review = page.reviews.filter(review => review.version == version).at(-1)
    if (review?.decision != 'approved' || current && value.draftRevision != page.draftRevision) throw new Error('Нужна одобренная текущая версия черновика')
    return value
}
function touch(page: Page, at: number) {
    page.revision++
    page.updatedAt = at
}
function cancelSchedules(page: Page, reason: string) {for (const entry of page.schedules) if (entry.status == 'pending') {
    entry.status = 'cancelled'
    entry.reason = reason}
}
function publish(state: ContentState, page: Page, version: number, id: string, actor: string, at: number, kind: 'publish' | 'rollback' | 'scheduled') {
    const value = approved(page, version, kind != 'rollback')
    function sameSlug(other: Page) {
        if (other.id == page.id || other.orgId != page.orgId) return false
        return publicPage(state, other)?.slug == value.slug
    }
    if (Object.values(state.pages).some(sameSlug)) throw new Error('Опубликованный адрес занят другой страницей')
    if (page.publications.length >= 100) throw new Error('Предел 100 публикаций страницы')
    page.publications.push({id, version, at, actor, kind})
    page.publishedVersion = version
    page.publicationRevision++
    touch(page, at)
    cancelSchedules(page, 'Опубликована другая версия')
}
function audit(ctx: Ctx, orgId: string, action: string, target: string, at: number) {ctx.state.audit.push({
    id: hash(ctx.requestId, action), orgId, actor: ctx.account, action, target, at})
    if (ctx.state.audit.length > 1000) ctx.state.audit.splice(0, ctx.state.audit.length - 1000)
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
    if (!value || typeof value != 'object') return JSON.stringify(value)
    const entries = Object.keys(value).sort().map(function pair(key) {
        return JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])
    })
    return '{' + entries.join(',') + '}'
}
function intent(ctx: Ctx, kind: string, input: {orgId: string, key: string}, apply: (id: string) => Receipt) {
    access(ctx.state, ctx.account, input.orgId)
    cleanText(input.key, 120)
    const id = hash(ctx.account, input.orgId, kind, input.key), signature = canonical(input), old = own(ctx.state.intents, id)
    if (old) {
        if (old.signature != signature) throw new Error('Ключ повтора имеет другие параметры')
        return {...old.receipt, fresh: false}
    }
    if (Object.keys(ctx.state.intents).length >= 3000) throw new Error('Предел 3000 намерений')
    const result = apply(id)
    ctx.state.intents[id] = {signature, receipt: result}
    return result
}
function receipt(page: Page, version = 0): Receipt {return {id: page.id, revision: page.revision, version, fresh: true}}

export function createContentDomain(deps: {now?: () => number} = {}) {
    const now = deps.now ?? Date.now
    const pageInput = {orgId: 'string', id: 'string', revision: 'number'} as const
    const blockInput = {id: 'string', kind: {enum: ['heading', 'text', 'image', 'quote', 'button']}, text: 'string', assetId: 'string', href: 'string'} as const
    return {commands: {
        pageSave: schemaCommand({
            ...pageInput, title: 'string', slug: 'string', blocks: {array: {object: blockInput}}
        }, {allow: WRITERS, apply(ctx: Ctx, input) {
            access(ctx.state, ctx.account, input.orgId, WRITERS)
            const old = input.id ? writeAccess(ctx.state, ctx.account, input.orgId, input.id) : null
            if (old) checkRevision(old, input.revision)
            else if (input.revision != 0) throw new Error('Новая страница имеет revision 0')
            if (!old && Object.keys(ctx.state.pages).length >= 200) throw new Error('Предел 200 страниц')
            const draft = validateDraft(ctx.state, input.orgId, input)
            const page: Page = old ?? {
                id: hash(ctx.account, ctx.requestId), orgId: input.orgId, author: ctx.account,
                revision: 0, draftRevision: 0, draft,
                snapshots: [], reviews: [], comments: [], publications: [], schedules: [],
                publishedVersion: 0, publicationRevision: 0, createdAt: now(), updatedAt: now()
            }
            page.draft = draft
            page.draftRevision++
            touch(page, now())
            cancelSchedules(page, 'Черновик изменён')
            ctx.state.pages[page.id] = page
            audit(ctx, page.orgId, 'page.save', page.id, now())
            return receipt(page)
        }}),
        reviewSubmit: schemaCommand(pageInput, {allow: WRITERS, apply(ctx: Ctx, input) {
            const page = writeAccess(ctx.state, ctx.account, input.orgId, input.id)
            checkRevision(page, input.revision)
            const old = page.snapshots.find(value => value.draftRevision == page.draftRevision)
            if (old) return receipt(page, old.version)
            if (page.snapshots.length >= 50) throw new Error('Предел 50 снимков страницы')
            const version = page.snapshots.length + 1
            page.snapshots.push({...copyDraft(page.draft), version, draftRevision: page.draftRevision, createdAt: now(), author: ctx.account})
            touch(page, now())
            audit(ctx, page.orgId, 'review.submit', page.id, now())
            return receipt(page, version)
        }}),
        reviewDecide: schemaCommand({
            ...pageInput, version: 'number', decision: {enum: ['approved', 'changes']}, body: 'string'
        }, {allow: REVIEWERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, REVIEWERS)
            checkRevision(page, input.revision)
            const value = snapshot(page, input.version)
            if (value.draftRevision != page.draftRevision) throw new Error('Согласование устаревшего черновика запрещено')
            if (page.reviews.length >= 100) throw new Error('Предел 100 решений')
            const body = cleanText(input.body, 2000, false)
            page.reviews.push({version: input.version, editor: ctx.account, at: now(), decision: input.decision, body})
            touch(page, now())
            if (input.decision == 'changes') cancelSchedules(page, 'Согласование отозвано')
            audit(ctx, page.orgId, 'review.' + input.decision, page.id, now())
            return receipt(page, input.version)
        }}),
        commentAdd: schemaCommand({
            orgId: 'string', id: 'string', version: 'number', blockId: 'string', body: 'string'
        }, {allow: writers, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id), value = snapshot(page, input.version)
            if (input.blockId && !value.blocks.some(block => block.id == input.blockId)) throw new Error('Блок не принадлежит снимку')
            if (page.comments.length >= 200) throw new Error('Предел 200 замечаний')
            page.comments.push({
                id: hash(ctx.account, ctx.requestId), version: value.version, blockId: input.blockId,
                author: ctx.account, body: cleanText(input.body, 2000), at: now()
            })
            touch(page, now())
            return receipt(page, value.version)
        }}),
        pagePublish: schemaCommand({...pageInput, version: 'number', key: 'string'}, {allow: PUBLISHERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, PUBLISHERS)
            return intent(ctx, 'publish', input, function apply(id) {
                checkRevision(page, input.revision)
                publish(ctx.state, page, input.version, id, ctx.account, now(), 'publish')
                audit(ctx, page.orgId, 'page.publish', page.id, now())
                return receipt(page, input.version)
            })
        }}),
        pageRollback: schemaCommand({...pageInput, version: 'number', key: 'string'}, {allow: PUBLISHERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, PUBLISHERS)
            return intent(ctx, 'rollback', input, function apply(id) {
                checkRevision(page, input.revision)
                if (!page.publications.some(value => value.version == input.version)) throw new Error('Откат только к ранее опубликованной версии')
                publish(ctx.state, page, input.version, id, ctx.account, now(), 'rollback')
                audit(ctx, page.orgId, 'page.rollback', page.id, now())
                return receipt(page, input.version)
            })
        }}),
        pageWithdraw: schemaCommand({...pageInput, key: 'string'}, {allow: PUBLISHERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, PUBLISHERS)
            return intent(ctx, 'withdraw', input, function apply() {
                checkRevision(page, input.revision)
                page.publishedVersion = 0
                page.publicationRevision++
                touch(page, now())
                cancelSchedules(page, 'Публикация снята')
                audit(ctx, page.orgId, 'page.withdraw', page.id, now())
                return receipt(page)
            })
        }}),
        scheduleCreate: schemaCommand({...pageInput, version: 'number', key: 'string', dueAt: 'number'}, {allow: PUBLISHERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, PUBLISHERS)
            return intent(ctx, 'schedule', input, function apply(id) {
                checkRevision(page, input.revision)
                const value = approved(page, input.version, true)
                const soon = input.dueAt > now() && input.dueAt <= now() + 90 * 86400000
                if (!Number.isSafeInteger(input.dueAt) || !soon) throw new Error('Срок должен быть в следующих 90 днях')
                if (page.schedules.length >= 100) throw new Error('Предел 100 заданий')
                cancelSchedules(page, 'Заменено новым расписанием')
                page.schedules.push({
                    id, version: value.version, draftRevision: value.draftRevision, dueAt: input.dueAt, actor: ctx.account, status: 'pending', reason: ''
                })
                touch(page, now())
                return receipt(page, value.version)
            })
        }}),
        scheduleCancel: schemaCommand({...pageInput, scheduleId: 'string'}, {allow: PUBLISHERS, apply(ctx: Ctx, input) {
            const page = pageAccess(ctx.state, ctx.account, input.orgId, input.id, PUBLISHERS)
            checkRevision(page, input.revision)
            const entry = page.schedules.find(value => value.id == input.scheduleId)
            if (!entry || entry.status != 'pending') throw new Error('Ожидающее задание недоступно')
            entry.status = 'cancelled'
            entry.reason = 'Отменено издателем'
            touch(page, now())
            return receipt(page, entry.version)
        }}),
        publicationSweep: schemaCommand({}, {allow: ['system'], apply(ctx: Ctx) {
            if (ctx.account != 'system') throw new Error('Внутренняя операция')
            for (const page of Object.values(ctx.state.pages)) for (const entry of page.schedules) if (entry.status == 'pending' && entry.dueAt <= now()) {
                try {
                    access(ctx.state, entry.actor, page.orgId, PUBLISHERS)
                    if (entry.draftRevision != page.draftRevision) throw new Error('Черновик изменён')
                    publish(ctx.state, page, entry.version, entry.id, entry.actor, now(), 'scheduled')
                    entry.status = 'published'
                    entry.reason = ''
                } catch {
                    entry.status = 'failed'
                    entry.reason = 'Права, согласование или адрес изменились'
                    touch(page, now())
                }
            }
        }}),
        memberRole: schemaCommand({orgId: 'string', account: 'string', role: {enum: [...ROLES, 'revoked']}}, {allow: ['owner'], apply(ctx: Ctx, input) {
            access(ctx.state, ctx.account, input.orgId, ['owner'])
            const org = ctx.state.organizations[input.orgId]
            if (!own(ctx.state.accounts, input.account)) throw new Error('Аккаунт недоступен')
            const owners = Object.values(org.members).filter(role => role == 'owner').length
            const lastOwner = org.members[input.account] == 'owner' && input.role != 'owner' && owners == 1
            if (lastOwner) throw new Error('Нужен хотя бы один владелец')
            if (input.role == 'revoked') delete org.members[input.account]
            else org.members[input.account] = input.role
            audit(ctx, input.orgId, 'member.' + input.role, input.account, now())
        }}),
        assetRegister: schemaCommand({
            account: 'string', orgId: 'string', id: 'string', hash: 'string', name: 'string',
            mime: {enum: ['image/png', 'image/jpeg', 'image/webp']}, size: 'number'
        }, {allow: ['system'], apply(ctx: Ctx, input) {
            if (ctx.account != 'system') throw new Error('Внутренняя операция')
            access(ctx.state, input.account, input.orgId, WRITERS)
            const old = own(ctx.state.assets, input.id)
            if (old && !old.removedAt) return {...old}
            if (Object.values(ctx.state.assets).filter(value => !value.removedAt).length >= 200) throw new Error('Предел 200 изображений')
            const asset = {...input, author: input.account, alt: '', revision: (old?.revision ?? 0) + 1, createdAt: now(), removedAt: 0}
            ctx.state.assets[input.id] = asset
            return {...asset}
        }}),
        assetDescribe: schemaCommand({...pageInput, alt: 'string'}, {allow: WRITERS, apply(ctx: Ctx, input) {
            access(ctx.state, ctx.account, input.orgId, WRITERS)
            const asset = own(ctx.state.assets, input.id)
            if (!asset || asset.orgId != input.orgId || asset.removedAt) throw new Error('Изображение недоступно')
            checkRevision(asset, input.revision)
            asset.alt = cleanText(input.alt, 500)
            asset.revision++
            return {...asset}
        }}),
        assetForget: schemaCommand({account: 'string', orgId: 'string', id: 'string'}, {allow: ['system'], apply(ctx: Ctx, input) {
            if (ctx.account != 'system') throw new Error('Внутренняя операция')
            access(ctx.state, input.account, input.orgId, WRITERS)
            const asset = own(ctx.state.assets, input.id)
            if (!asset || asset.orgId != input.orgId) throw new Error('Изображение недоступно')
            if (assetReferenced(ctx.state, asset.id)) throw new Error('Изображение используется черновиком или снимком')
            if (!asset.removedAt) {
                asset.removedAt = now()
                asset.revision++
            }
            return {...asset}
        }})
    }, views: {workspace: {allow: ROLES, project: contentWorkspace}, published: {allow: 'public' as const, project: publishedView}}}
}
