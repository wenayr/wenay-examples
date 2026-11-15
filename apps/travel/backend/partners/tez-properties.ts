import {createAsyncQueue} from 'wenay-common2/client'
import type {PackageHotel} from '../../src/package-contract.ts'
import type {PackageHotelGallery, PackageHotelInformation, PackageHotelPhoto} from '../../src/package-media-contract.ts'

interface PropertyMetadata {
    hotel: PackageHotel
    gallery: PackageHotelGallery | null
    information: PackageHotelInformation
}

interface CachedProperty {
    expires: number
    value: PropertyMetadata | null
}

function propertyId(value: string) {
    const match = /^tez:([1-9]\d*)$/.exec(value)
    const id = Number(match?.[1])
    return Number.isSafeInteger(id) && id > 0 ? id : null
}

function plainText(value: string) {
    return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}

function hotelWebsite(page: string) {
    const spans = [...page.matchAll(/<span\b[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/span>/gi)]
    const contact = spans.find(entry => {
        const classes = entry[1].split(/\s+/)
        return classes.includes('contacts') && classes.includes('site')
    })
    const website = /<a\b[^>]*href=["']([^"']+)["']/i.exec(contact?.[2] ?? '')?.[1]
    if (!website) return undefined
    try {
        const url = new URL(website.replace(/&amp;/g, '&'))
        const protocol = url.protocol == 'http:' || url.protocol == 'https:'
        const publicName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
        const privateName = /\.(?:local|localhost|internal|test|invalid|example|lan|home)$/i.test(url.hostname)
        const plain = !url.username && !url.password && !url.port
        const safe = protocol && publicName && !privateName && plain
        if (!safe) return undefined
        return url.href
    } catch {
        return undefined
    }
}

function singleDistance(text: string, match: RegExpExecArray | null) {
    if (!match) return undefined
    const prefix = text.slice(Math.max(0, match.index - 24), match.index)
    if (/\d\s*[-–—]\s*$/.test(prefix)) return undefined
    return match[1]
}

function hotelInformation(page: string, id: number, checkedOn: string): PackageHotelInformation {
    const details = /<div\b[^>]*id=["']t001["'][^>]*>([\s\S]*?)(?:<div\b|$)/i.exec(page)?.[1] ?? ''
    const text = plainText(details)
    const facts: {label: string, value: string}[] = []
    const airport = singleDistance(text, /(?<![\d.,\-–—])\b(\d+(?:[.,]\d+)?)\s*км\s*от\s*аэропорта/i.exec(text))
    const centre = singleDistance(text, /(?<![\d.,\-–—])\b(\d+(?:[.,]\d+)?)\s*км\s*от\s*центра\s*города/i.exec(text))
    const opening = /Открыт\s+в\s+((?:19|20)\d{2})\s+году/i.exec(text)?.[1]
    const renovation = /Последняя\s+(частичная\s+)?реновация[^.]{0,60}?((?:19|20)\d{2})\s+году/i.exec(text)
    const rooms = /Всего\s+(\d[\d\s]{0,6})\s+номер/i.exec(text)?.[1]?.replace(/\s/g, '')
    if (airport) facts.push({label: 'До аэропорта', value: airport + ' км'})
    if (centre) facts.push({label: 'До центра города', value: centre + ' км'})
    const coastal = /(?:^|\s)на\s+(?:самом\s+)?берегу\s+моря/i.test(text)
    const negativeCoast = /(?:^|\s)не\s+(?:находится\s+|расположен\s+)?на\s+(?:самом\s+)?берегу\s+моря/i.test(text)
    if (coastal && !negativeCoast) facts.push({label: 'Расположение', value: 'На берегу моря'})
    if (opening) facts.push({label: 'Год открытия', value: opening})
    if (renovation) facts.push({label: 'Последняя реновация', value: renovation[2] + (renovation[1] ? ' (частичная)' : '')})
    const validRooms = rooms && Number(rooms) > 0 && Number(rooms) <= 100_000
    if (validRooms) facts.push({label: 'Количество номеров', value: rooms})
    return {hotelId: 'tez:' + id, sourceUrl: 'https://www.tez-tour.com/hotel.html?id=' + id,
        checkedOn, website: hotelWebsite(page), facts}
}

function propertyPage(page: string, id: number, checkedOn: string, fallbackName?: string) {
    const exactId = Number(/\bHOTEL_ID\s*=\s*(\d+)/.exec(page)?.[1])
    if (exactId != id) return null
    const name = plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page)?.[1] ?? fallbackName ?? '')
    if (!name) return null
    const siteHotelId = Number(/\bSITE_HOTEL_ID\s*=\s*(\d+)/.exec(page)?.[1])
    const latitude = Number(/\bGEO_LOCATION_LATITUDE\s*=\s*([+-]?[\d.]+)/.exec(page)?.[1] ?? NaN)
    const longitude = Number(/\bGEO_LOCATION_LONGITUDE\s*=\s*([+-]?[\d.]+)/.exec(page)?.[1] ?? NaN)
    const validLatitude = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    const validLongitude = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    const mapped = validLatitude && validLongitude && (latitude != 0 || longitude != 0)
    const url = 'https://www.tez-tour.com/hotel.html?id=' + id
    const rating = /\b([1-5])\s*\*/.exec(name)
    const hotel = {
        id: 'tez:' + id, name, stars: rating ? Number(rating[1]) : null, url,
        latitude: mapped ? latitude : null,
        longitude: mapped ? longitude : null,
        coordinateSource: mapped ? {url, checkedOn, precision: 'hotel-marker' as const} : undefined,
    } satisfies PackageHotel
    return {hotel, information: hotelInformation(page, id, checkedOn),
        siteHotelId: Number.isSafeInteger(siteHotelId) && siteHotelId > 0 ? siteHotelId : null}
}

function galleryPhotos(payload: unknown, hotel: PackageHotel, siteHotelId: number): PackageHotelPhoto[] {
    if (!payload || typeof payload != 'object') return []
    const gallery = payload as {success?: unknown, mainSiteGallery?: unknown, topSiteGalleries?: unknown, siteGalleries?: unknown}
    if (gallery.success != true) return []
    const top = Array.isArray(gallery.topSiteGalleries) ? gallery.topSiteGalleries : []
    const rest = Array.isArray(gallery.siteGalleries) ? gallery.siteGalleries : []
    const images = [gallery.mainSiteGallery, ...top, ...rest]
    const photos = new Map<string, PackageHotelPhoto>()
    for (const item of images) {
        if (!item || typeof item != 'object') continue
        const image = item as {folder?: unknown, name?: unknown}
        if (image.folder != 'hotel/' + siteHotelId || typeof image.name != 'string') continue
        const invalidName = /[/\\\u0000-\u001f\u007f]/.test(image.name) || /%(?:2f|5c|00|0a|0d)/i.test(image.name)
        const format = /\.(?:jpe?g|png|webp)$/i.test(image.name)
        if (invalidName || !format || image.name.startsWith('.')) continue
        const url = new URL('https://s.tez-tour.com/')
        url.pathname = image.folder + '/' + image.name.replace(/\.([^.]+)$/, '_middle.$1')
        photos.set(url.href, {
            url: url.href, sourceImageUrl: url.href, sourceUrl: hotel.url, credit: 'TEZ TOUR · ' + hotel.name,
            license: 'Повторное использование согласуется с поставщиком', licenseUrl: hotel.url,
        })
        if (photos.size == 5) break
    }
    return [...photos.values()]
}

function missingMetadata(hotel: PackageHotel) {
    const mapped = Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude)
    return !mapped || !hotel.photo || !hotel.photos?.length
}

function mergeProperty(hotel: PackageHotel, metadata: PropertyMetadata | null | undefined, destinationId: string): PackageHotel {
    if (!metadata) return {...hotel, destinationId: hotel.destinationId ?? destinationId}
    const mapped = Number.isFinite(hotel.latitude) && Number.isFinite(hotel.longitude)
    return {
        ...metadata.hotel, ...hotel, destinationId: hotel.destinationId ?? destinationId,
        latitude: mapped ? hotel.latitude : metadata.hotel.latitude,
        longitude: mapped ? hotel.longitude : metadata.hotel.longitude,
        coordinateSource: mapped ? hotel.coordinateSource : metadata.hotel.coordinateSource,
        photo: hotel.photo ?? metadata.hotel.photo,
        photos: hotel.photos?.length ? hotel.photos : metadata.hotel.photos,
    }
}

async function observe<T>(work: Promise<T>, signal: AbortSignal) {
    signal.throwIfAborted()
    return new Promise<T>(function waitForCaller(resolve, reject) {
        function aborted() { reject(signal.reason) }
        signal.addEventListener('abort', aborted, {once: true})
        function settled() { signal.removeEventListener('abort', aborted) }
        work.then(resolve, reject).then(settled, settled)
    })
}

// HTML/gallery metadata is independent of prices and never invents a property position.
export function createTezProperties(deps: {fetch: typeof fetch, now: () => Date}) {
    const queue = createAsyncQueue(4)
    const cache = new Map<string, CachedProperty>()
    const pending = new Map<string, Promise<PropertyMetadata | null>>()
    const requests = new Map<string, Promise<string>>()

    function cached(hotelId: string) {
        const entry = cache.get(hotelId)
        if (!entry) return null
        cache.delete(hotelId)
        if (entry.expires <= deps.now().getTime()) return null
        cache.set(hotelId, entry)
        return entry
    }

    function remember(hotelId: string, value: PropertyMetadata | null) {
        const complete = value && !missingMetadata(value.hotel)
        const ttl = complete ? 86_400_000 : 600_000
        cache.delete(hotelId)
        while (cache.size >= 512) cache.delete(cache.keys().next().value!)
        cache.set(hotelId, {value, expires: deps.now().getTime() + ttl})
    }

    async function requestText(url: string, signal: AbortSignal) {
        const existing = requests.get(url)
        if (existing) return observe(existing, signal)
        async function readResponse() {
            const response = await deps.fetch(url, {signal, redirect: 'error'})
            if (!response.ok) throw new Error('Property metadata unavailable')
            const text = await response.text()
            if (text.length > 2_097_152) throw new Error('Property metadata too large')
            return text
        }
        const work = readResponse()
        requests.set(url, work)
        try { return await work } finally { requests.delete(url) }
    }

    async function fetchProperty(id: number, fallbackName?: string) {
        const signal = AbortSignal.timeout(10_000)
        const checkedOn = deps.now().toISOString().slice(0, 10)
        let property: ReturnType<typeof propertyPage> = null
        try {
            const page = await requestText('https://www.tez-tour.com/hotel.html?id=' + id, signal)
            property = propertyPage(page, id, checkedOn, fallbackName)
            if (!property) return null
            if (!property.siteHotelId) return {hotel: property.hotel, gallery: null, information: property.information}
            const url = 'https://www.tez-tour.com/data/siteGalleries.html?siteHotelId=' + property.siteHotelId + '&lang=ru'
            const photos = galleryPhotos(JSON.parse(await requestText(url, signal)), property.hotel, property.siteHotelId)
            const hotel = {...property.hotel, photo: photos[0] ?? null, photos}
            const gallery = photos.length ? {hotelId: hotel.id, name: hotel.name, hotelUrl: hotel.url, checkedOn, photos} : null
            return {hotel, gallery, information: property.information} satisfies PropertyMetadata
        } catch {
            return property ? {hotel: property.hotel, gallery: null, information: property.information} : null
        }
    }

    function load(hotelId: string, fallbackName?: string) {
        const id = propertyId(hotelId)
        if (!id) return Promise.resolve(null)
        const entry = cached(hotelId)
        if (entry) return Promise.resolve(entry.value)
        const existing = pending.get(hotelId)
        if (existing) return existing
        if (pending.size >= 512) return Promise.resolve(null)
        const work = queue.add(async function collectProperty() {
            const result = await fetchProperty(id, fallbackName)
            remember(hotelId, result)
            return result
        }).finally(function releaseProperty() { pending.delete(hotelId) })
        pending.set(hotelId, work)
        return work
    }

    function read(hotelId: string) {
        return cached(hotelId)?.value?.hotel ?? null
    }

    async function enrich(destinationId: string, hotels: readonly PackageHotel[], signal?: AbortSignal) {
        signal?.throwIfAborted()
        const selected = new Map<string, PackageHotel>()
        for (const hotel of hotels) {
            if (!propertyId(hotel.id) || !missingMetadata(hotel) || cached(hotel.id)) continue
            selected.set(hotel.id, hotel)
            if (selected.size == 8) break
        }
        const work = Promise.all([...selected.values()].map(hotel => load(hotel.id, hotel.name)))
        const deadline = AbortSignal.timeout(20_000)
        const waiting = signal ? AbortSignal.any([signal, deadline]) : deadline
        try { await observe(work, waiting) } catch {
            signal?.throwIfAborted()
        }
        signal?.throwIfAborted()
        return hotels.map(hotel => mergeProperty(hotel, cached(hotel.id)?.value, destinationId))
    }

    async function gallery(hotelId: string, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const deadline = AbortSignal.timeout(20_000)
        const waiting = signal ? AbortSignal.any([signal, deadline]) : deadline
        const property = await observe(load(hotelId), waiting)
        signal?.throwIfAborted()
        return property?.gallery ?? null
    }

    async function information(hotelId: string, signal?: AbortSignal) {
        signal?.throwIfAborted()
        const deadline = AbortSignal.timeout(20_000)
        const waiting = signal ? AbortSignal.any([signal, deadline]) : deadline
        const property = await observe(load(hotelId), waiting)
        signal?.throwIfAborted()
        return property?.information ?? null
    }

    return {read, enrich, gallery, information}
}

export type TezProperties = ReturnType<typeof createTezProperties>
