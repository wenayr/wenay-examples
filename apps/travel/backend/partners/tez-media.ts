import {existsSync, readFileSync} from 'node:fs'
import type {SupplyPhoto} from '../../src/supply-contract.ts'

interface MediaImage {url: string, caption?: string, source?: string}
interface MediaHotel {
    id: number
    name: string
    siteHotelId: number
    source: string
    gallerySource: string
    thumbnail: MediaImage | null
    photos: MediaImage[]
    rights: string
}

const path = new URL('./tez-media.json', import.meta.url)
const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as {hotels: MediaHotel[]} : {hotels: []}

function publicPhoto(hotel: MediaHotel, image: MediaImage): SupplyPhoto | null {
    try {
        const url = new URL(image.url)
        const source = new URL(hotel.source)
        const imageHost = url.protocol == 'https:' && url.hostname == 's.tez-tour.com'
        const propertyImage = url.pathname.startsWith('/hotel/' + hotel.siteHotelId + '/')
        const plainImage = !url.username && !url.password && !url.port
        if (!imageHost || !propertyImage || !plainImage) return null
        if (source.origin != 'https://www.tez-tour.com' || source.searchParams.get('id') != String(hotel.id)) return null
        return {
            url: url.href,
            sourceUrl: source.href,
            credit: 'TEZ TOUR · ' + hotel.name,
            license: 'Повторное использование согласуется с поставщиком',
            licenseUrl: source.href,
        }
    } catch {
        return null
    }
}

function hotelMedia(hotel: MediaHotel) {
    const photos = hotel.photos.map(image => publicPhoto(hotel, image)).filter((photo): photo is SupplyPhoto => photo != null)
    const thumbnail = hotel.thumbnail && publicPhoto(hotel, hotel.thumbnail)
    return {photo: thumbnail ?? photos[0] ?? null, photos}
}

const media = new Map(manifest.hotels.map(hotel => ['tez:' + hotel.id, hotelMedia(hotel)]))

export function tezHotelMedia(hotelId: string) {
    return media.get(hotelId) ?? {photo: null, photos: [] as SupplyPhoto[]}
}
