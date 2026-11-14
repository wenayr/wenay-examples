import {createHash} from 'node:crypto'
import type {ProviderDeps, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text} from './common.ts'

const providerId = 'pricetravel'
const website = 'https://connect.pricetravel.com'
const tokens = new Map<string, {value: string, until: number}>()

function baseUrl(deps: ProviderDeps) {
    const sandbox = deps.env.PRICETRAVEL_SANDBOX == 'true'
    const base = deps.env.PRICETRAVEL_BASE_URL ?? (sandbox ? 'https://ptapi-int.pricetravel.com' : 'https://ptapi.pricetravel.com')
    const url = new URL(base)
    const allowed = /^ptapi(?:-[a-z0-9-]+)?\.pricetravel\.com$/.test(url.hostname) && url.protocol == 'https:'
    if (!allowed || url.username || url.password) throw new ProviderQueryError('Используйте назначенный HTTPS адрес API PriceTravel.')
    if (url.hostname == 'ptapi-int.pricetravel.com' && !sandbox) throw new ProviderQueryError('Integration среда требует PRICETRAVEL_SANDBOX=true.')
    return url.origin
}

async function token(deps: ProviderDeps, base: string) {
    const key = base + ':' + createHash('sha256').update(deps.env.PRICETRAVEL_CLIENT_ID! + ':' + deps.env.PRICETRAVEL_CLIENT_SECRET!).digest('hex')
    const previous = tokens.get(key)
    if (previous && previous.until > deps.now().getTime()) return previous.value
    const body = new URLSearchParams({client_id: deps.env.PRICETRAVEL_CLIENT_ID!, client_secret: deps.env.PRICETRAVEL_CLIENT_SECRET!,
        grant_type: 'client_credentials', scopes: 'admin_api'})
    const response = object(await requestJson(deps, base + '/connect/token', {method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: body.toString()}))
    const value = text(response.access_token)
    const ttl = Number(response.expires_in)
    if (!value || !Number.isFinite(ttl) || ttl <= 0) throw new Error('PriceTravel не подтвердил OAuth токен.')
    if (tokens.size >= 8) tokens.delete(tokens.keys().next().value!)
    tokens.set(key, {value, until: deps.now().getTime() + ttl * 800})
    return value
}

export function buildPriceTravelRequest(query: ProviderQuery) {
    if ((query.rooms ?? 1) != 1) throw new ProviderQueryError('В этом адаптере PriceTravel поддерживается один номер на всех взрослых.')
    if (!query.adultAges || query.adultAges.length != query.adults) throw new ProviderQueryError('PriceTravel требует возраст каждого взрослого.')
    const ids = refs(query, providerId).hotelIds ?? []
    if (!ids.length || ids.length > 50 || !ids.every(id => /^[1-9]\d*$/.test(id))) {
        throw new ProviderQueryError('Передайте до 50 hotel IDs PriceTravel через providerRefs.pricetravel.hotelIds.')
    }
    const nights = (Date.parse(query.checkOut!) - Date.parse(query.checkIn!)) / 86_400_000
    if (nights > 28) throw new ProviderQueryError('PriceTravel позволяет до 28 ночей в одном запросе.')
    return {checkIn: query.checkIn, checkOut: query.checkOut, hotelIds: ids.map(Number),
        roomCriteria: [{paxes: query.adultAges.map(age => ({age}))}], ...(query.bookerCountry ? {market: query.bookerCountry} : {})}
}

export function readPriceTravel(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const hotels = rows(object(payload).hotels, 'PriceTravel hotels')
    const requested = new Set(refs(query, providerId).hotelIds)
    const offers: ProviderOffer[] = []
    for (const value of hotels) {
        const hotel = object(value)
        const hotelId = String(hotel.id ?? '')
        if (!requested.has(hotelId)) continue
        for (const roomValue of rows(hotel.rooms, 'PriceTravel rooms')) {
            const room = object(roomValue)
            for (const rateValue of rows(room.rates, 'PriceTravel rates')) {
                const rate = object(rateValue)
                const rateKey = text(rate.rateKey)
                if (!rateKey) continue
                const retail = Number(rate.publicAmount) > 0
                const excludedFees = Number(object(rate.feesNotIncluded).total)
                const policies = rows(rate.reservationPolicies, 'PriceTravel policies').map(object)
                const board = policies.find(policy => policy.type == 'MEAL_PLAN')
                const offer = hotelOffer(providerId, query, deps, {hotelId, rateId: createHash('sha256').update(rateKey).digest('hex').slice(0, 24),
                    name: text(hotel.name), total: retail ? rate.publicAmount : rate.amount, currency: rate.clientCurrency,
                    sourceUrl: website + '/docs/endpoints/rates/', priceType: retail ? 'retail' : 'net', board: text(board?.description) || null,
                    taxes: excludedFees > 0 ? false : null, expiresAt: new Date(deps.now().getTime() + 3_600_000).toISOString(),
                    conditions: 'Тариф на один запрошенный номер за весь период. ' + text(room.name) + '. ' +
                        'Возврат и дополнительные сборы проверяются через CheckRates перед оформлением.'})
                if (offer) offers.push(offer)
            }
        }
    }
    return offers
}

export const search = stayAdapter({id: providerId, website, requiredEnv: ['PRICETRAVEL_CLIENT_ID', 'PRICETRAVEL_CLIENT_SECRET']}, async (query, deps) => {
    const body = buildPriceTravelRequest(query)
    const base = baseUrl(deps)
    const accessToken = await token(deps, base)
    const payload = await requestJson(deps, base + '/1.0/hotels/rates?language=en-us', jsonPost(body, {Authorization: 'Bearer ' + accessToken}))
    return readPriceTravel(payload, query, deps)
}).search
