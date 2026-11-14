import {execFile} from 'node:child_process'
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {parseArgs, promisify} from 'node:util'
import {createAsyncQueue} from 'wenay-common2'

const command = promisify(execFile)
interface HotelTarget {id: number, name: string}
interface GalleryImage {name?: unknown, folder?: unknown}
interface GalleryPayload {
    success?: unknown
    mainSiteGallery?: GalleryImage
    siteGalleries?: GalleryImage[]
    topSiteGalleries?: GalleryImage[]
}

export function readTezMediaIdentity(page: string, hotel: HotelTarget) {
    const id = Number(/\bHOTEL_ID\s*=\s*(\d+)/.exec(page)?.[1])
    const siteHotelId = Number(/\bSITE_HOTEL_ID\s*=\s*(\d+)/.exec(page)?.[1])
    if (id != hotel.id || !Number.isSafeInteger(siteHotelId) || siteHotelId < 1) return null
    return {...hotel, siteHotelId, source: 'https://www.tez-tour.com/hotel.html?id=' + hotel.id,
        gallerySource: 'https://www.tez-tour.com/data/siteGalleries.html?siteHotelId=' + siteHotelId + '&lang=ru'}
}

function galleryImageUrl(image: GalleryImage, siteHotelId: number) {
    if (image.folder != 'hotel/' + siteHotelId || typeof image.name != 'string') return null
    const validName = /^[^/\\\u0000]+\.(?:jpe?g|png|webp)$/i.test(image.name)
    const encodedSeparator = /%(?:2f|5c|00)/i.test(image.name)
    if (!validName || image.name.startsWith('.') || encodedSeparator) return null
    const name = image.name.replace(/\.([^.]+)$/, '_middle.$1')
    const url = new URL('https://s.tez-tour.com/')
    url.pathname = image.folder + '/' + name
    return url.href
}

export function readTezGallery(page: string, payload: unknown, hotel: HotelTarget) {
    const identity = readTezMediaIdentity(page, hotel)
    if (!identity) return {identity: null, photos: [], reason: 'hotel-identity-mismatch'}
    const gallery = payload as GalleryPayload | null
    if (gallery?.success != true) return {identity, photos: [], reason: 'gallery-unavailable'}
    const selected = [gallery.mainSiteGallery, ...(gallery.topSiteGalleries ?? []), ...(gallery.siteGalleries ?? [])]
    const urls = selected.flatMap(image => image ? [galleryImageUrl(image, identity.siteHotelId)] : [])
    const photos = [...new Set(urls.filter((url): url is string => !!url))].slice(0, 5).map(url => ({
        url, caption: hotel.name, source: identity.source,
    }))
    return {identity, photos, reason: photos.length ? null : 'property-gallery-empty'}
}

async function requestText(url: string) {
    const {stdout} = await command('curl', ['-fsS', '--max-time', '20', '--proto', '=https', '--max-filesize', '8388608', url],
        {maxBuffer: 8 * 1024 * 1024})
    return stdout
}

async function readCached(path: string, url: string, refresh: boolean) {
    if (!refresh) {
        try { return await readFile(path, 'utf8') } catch (error) {
            if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
        }
    }
    const text = await requestText(url)
    await writeFile(path, text)
    return text
}

async function verifyImage(url: string) {
    try {
        const {stdout} = await command('curl', [
            '-fsS', '--max-time', '15', '--proto', '=https', '--max-filesize', '5242880',
            '-o', '/dev/null', '-w', '%{http_code}\t%{content_type}\t%{size_download}', url,
        ], {maxBuffer: 1024})
        const [status, contentType, bytes] = stdout.trim().split('\t')
        const isImage = /^(image\/jpeg|image\/png|image\/webp)(?:;|$)/i.test(contentType ?? '')
        if (status != '200' || !isImage || Number(bytes) < 128) return null
        return {status: 200, contentType, bytes: Number(bytes), checkedAt: new Date().toISOString()}
    } catch { return null }
}

export async function collectTezMedia(deps: {hotels: HotelTarget[], cache: string, refresh: boolean}) {
    await mkdir(deps.cache, {recursive: true})
    const galleryQueue = createAsyncQueue(4)
    const imageQueue = createAsyncQueue(6)
    async function collect(hotel: HotelTarget) {
        const source = 'https://www.tez-tour.com/hotel.html?id=' + hotel.id
        function missing(reason: string) { return {hotel: null, unresolved: {...hotel, source, reason}} }
        try {
            const page = await readCached(join(deps.cache, hotel.id + '.html'), source, deps.refresh)
            const identity = readTezMediaIdentity(page, hotel)
            if (!identity) return missing('hotel-identity-mismatch')
            const galleryText = await readCached(join(deps.cache, 'gallery-' + identity.siteHotelId + '.json'), identity.gallerySource, deps.refresh)
            const parsed = readTezGallery(page, JSON.parse(galleryText), hotel)
            if (!parsed.photos.length) return missing(parsed.reason ?? 'property-gallery-empty')
            async function verifiedPhoto(photo: (typeof parsed.photos)[number]) {
                const verification = await verifyImage(photo.url)
                return verification ? {...photo, verification} : null
            }
            const results = await Promise.all(parsed.photos.map(photo => imageQueue.add(() => verifiedPhoto(photo))))
            const photos = results.filter((photo): photo is NonNullable<typeof photo> => !!photo)
            if (!photos.length) return missing('published-images-unavailable')
            return {hotel: {...identity, thumbnail: photos[0], photos, rights: 'supplier-permission-required' as const}, unresolved: null}
        } catch { return missing('source-unavailable') }
    }
    const results = await Promise.all(deps.hotels.map(hotel => galleryQueue.add(() => collect(hotel))))
    return {checkedOn: new Date().toISOString().slice(0, 10),
        hotels: results.flatMap(result => result.hotel ? [result.hotel] : []),
        unresolved: results.flatMap(result => result.unresolved ? [result.unresolved] : [])}
}

async function main() {
    const {values} = parseArgs({options: {
        destination: {type: 'string', default: 'hurghada'}, cache: {type: 'string'}, output: {type: 'string'},
        refresh: {type: 'boolean', default: false}, help: {type: 'boolean'},
    }})
    if (values.help) {
        console.log('node scripts/collect-tez-media.ts --destination hurghada --cache PAGES --output MANIFEST [--refresh]')
        return
    }
    const paths = ['tez-locations.json', 'tez-location-overrides.json']
    async function records(path: string) {
        const text = await readFile(new URL('../backend/partners/' + path, import.meta.url), 'utf8')
        return (JSON.parse(text).locations as (HotelTarget & {destination: string})[]).filter(hotel => hotel.destination == values.destination)
    }
    const groups = await Promise.all(paths.map(records))
    const hotels = [...new Map(groups.flat().map(hotel => [hotel.id, {id: hotel.id, name: hotel.name}])).values()]
    if (!hotels.length) throw new Error('Destination has no verified supplier hotel identities')
    const cache = resolve(values.cache ?? '.cache/tez-hotel-pages')
    const snapshot = await collectTezMedia({hotels, cache, refresh: values.refresh})
    if (values.output) {
        const path = resolve(values.output)
        await mkdir(dirname(path), {recursive: true})
        const temporary = path + '.' + process.pid + '.tmp'
        await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n')
        await rename(temporary, path)
    }
    console.log(JSON.stringify({requested: hotels.length, photographed: snapshot.hotels.length,
        verifiedImages: snapshot.hotels.reduce((sum, hotel) => sum + hotel.photos.length, 0),
        unresolved: snapshot.unresolved, output: values.output ?? null}))
}

if (import.meta.main) await main()
