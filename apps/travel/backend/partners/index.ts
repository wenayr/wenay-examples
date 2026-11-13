import type {SupplyDestination, SupplyHotel, SupplyLink, SupplyOptions, SupplySource} from '../../src/supply-contract.ts'
import {createTezProvider} from './tez.ts'

interface Query {
    hotel?: SupplyHotel | null
    destination: SupplyDestination
    checkIn?: string | null
    checkOut?: string | null
    adults: number
}

// Routes published in the destination menu of the Estonian operator.
const novatours = new Map([
    ['hurghada', 'EG/HRG'], ['sharm-el-sheikh', 'EG/SSH'], ['sharm', 'EG/SSH'],
    ['phuket', 'TH/HKT'], ['bangkok', 'TH/BKK'], ['bali', 'ID/DPS'], ['antalya', 'TR/AYT'], ['tenerife', 'CN/TFS'],
])

function bookingSearch(query: Query, aid?: string): SupplyLink {
    const url = new URL('https://www.booking.com/searchresults.html')
    const {destination, hotel} = query
    url.searchParams.set('ss', [hotel?.name, destination.name, destination.country].filter(Boolean).join(', '))
    url.searchParams.set('group_adults', String(query.adults))
    url.searchParams.set('no_rooms', '1')
    url.searchParams.set('selected_currency', 'EUR')
    if (query.checkIn && query.checkOut) {
        url.searchParams.set('checkin', query.checkIn)
        url.searchParams.set('checkout', query.checkOut)
    }
    if (aid && /^[1-9]\d*$/.test(aid)) url.searchParams.set('aid', aid)
    return {
        id: 'booking', label: hotel ? 'Найти отель на Booking.com' : 'Искать на Booking.com', url: url.href,
        kind: url.searchParams.has('aid') ? 'affiliate' : 'search',
        scope: hotel ? 'hotel' : 'destination',
    }
}

function expediaSearch(query: Query): SupplyLink {
    const base = 'https://www.expedia.com/go/hotel/search/Destination'
    const url = new URL(query.checkIn && query.checkOut ? base + '/' + query.checkIn + '/' + query.checkOut : base)
    url.searchParams.set('CityName', query.destination.name)
    url.searchParams.set('NumRoom', '1')
    url.searchParams.set('NumAdult-Room1', String(query.adults))
    return {id: 'expedia', label: 'Размещение на Expedia', url: url.href, kind: 'search', scope: 'destination'}
}

function publicWebsite(value?: string | null) {
    if (!value) return null
    try {
        const url = new URL(value)
        return url.protocol == 'https:' && !url.username && !url.password ? url.href : null
    } catch {
        return null
    }
}

function dated(value?: string | null) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const date = new Date(value)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) == value
}

function validate(query: Query) {
    if (!Number.isInteger(query.adults) || query.adults < 1 || query.adults > 30) throw new RangeError('Некорректный состав гостей')
    if (!query.checkIn && !query.checkOut) return
    if (!dated(query.checkIn) || !dated(query.checkOut) || query.checkOut! <= query.checkIn!) throw new RangeError('Некорректные даты поездки')
}

export function createPartnerOptions(deps: {fetch: typeof fetch, now: () => Date, bookingAid?: string}) {
    const tez = createTezProvider(deps)
    async function options(query: Query): Promise<SupplyOptions> {
        validate(query)
        const links = [bookingSearch(query, deps.bookingAid), expediaSearch(query)]
        const nova = novatours.get(query.destination.id)
        if (nova) {
            links.push({id: 'novatours', label: 'Туры Novatours из Эстонии', url: 'https://www.novatours.ee/travels/' + nova,
                kind: 'search', scope: 'destination'})
        }
        const official = publicWebsite(query.hotel?.website)
        if (official) links.push({id: 'official', label: 'Сайт объекта', kind: 'search', scope: 'hotel', url: official})
        const sources: SupplySource[] = links.map(link => ({
            id: link.id, name: link.label, status: 'handoff', updatedAt: null,
            description: link.id == 'novatours' ? 'У оператора повторно выберите даты и гостей.' : 'Наличие и цену показывает выбранный сайт.',
        }))
        // An open-data place ID is not a supplier property ID. Avoid attributing a resort quote to a named hotel.
        if (query.hotel) return {links, sources, offers: []}
        const tariffs = await tez.search({...query, destinationId: query.destination.id})
        if (tariffs.source.status != 'handoff') sources.unshift(tariffs.source)
        return {links, sources, offers: tariffs.offers}
    }
    return options
}

export const getPartnerOptions = createPartnerOptions({fetch, now: () => new Date(), bookingAid: process.env.TRAVEL_BOOKING_AID})
