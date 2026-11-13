import type {SupplyPhoto} from '../../src/supply-contract.ts'

export interface CommonsCandidate {
    hotelKey: string
    title: string
    matchedBy: string
    evidenceUrl: string
}

interface FileInfo {
    sha1: string
    mime: string
    url: string
    thumburl?: string
    descriptionurl: string
    extmetadata: Record<string, {value: string}>
}

interface WikiPage {
    title: string
    missing?: boolean
    imageinfo?: FileInfo[]
}

type tAlias = {from: string, to: string}
interface WikimediaResponse {
    error?: {code: string}
    query?: {pages: WikiPage[], normalized?: tAlias[], redirects?: tAlias[]}
}

const qidPattern = /^Q[1-9]\d*$/
const filePattern = /^File:[^|\r\n\u0000]{1,255}$/i
const licensePattern = /^CC (BY(?:-SA)?) (2\.0|2\.5|3\.0|4\.0)$/
const userAgent = 'WenayTravel/0.2 (+https://github.com/wenayr/wenay-examples)'
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const textEntities: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}

function decodeEntity(match: string, name: string) {
    if (!name.startsWith('#')) return textEntities[name] ?? match
    const hex = name.startsWith('#x')
    const digits = hex ? name.slice(2) : name.slice(1)
    const code = Number.parseInt(digits, hex ? 16 : 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
}

function asText(html: string) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity).replace(/\s+/g, ' ').trim()
}

function safeHost(input: string, hosts: readonly string[]) {
    const url = URL.parse(input)
    if (!url || url.protocol != 'https:') return null
    const allowed = !url.username && !url.password && hosts.includes(url.hostname)
    if (!allowed) return null
    return url
}

export function commonsTitle(raw: string) {
    const value = raw.replace(/_/g, ' ').normalize('NFC').trim()
    return filePattern.test(value) ? 'File:' + value.slice(5) : null
}

export function sourceTitle(sourceUrl: string) {
    const url = safeHost(sourceUrl, ['commons.wikimedia.org'])
    if (!url?.pathname.startsWith('/wiki/File:')) return null
    try {
        return commonsTitle(decodeURIComponent(url.pathname.slice(6)))
    } catch {
        return null
    }
}

export function isWikidataKey(key: string) {
    return qidPattern.test(key)
}

async function query(host: string, params: Record<string, string>, fetcher: typeof fetch) {
    const url = new URL('/w/api.php', 'https://' + host)
    url.search = new URLSearchParams({...params, format: 'json', formatversion: '2', maxlag: '5'}).toString()
    const response = await fetcher(url, {signal: AbortSignal.timeout(30_000), headers: {'user-agent': userAgent, accept: 'application/json'}})
    if (!response.ok) {
        const delay = response.headers.get('retry-after')
        throw new Error(host + ' HTTP ' + response.status + (delay ? ' Retry-After ' + delay : ''))
    }
    const body: WikimediaResponse = await response.json()
    if (body.error) throw new Error(host + ': ' + body.error.code)
    return body
}

export async function readP18(keys: string[], fetcher = fetch) {
    const result = new Map<string, CommonsCandidate[]>()
    if (!keys.length) return result
    if (!keys.every(isWikidataKey)) throw new Error('Invalid Wikidata identifier')
    const url = new URL('https://query.wikidata.org/sparql')
    const values = keys.map(key => 'wd:' + key).join(' ')
    const query = 'SELECT ?id ?file WHERE { VALUES ?id { ' + values + ' } ?id wikibase:statements ?count . OPTIONAL { ?id wdt:P18 ?file } } ORDER BY ?id ?file'
    url.search = new URLSearchParams({query, format: 'json'}).toString()
    const headers = {'user-agent': userAgent, accept: 'application/sparql-results+json'}
    const response = await fetcher(url, {headers, signal: AbortSignal.timeout(30_000)})
    if (!response.ok) {
        const delay = response.headers.get('retry-after') ?? 'not specified'
        throw new Error('Wikidata Query Service HTTP ' + response.status + ' Retry-After ' + delay)
    }
    const body = await response.json() as {results?: {bindings?: {id?: {value: string}, file?: {value: string}}[]}}
    if (!Array.isArray(body.results?.bindings)) throw new Error('Incomplete Wikidata query response')
    for (const row of body.results.bindings) {
        const key = /^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/.exec(row.id?.value ?? '')?.[1]
        if (!key || !keys.includes(key)) throw new Error('Unexpected entity in Wikidata response')
        if (!result.has(key)) result.set(key, [])
        if (!row.file) continue
        const file = URL.parse(row.file.value)
        const path = '/wiki/Special:FilePath/'
        if (file?.hostname != 'commons.wikimedia.org' || !file.pathname.startsWith(path)) throw new Error('Unexpected Wikidata file URL for ' + key)
        const title = commonsTitle('File:' + decodeURIComponent(file.pathname.slice(path.length)))
        if (title) result.get(key)!.push({hotelKey: key, title, matchedBy: 'wikidata:P18', evidenceUrl: 'https://www.wikidata.org/wiki/' + key})
    }
    // Missing IDs can indicate incomplete replication. Never infer a deleted image without an explicit entity row.
    for (const key of keys) {
        if (!result.has(key)) throw new Error('Incomplete Wikidata response for ' + key)
    }
    return result
}

function presentation(info: FileInfo) {
    if (!info.extmetadata || typeof info.sha1 != 'string' || !info.sha1) throw new Error('Incomplete Commons metadata')
    const field = (key: string) => asText(info.extmetadata[key]?.value ?? '')
    const restrictions = field('Restrictions')
    const credit = field('Attribution') || field('Artist')
    if (!mimeTypes.has(info.mime) || restrictions || !credit) return null
    const license = field('LicenseShortName')
    const valid = licensePattern.exec(license)
    if (license != 'CC0' && !valid) return null
    let rawLicense = field('LicenseUrl').replace(/^http:/, 'https:')
    if (!rawLicense && license == 'CC0') rawLicense = 'https://creativecommons.org/publicdomain/zero/1.0/'
    const licenseUrl = safeHost(rawLicense, ['creativecommons.org'])
    const path = valid ? '/licenses/' + valid[1].toLowerCase() + '/' + valid[2] : '/publicdomain/zero/1.0'
    if (!licenseUrl || !(licenseUrl.pathname + '/').startsWith(path + '/')) return null
    const image = safeHost(info.thumburl || info.url, ['upload.wikimedia.org', 'thumb.wikimedia.org'])
    const source = safeHost(info.descriptionurl, ['commons.wikimedia.org'])
    if (!image || !source || !sourceTitle(source.href)) return null
    image.search = ''
    const photo: SupplyPhoto = {url: image.href, sourceUrl: source.href, credit, license, licenseUrl: licenseUrl.href}
    return {photo, version: info.sha1}
}

function readAliases(query: NonNullable<WikimediaResponse['query']>, raw: string) {
    const mappings = [...query.normalized ?? [], ...query.redirects ?? []]
    let current = raw
    for (let i = 0; i <= mappings.length; i++) {
        const next = mappings.find(a => a.from == current)
        if (!next) return current
        current = next.to
    }
    throw new Error('Circular Commons alias: ' + raw)
}

export async function readImages(titles: string[], fetcher = fetch) {
    const photos = new Map<string, ReturnType<typeof presentation>>()
    for (let offset = 0; offset < titles.length; offset += 20) {
        const group = titles.slice(offset, offset + 20)
        const response = await query('commons.wikimedia.org', {
            action: 'query', prop: 'imageinfo', iiprop: 'url|mime|sha1|extmetadata', iiurlwidth: '500',
            iiextmetadatalanguage: 'en', iiextmetadatafilter: 'Attribution|Artist|LicenseShortName|LicenseUrl|Restrictions',
            redirects: '1', titles: group.join('|'),
        }, fetcher)
        const result = response.query
        if (!result || !Array.isArray(result.pages)) throw new Error('Incomplete Commons response')
        for (const title of group) {
            const target = readAliases(result, title)
            const page = result.pages.find(item => item.title == target)
            if (!page) throw new Error('Missing Commons response for ' + title)
            if (page.missing) photos.set(title, null)
            else {
                const file = page.imageinfo?.[0]
                if (!file) throw new Error('Missing Commons imageinfo for ' + title)
                photos.set(title, presentation(file))
            }
        }
    }
    return photos
}
