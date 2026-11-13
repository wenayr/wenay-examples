import type {tDestination} from './preferences.ts'
import type {HotelId} from '../demo/catalog.ts'

const euro = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0})
const dayMonth = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', timeZone: 'UTC'})
const plural = new Intl.PluralRules('ru-RU')

export function totalLabel(cents: number) { return euro.format(cents / 100) }
export function dateLabel(iso: string) { return dayMonth.format(new Date(iso + 'T00:00:00Z')) }
export function hotelCount(n: number) {
    const form = plural.select(n)
    const nouns = {one: 'отель', few: 'отеля', many: 'отелей', zero: 'отелей', two: 'отеля', other: 'отелей'} as const
    const noun = nouns[form]
    return n + ' ' + noun
}

const photoForHotel = {
    palm: 2, marina: 3, dune: 1, coral: 2, kata: 2, karon: 3, kamala: 1, petra: 2, chloraka: 3,
} as const satisfies Record<HotelId, number>

export function photo(destination: tDestination, hotel?: HotelId) {
    const index = hotel ? photoForHotel[hotel] : 1
    return import.meta.env.BASE_URL + 'images/' + destination + '-' + index + '.webp'
}
