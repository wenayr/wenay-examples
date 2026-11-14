import {existsSync, readFileSync} from 'node:fs'
import type {SupplyPhoto} from '../../src/supply-contract.ts'
import type {PackageHotelGallery} from '../../src/package-media-contract.ts'

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
const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as {checkedOn?: string, hotels: MediaHotel[]} : {hotels: []}

function publicPhoto(hotel: MediaHotel, image: MediaImage): SupplyPhoto | null {
    try {
        const url = new URL(image.url)
        const source = new URL(hotel.source)
        const imageHost = url.protocol == 'https:' && url.hostname == 's.tez-tour.com'
        const propertyImage = url.pathname.startsWith('/hotel/' + hotel.siteHotelId + '/')
        const plainImage = !url.username && !url.password && !url.port
        if (!imageHost || !propertyImage || !plainImage) return null
        const hotelPage = source.origin == 'https://www.tez-tour.com' && source.pathname == '/hotel.html'
        const exactHotel = source.searchParams.get('id') == String(hotel.id)
        const plainSource = !source.username && !source.password && !source.port
        if (!hotelPage || !exactHotel || !plainSource) return null
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
    const gallery: PackageHotelGallery | null = photos.length ? {
        hotelId: 'tez:' + hotel.id, name: hotel.name, hotelUrl: photos[0].sourceUrl,
        checkedOn: manifest.checkedOn ?? null,
        photos: photos.map(photo => ({...photo, sourceImageUrl: photo.url})),
    } satisfies PackageHotelGallery : null
    return {photo: thumbnail ?? photos[0] ?? null, photos, gallery}
}

const media = new Map(manifest.hotels.map(hotel => ['tez:' + hotel.id, hotelMedia(hotel)]))

export function tezHotelMedia(hotelId: string) {
    const item = media.get(hotelId)
    return {photo: item?.photo ?? null, photos: item?.photos ?? [] as SupplyPhoto[]}
}

// Property images are independent of dates, availability and the price provider queue.
export function tezHotelGallery(hotelId: string) {
    return media.get(hotelId)?.gallery ?? null
}
