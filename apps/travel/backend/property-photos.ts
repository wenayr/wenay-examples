import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {SupplyHotel, SupplyPhoto} from '../src/supply-contract.ts'

const bundledPath = fileURLToPath(new URL('./property-photo-manifest.json', import.meta.url))
const renderFields = ['url', 'sourceUrl', 'credit', 'license', 'licenseUrl'] as const satisfies readonly (keyof SupplyPhoto)[]

function canonicalKey(key: string) {
    if (/^Q[1-9]\d*$/.test(key)) return 'wikidata:' + key
    if (/^[a-z][a-z0-9-]*:[^\s]+$/u.test(key)) return key
    throw new Error('Invalid property photo key: ' + key)
}

function secureUrl(value: string) {
    try {
        const url = new URL(value)
        return url.protocol == 'https:' && !url.username && !url.password
    } catch {
        return false
    }
}

function parsePhotos(text: string) {
    const raw: unknown = JSON.parse(text)
    if (!raw || typeof raw != 'object' || Array.isArray(raw)) throw new Error('Expected a property photo manifest')
    const entries = new Map<string, SupplyPhoto>()
    for (const [key, value] of Object.entries(raw)) {
        const complete = value && typeof value == 'object'
            && renderFields.every(field => typeof value[field] == 'string' && value[field].trim())
        if (!complete) {
            throw new Error('Incomplete photo or attribution for ' + key)
        }
        if (!secureUrl(value.sourceUrl) || !secureUrl(value.licenseUrl)
            || !(secureUrl(value.url) || /^\/hotel-photos\/[\w.-]+\.webp$/.test(value.url))) {
            throw new Error('Invalid property photo URL for ' + key)
        }
        const id = canonicalKey(key)
        if (entries.has(id)) throw new Error('Duplicate property photo key: ' + id)
        entries.set(id, value)
    }
    return entries
}

export function createPropertyPhotos({manifestPath, lazy}: {manifestPath?: string, lazy?: boolean} = {}) {
    const path = resolve(manifestPath ?? process.env.TRAVEL_PHOTO_MANIFEST ?? bundledPath)
    let photos = new Map<string, SupplyPhoto>()

    function readManifest() {
        return parsePhotos(readFileSync(path, 'utf8'))
    }

    function reload() {
        const next = readManifest()
        const changed = []
        for (const [id, photo] of next) {
            const prior = photos.get(id)
            if (!prior || prior.fileVersion != photo.fileVersion || renderFields.some(field => photo[field] != prior[field])) changed.push(id)
        }
        for (const id of photos.keys()) {
            if (!next.has(id)) changed.push(id)
        }
        photos = next
        return changed
    }

    try {
        if (!lazy) reload()
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code == 'ENOENT')) throw error
    }

    function find(hotel: Pick<SupplyHotel, 'id' | 'wikidataId'>) {
        const direct = photos.get(hotel.id)
        if (direct) return direct
        return hotel.wikidataId ? photos.get('wikidata:' + hotel.wikidataId) ?? null : null
    }
    return {path, find, reload, readManifest}
}

// Keep the existing convenience lookup for consumers using the bundled seed.
let defaultPhotos: ReturnType<typeof createPropertyPhotos>
export function findPropertyPhoto(hotel: Pick<SupplyHotel, 'id' | 'wikidataId'>) {
    defaultPhotos ??= createPropertyPhotos()
    return defaultPhotos.find(hotel)
}
