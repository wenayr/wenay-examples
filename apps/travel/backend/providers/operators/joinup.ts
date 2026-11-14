import type {ProviderAdapter, ProviderDeps, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, day, list, matchesDestination, object, page, queryIssue, result, scriptData, text} from './common.ts'

const providerId = 'joinup-packages'
const sourceUrl = 'https://joinup.ee/en/last-minute'

function lastMinuteData(html: string) {
    const payload = scriptData(html, '__NUXT_DATA__')
    if (!Array.isArray(payload) || payload.length > 100_000) throw new Error('Не получены данные витрины Join UP!.')
    const table: unknown[] = payload
    const cache = new Map<number, unknown>()
    function resolve(index: unknown, depth = 0): unknown {
        if (!Number.isSafeInteger(index) || Number(index) < 0 || depth > 40) return null
        const key = Number(index)
        if (cache.has(key)) return cache.get(key)
        const value: unknown = table[key]
        if (Array.isArray(value)) {
            if (typeof value[0] == 'string') return resolve(value[1], depth + 1)
            const items: unknown[] = []
            cache.set(key, items)
            items.push(...value.map(entry => resolve(entry, depth + 1)))
            return items
        }
        if (value && typeof value == 'object') {
            const record: Record<string, unknown> = Object.create(null)
            cache.set(key, record)
            for (const [name, pointer] of Object.entries(value)) record[name] = resolve(pointer, depth + 1)
            return record
        }
        return value
    }
    for (const value of table) {
        const pointer = object(value)['last-minute-en']
        if (typeof pointer != 'number') continue
        const data = object(resolve(pointer))
        if (Array.isArray(data.countries)) return data
    }
    throw new Error('Не получена коллекция Last Minute Join UP!.')
}

function bookingLink(tour: Record<string, unknown>, departure: string, nights: number) {
    const url = new URL('/en/hotel/' + encodeURIComponent(text(tour.id)), sourceUrl)
    url.search = new URLSearchParams({stay: String(nights), date: departure, origin: text(tour.origin_id),
        destinations: text(tour.destination_id), h_checkin: departure, h_destinations: text(tour.destination_id),
        pax_adl: '2', gtm_block: 'last-minute'}).toString()
    return url.toString()
}

function readTour(raw: unknown, country: Record<string, unknown>, query: ProviderQuery, deps: ProviderDeps) {
    const tour = object(raw)
    const params = object(country.search_params)
    const destination = object(country.country)
    const departure = day(tour.date)
    const nights = Number(tour.stay)
    const money = object(tour.total_price)
    const total = amount(money.price)
    const currency = text(object(money.currency).code)
    const adults = list(params.pax_adl)
    const originMatches = text(tour.origin_id) == '2552' && list(params.origins).includes(tour.origin_id)
    if (!originMatches || adults.length != 1 || adults[0] != query.adults) return null
    const validNights = Number.isInteger(nights) && nights >= 1 && nights <= 60
    if (!departure || !validNights) return null
    if (query.nights !== undefined && query.nights != nights) return null
    if (total === null || currency != 'EUR') return null
    if (!text(tour.id) || !text(tour.name)) return null
    if (query.returnDate || query.departure && query.departure != departure) return null
    if (departure < deps.now().toISOString().slice(0, 10)) return null
    const requested = query.providerRefs?.[providerId]?.destinationId ?? query.destination
    const names = [text(tour.city_name), text(tour.country_name), text(destination.name), text(destination.id), text(destination.slug)]
    if (!matchesDestination(requested, names)) return null
    const selected = query.providerRefs?.[providerId]?.hotelIds
    if (selected?.length && !selected.includes(text(tour.id))) return null
    const stars = Number.parseInt(text(object(tour.category).category))
    return {
        id: providerId + ':' + text(tour.id) + ':' + departure + ':' + nights, providerId, kind: 'packages', title: text(tour.name),
        price: {amount: total, currency, basis: 'party', type: 'retail'}, accuracy: 'published-from',
        sourceUrl, bookingUrl: bookingLink(tour, departure, nights), checkedAt: deps.now().toISOString(), expiresAt: null,
        origin: 'TLL', departure, nights, adults: query.adults,
        destination: {name: text(tour.city_name), country: text(tour.country_name), countryCode: text(destination.code_iso)},
        hotel: {id: text(tour.id), name: text(tour.name), stars: Number.isFinite(stars) ? stars : null},
        includes: {checkedBags: null, taxes: null, board: null, refundable: null}, comparisonKey: null,
        conditions: 'Опубликованный минимум Join UP! из Таллина за указанный состав, ночей ' + nights
            + '. Дата обратного рейса, даты заселения, тип номера, питание, багаж и сборы подтверждаются у оператора.',
        deal: {kind: 'supplier-sale', description: 'Этот отель и вылет включены оператором в коллекцию Last Minute. Размер скидки и срок акции не указаны.',
            evidenceUrl: sourceUrl, expiresAt: null},
    } satisfies ProviderOffer
}

export function readJoinupOffers(html: string, query: ProviderQuery, deps: ProviderDeps) {
    if (query.origin && query.origin != 'TLL') return []
    const data = lastMinuteData(html)
    const cms = object(data.cms)
    const content = list(cms.content).map(value => text(object(value).formattedContent)).join(' ')
    if (!/Last Minute Holidays from Tallinn/.test(content)) throw new Error('Не подтверждён аэропорт вылета коллекции Join UP!.')
    const offers = list(data.countries).flatMap(value => {
        const country = object(value)
        return list(country.tours).map(tour => readTour(tour, country, query, deps))
    })
    return offers.filter(offer => offer !== null).slice(0, query.limit ?? 50)
}

async function search(query: ProviderQuery, deps: ProviderDeps) {
    const issue = queryIssue(query)
    if (issue) return result(providerId, 'unsupported-query', issue, sourceUrl)
    if (query.returnDate) {
        return result(providerId, 'unsupported-query', 'Витрина Join UP! указывает вылет и число ночей. Для точной даты обратного рейса проверьте оператора.', sourceUrl)
    }
    if (query.origin && query.origin != 'TLL') {
        return result(providerId, 'unsupported-query', 'Эта опубликованная коллекция Join UP! вылетает из Таллина.', sourceUrl)
    }
    if (query.adults != 2) return result(providerId, 'unsupported-query', 'Публичная коллекция Join UP! рассчитана на двух взрослых.', sourceUrl)
    try {
        const snapshot = await page(deps, sourceUrl)
        const offers = readJoinupOffers(snapshot.html, query, {...deps, now: () => new Date(snapshot.checkedAt)})
        return {providerId, status: snapshot.cached ? 'cached' as const : 'live' as const, offers, checkedAt: snapshot.checkedAt, sourceUrl,
            description: 'Проверена опубликованная Last Minute коллекция Join UP! по датам и составу. Витрина содержит часть предложений оператора.'}
    } catch {
        return result(providerId, 'unavailable', 'Не удалось проверить публичную коллекцию Join UP!. Повторите запрос или откройте сайт оператора.', sourceUrl)
    }
}

export const adapter = {search} satisfies ProviderAdapter
