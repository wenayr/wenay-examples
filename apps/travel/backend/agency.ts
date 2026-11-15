import {
    agencyDestinationNames, agencyLeadStatuses, agencyPriceModes, agencySources,
    type AgencyLead, type AgencyLeadInput, type AgencyProfile, type AgencySession, type AgencySettings, type AgencyStorefront,
} from '../src/agency-contract.ts'
import {validReviewProperty} from '../src/hotel-reviews-contract.ts'

export interface AgencyBucketObject {etag: string, text: () => Promise<string>}
export interface AgencyBucket {
    get: (key: string) => Promise<AgencyBucketObject | null>
    put: (key: string, value: string, options: {onlyIf: Headers, httpMetadata: {contentType: string}}) => Promise<{etag: string} | null>
}

interface AgencyDocument {schema: 1, owner: string, agency: AgencyProfile, leads: AgencyLead[]}
interface SlugClaim {schema: 1, owner: string, agencyId: string}
export class AgencyError extends Error {
    status: number
    code: string
    constructor(status: number, code: string, message: string) {
        super(message)
        this.status = status
        this.code = code
    }
}

function invalid(message: string): never { throw new AgencyError(400, 'invalid', message) }
function object(value: unknown) {
    if (!value || typeof value != 'object' || Array.isArray(value)) return invalid('Ожидается объект настроек.')
    return value as Record<string, unknown>
}
function text(value: unknown, name: string, max: number, required = false) {
    if (typeof value != 'string') return invalid('Проверьте поле «' + name + '».')
    const result = value.trim()
    if (result.length > max || required && result.length == 0) return invalid('Проверьте длину поля «' + name + '».')
    return result
}
function selection(value: unknown, names: Record<string, unknown>, name: string) {
    if (!Array.isArray(value) || value.length > Object.keys(names).length) return invalid('Проверьте поле «' + name + '».')
    const values = value.filter(item => typeof item == 'string' && Object.hasOwn(names, item)) as string[]
    if (values.length != value.length || new Set(values).size != values.length) return invalid('Неизвестное значение: ' + name + '.')
    return values
}
function revision(value: unknown) {
    if (!Number.isSafeInteger(value) || Number(value) < 1) return invalid('Укажите версию сохранённых настроек.')
    return Number(value)
}
function validSlug(value: string) { return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(value) }

export function readAgencySettings(value: unknown): AgencySettings {
    const input = object(value)
    const contact = object(input.contact)
    const slug = text(input.slug, 'Адрес кабинета', 40, true)
    if (!validSlug(slug)) return invalid('Адрес: 3–40 латинских букв, цифр или дефисов.')
    const email = text(contact.email, 'Электронная почта', 160)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('Проверьте электронную почту.')
    const website = text(contact.website, 'Сайт', 240)
    if (website) {
        let url: URL
        try { url = new URL(website) } catch { return invalid('Укажите полный адрес сайта https://…') }
        if (url.protocol != 'https:' || url.username || url.password) return invalid('Сайт должен использовать HTTPS без логина и пароля в адресе.')
    }
    const brandColor = text(input.brandColor, 'Цвет бренда', 7)
    if (!/^#[a-fA-F0-9]{6}$/.test(brandColor)) return invalid('Выберите цвет бренда.')
    if (typeof input.showReviews != 'boolean') return invalid('Выберите, показывать ли отзывы.')
    if (typeof input.compactPriceMode != 'string' || !Object.hasOwn(agencyPriceModes, input.compactPriceMode)) {
        return invalid('Выберите вид миниатюры цен.')
    }
    return {
        name: text(input.name, 'Название', 80, true), slug, tagline: text(input.tagline, 'Описание', 240),
        contact: {email, website, phone: text(contact.phone, 'Телефон', 60)}, brandColor,
        destinations: selection(input.destinations, agencyDestinationNames, 'Направления'),
        sources: selection(input.sources, agencySources, 'Источники') as AgencySettings['sources'],
        showReviews: input.showReviews, compactPriceMode: input.compactPriceMode as AgencySettings['compactPriceMode'],
        reviewProperties: readReviewProperties(input.reviewProperties),
    }
}

function readReviewProperties(value: unknown) {
    if (value == null) return []
    if (!Array.isArray(value) || value.length > 100) return invalid('Укажите не более 100 сопоставлений отелей.')
    const hotels = new Set<string>()
    return value.map(function property(item) {
        const input = object(item)
        const hotelId = text(input.hotelId, 'Отель TEZ', 40)
        const propertyId = text(input.propertyId, 'Отель Expedia', 20)
        const sourceUrl = text(input.sourceUrl, 'Страница Expedia', 500)
        if (!/^tez:[1-9]\d{0,14}$/.test(hotelId) || !/^[1-9]\d{0,14}$/.test(propertyId)) return invalid('Проверьте ID обоих отелей.')
        if (hotels.has(hotelId)) return invalid('Один отель TEZ не может иметь два сопоставления.')
        const property = {hotelId, propertyId, sourceUrl}
        if (!validReviewProperty(property)) return invalid('ID Expedia должен совпадать с HTTPS-страницей отеля на Expedia.com.')
        hotels.add(hotelId)
        return property
    })
}

function readLead(value: unknown): AgencyLeadInput {
    const input = object(value)
    const hotelId = input.hotelId == null ? undefined : text(input.hotelId, 'Отель', 40)
    if (hotelId && !/^tez:[1-9]\d{0,14}$/.test(hotelId)) return invalid('Неизвестный идентификатор отеля.')
    return {
        name: text(input.name, 'Имя клиента', 100, true), contact: text(input.contact, 'Контакт клиента', 200, true),
        message: text(input.message, 'Пожелания', 2000), hotelId,
        hotelName: input.hotelName == null ? undefined : text(input.hotelName, 'Название отеля', 160),
    }
}

async function ownerKey(owner: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner))
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
    return 'travel/agency/v1/owners/' + hash + '.json'
}

export function agencyIdentity(request: Request) {
    const owner = request.headers.get('oai-authenticated-user-id')?.trim()
    return owner && owner.length <= 512 ? owner : null
}

export function createAgencies(deps: {bucket?: AgencyBucket, now?: () => Date, id?: () => string, reviewProviderAvailable?: boolean}) {
    function requireStorage() {
        if (!deps.bucket) throw new AgencyError(503, 'storage_unavailable', 'Хранилище кабинетов ещё не подключено. Сохранение недоступно.')
        return deps.bucket
    }
    async function read(owner: string) {
        const bucket = requireStorage()
        const key = await ownerKey(owner)
        const entry = await bucket.get(key)
        if (!entry) return {key, etag: null, document: null}
        const document = JSON.parse(await entry.text()) as AgencyDocument
        const validOwner = document.schema == 1 && document.owner == owner
        const validShape = Boolean(document.agency) && Array.isArray(document.leads)
        if (!validOwner || !validShape) {
            throw new AgencyError(503, 'storage_invalid', 'Не удалось прочитать кабинет. Данные не изменены.')
        }
        return {key, etag: entry.etag, document}
    }
    async function claimSlug(owner: string, slug: string) {
        const key = 'travel/agency/v1/slugs/' + slug + '.json'
        const bucket = requireStorage()
        const previous = await bucket.get(key)
        if (previous) {
            const claim = JSON.parse(await previous.text()) as SlugClaim
            if (claim.schema == 1 && claim.owner == owner) return claim
            throw new AgencyError(409, 'slug_taken', 'Этот адрес агентства уже занят. Выберите другой.')
        }
        const claim = {schema: 1, owner, agencyId: id()} satisfies SlugClaim
        const stored = await bucket.put(key, JSON.stringify(claim), {
            onlyIf: new Headers({'if-none-match': '*'}), httpMetadata: {contentType: 'application/json'},
        })
        if (!stored) throw new AgencyError(409, 'slug_taken', 'Адрес только что заняли. Попробуйте сохранить ещё раз.')
        return claim
    }
    async function bySlug(slug: string) {
        if (!validSlug(slug)) throw new AgencyError(404, 'not_found', 'Агентство не найдено.')
        const entry = await requireStorage().get('travel/agency/v1/slugs/' + slug + '.json')
        if (!entry) throw new AgencyError(404, 'not_found', 'Агентство не найдено.')
        const claim = JSON.parse(await entry.text()) as SlugClaim
        if (claim.schema != 1 || typeof claim.owner != 'string') throw new AgencyError(404, 'not_found', 'Агентство не найдено.')
        const snapshot = await read(claim.owner)
        const profile = snapshot.document?.agency
        if (!profile || profile.slug != slug || profile.id != claim.agencyId) throw new AgencyError(404, 'not_found', 'Агентство ещё не создано.')
        return {snapshot, owner: claim.owner, profile}
    }
    function projection(profile: AgencyProfile): AgencyStorefront {
        return {
            name: profile.name, slug: profile.slug, tagline: profile.tagline, contact: profile.contact, brandColor: profile.brandColor,
            destinations: profile.destinations, sources: profile.sources, showReviews: profile.showReviews,
            compactPriceMode: profile.compactPriceMode, revision: profile.revision,
        }
    }
    async function storefront(slug: string) { return projection((await bySlug(slug)).profile) }
    async function settingsForSlug(slug: string) { return (await bySlug(slug)).profile }
    async function write(snapshot: Awaited<ReturnType<typeof read>>, document: AgencyDocument) {
        const serialized = JSON.stringify(document)
        if (new TextEncoder().encode(serialized).byteLength > 4_000_000) {
            throw new AgencyError(409, 'capacity', 'Кабинет достиг объёма хранилища заявок. Экспортируйте заявки перед расширением хранилища.')
        }
        const conditional = new Headers()
        if (snapshot.etag) conditional.set('if-match', '"' + snapshot.etag + '"')
        else conditional.set('if-none-match', '*')
        const stored = await requireStorage().put(snapshot.key, serialized, {
            onlyIf: conditional, httpMetadata: {contentType: 'application/json'},
        })
        if (!stored) throw new AgencyError(409, 'conflict', 'Кабинет уже изменён в другой вкладке. Обновите данные перед сохранением.')
    }
    function stamp() { return (deps.now?.() ?? new Date()).toISOString() }
    function id() { return deps.id?.() ?? crypto.randomUUID() }
    function session(document: AgencyDocument | null): AgencySession {
        return {
            authenticated: true, storageAvailable: Boolean(deps.bucket), agency: document?.agency ?? null, leads: document?.leads ?? [],
            reviewProviderAvailable: Boolean(deps.reviewProviderAvailable),
        }
    }
    async function get(owner: string) {
        if (!deps.bucket) return session(null)
        return session((await read(owner)).document)
    }
    async function create(owner: string, input: unknown) {
        const settings = readAgencySettings(input)
        const snapshot = await read(owner)
        if (snapshot.document) throw new AgencyError(409, 'conflict', 'Кабинет уже создан. Обновите страницу.')
        const claim = await claimSlug(owner, settings.slug)
        const time = stamp()
        const agency = {...settings, id: claim.agencyId, revision: 1, createdAt: time, updatedAt: time}
        const document = {schema: 1, owner, agency, leads: []} satisfies AgencyDocument
        await write(snapshot, document)
        return session(document)
    }
    async function update(owner: string, input: unknown) {
        const settings = readAgencySettings(input)
        const expected = revision(object(input).revision)
        const snapshot = await read(owner)
        if (!snapshot.document) throw new AgencyError(404, 'not_found', 'Сначала создайте кабинет агентства.')
        const previous = snapshot.document.agency
        if (previous.slug != settings.slug) return invalid('Адрес созданного агентства нельзя изменить: на него ссылаются клиентские заявки.')
        if (previous.revision != expected) throw new AgencyError(409, 'conflict', 'Настройки изменились. Обновите кабинет перед сохранением.')
        const agency = {...previous, ...settings, revision: previous.revision + 1, updatedAt: stamp()}
        const document = {...snapshot.document, agency}
        await write(snapshot, document)
        return session(document)
    }
    async function addLead(owner: string, input: unknown) {
        const data = readLead(input)
        const snapshot = await read(owner)
        if (!snapshot.document) throw new AgencyError(404, 'not_found', 'Сначала создайте кабинет агентства.')
        if (snapshot.document.leads.length >= 1000) {
            throw new AgencyError(409, 'capacity', 'В кабинете уже 1000 заявок. Экспортируйте их перед расширением хранилища.')
        }
        const time = stamp()
        const lead = {...data, id: id(), status: 'new', revision: 1, createdAt: time, updatedAt: time} satisfies AgencyLead
        const document = {...snapshot.document, leads: [lead, ...snapshot.document.leads]}
        await write(snapshot, document)
        return lead
    }
    async function updateLead(owner: string, leadId: string, input: unknown) {
        const body = object(input)
        const expected = revision(body.revision)
        if (typeof body.status != 'string' || !Object.hasOwn(agencyLeadStatuses, body.status)) return invalid('Выберите статус заявки.')
        const status = body.status as AgencyLead['status']
        const snapshot = await read(owner)
        const previous = snapshot.document?.leads.find(lead => lead.id == leadId)
        if (!snapshot.document || !previous) throw new AgencyError(404, 'not_found', 'Заявка не найдена в вашем агентстве.')
        if (previous.revision != expected) throw new AgencyError(409, 'conflict', 'Заявка изменилась. Обновите кабинет.')
        const lead = {...previous, status, revision: previous.revision + 1, updatedAt: stamp()}
        const leads = snapshot.document.leads.map(item => item.id == leadId ? lead : item)
        await write(snapshot, {...snapshot.document, leads})
        return lead
    }
    async function submitLead(slug: string, input: unknown) {
        const {owner} = await bySlug(slug)
        const lead = await addLead(owner, input)
        return {accepted: true, reference: lead.id}
    }
    return {view: {get, storefront, settingsForSlug}, control: {create, update, addLead, updateLead, submitLead}}
}

export type Agencies = ReturnType<typeof createAgencies>
