import type {ProviderDeps, ProviderQuery} from '../../../src/provider-contract.ts'
import {amount, hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, roomAdults, rows, stayAdapter, text} from './common.ts'

const document = `query WenayHotelSearch($criteria: HotelCriteriaSearchInput!, $settings: HotelSettingsInput!) {
    hotelX { search(criteria: $criteria, settings: $settings) {
        options { id hotelCode hotelName boardCode status price { currency gross net binding minimumSellingPrice } cancelPolicy { refundable } }
        errors { code description }
    } }
}`

export function travelgateRequest(query: ProviderQuery, deps: ProviderDeps) {
    const hotels = refs(query, 'travelgate').hotelIds
    if (!hotels?.length) throw new ProviderQueryError('Для Travelgate нужны коды отелей в согласованном контексте HotelX.')
    const ages = query.adultAges
    const validAges = ages?.every(age => Number.isInteger(age) && age >= 18)
    if (!ages || ages.length != query.adults || !validAges) {
        throw new ProviderQueryError('Travelgate требует фактический возраст каждого взрослого в adultAges.')
    }
    let offset = 0
    const occupancies = roomAdults(query).map(count => {
        const paxes = ages.slice(offset, offset + count).map(age => ({age}))
        offset += count
        return {paxes}
    })
    const criteria = {checkIn: query.checkIn, checkOut: query.checkOut, hotels: hotels.slice(0, 200),
        occupancies, currency: query.currency ?? 'EUR', nationality: query.nationality, language: 'en',
        markets: query.bookerCountry ? [query.bookerCountry] : undefined}
    const settings = {client: deps.env.TRAVELGATE_CLIENT, context: deps.env.TRAVELGATE_CONTEXT ?? 'FASTX',
        testMode: deps.env.TRAVELGATE_SANDBOX == 'true', timeout: 10000, auditTransactions: false}
    return jsonPost({query: document, variables: {criteria, settings}},
        {Authorization: 'Apikey ' + deps.env.TRAVELGATE_API_KEY, 'Accept-Encoding': 'gzip', Connection: 'keep-alive'})
}

export function readTravelgate(payload: unknown, query: ProviderQuery, deps: ProviderDeps) {
    const root = object(payload)
    if (root.errors) throw new Error('Travelgate GraphQL вернул ошибку')
    const result = object(object(object(root.data).hotelX).search)
    if (!Array.isArray(result.options) && result.errors) throw new Error('Travelgate не подтвердил поиск')
    return rows(result.options, 'Travelgate options').flatMap(value => {
        const option = object(value)
        if (option.status != 'OK') return []
        const price = object(option.price)
        const gross = amount(price.gross)
        const minimum = amount(price.minimumSellingPrice)
        const retail = minimum ?? gross
        const net = amount(price.net)
        const refundable = object(option.cancelPolicy).refundable
        const offer = hotelOffer('travelgate', query, deps, {hotelId: text(option.hotelCode), rateId: text(option.id),
            name: text(option.hotelName), total: retail ?? net, currency: price.currency, sourceUrl: 'https://www.travelgate.com/',
            board: text(option.boardCode) || null, refundable: typeof refundable == 'boolean' ? refundable : null,
            priceType: retail ? 'retail' : 'net',
            accuracy: retail ? 'live-offer' : 'published-from',
            conditions: retail ?
                'Розничная стоимость HotelX с учётом обязательного минимального тарифа поставщика. Доплаты, сборы на месте и доступность уточняются в Quote.' :
                'Нетто-стоимость для агентства. Розничная цена не определена, перед бронированием нужен Quote.'})
        return offer ? [offer] : []
    })
}

export const {search} = stayAdapter({id: 'travelgate', website: 'https://www.travelgate.com/',
    requiredEnv: ['TRAVELGATE_API_KEY', 'TRAVELGATE_CLIENT']}, async function execute(query, deps) {
    return readTravelgate(await requestJson(deps, 'https://api-shopping.travelgate.com/graphql', travelgateRequest(query, deps)), query, deps)
})
