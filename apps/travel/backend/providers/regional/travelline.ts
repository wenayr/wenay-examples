import {createHash} from 'node:crypto'
import type {ProviderDeps, ProviderOffer, ProviderQuery} from '../../../src/provider-contract.ts'
import {
    hotelOffer, jsonPost, object, ProviderQueryError, refs, requestJson, rows, stayAdapter, text,
} from '../stays/common.ts'

const providerId = 'travelline'
const docsUrl = 'https://www.travelline.ru/dev-portal/docs/api/'
const apiBase = 'https://partner.tlintegration.com'
// ISO alpha-2/alpha-3, UN M49 country table. Taiwan retains its ISO code.
// https://unstats.un.org/unsd/methodology/m49/overview/
const countryCodes: Record<string, string> = {
    AD: 'AND', AE: 'ARE', AF: 'AFG', AG: 'ATG', AI: 'AIA', AL: 'ALB', AM: 'ARM', AO: 'AGO', AQ: 'ATA', AR: 'ARG',
    AS: 'ASM', AT: 'AUT', AU: 'AUS', AW: 'ABW', AX: 'ALA', AZ: 'AZE', BA: 'BIH', BB: 'BRB', BD: 'BGD', BE: 'BEL',
    BF: 'BFA', BG: 'BGR', BH: 'BHR', BI: 'BDI', BJ: 'BEN', BL: 'BLM', BM: 'BMU', BN: 'BRN', BO: 'BOL', BQ: 'BES',
    BR: 'BRA', BS: 'BHS', BT: 'BTN', BV: 'BVT', BW: 'BWA', BY: 'BLR', BZ: 'BLZ', CA: 'CAN', CC: 'CCK', CD: 'COD',
    CF: 'CAF', CG: 'COG', CH: 'CHE', CI: 'CIV', CK: 'COK', CL: 'CHL', CM: 'CMR', CN: 'CHN', CO: 'COL', CR: 'CRI',
    CU: 'CUB', CV: 'CPV', CW: 'CUW', CX: 'CXR', CY: 'CYP', CZ: 'CZE', DE: 'DEU', DJ: 'DJI', DK: 'DNK', DM: 'DMA',
    DO: 'DOM', DZ: 'DZA', EC: 'ECU', EE: 'EST', EG: 'EGY', EH: 'ESH', ER: 'ERI', ES: 'ESP', ET: 'ETH', FI: 'FIN',
    FJ: 'FJI', FK: 'FLK', FM: 'FSM', FO: 'FRO', FR: 'FRA', GA: 'GAB', GB: 'GBR', GD: 'GRD', GE: 'GEO', GF: 'GUF',
    GG: 'GGY', GH: 'GHA', GI: 'GIB', GL: 'GRL', GM: 'GMB', GN: 'GIN', GP: 'GLP', GQ: 'GNQ', GR: 'GRC', GS: 'SGS',
    GT: 'GTM', GU: 'GUM', GW: 'GNB', GY: 'GUY', HK: 'HKG', HM: 'HMD', HN: 'HND', HR: 'HRV', HT: 'HTI', HU: 'HUN',
    ID: 'IDN', IE: 'IRL', IL: 'ISR', IM: 'IMN', IN: 'IND', IO: 'IOT', IQ: 'IRQ', IR: 'IRN', IS: 'ISL', IT: 'ITA',
    JE: 'JEY', JM: 'JAM', JO: 'JOR', JP: 'JPN', KE: 'KEN', KG: 'KGZ', KH: 'KHM', KI: 'KIR', KM: 'COM', KN: 'KNA',
    KP: 'PRK', KR: 'KOR', KW: 'KWT', KY: 'CYM', KZ: 'KAZ', LA: 'LAO', LB: 'LBN', LC: 'LCA', LI: 'LIE', LK: 'LKA',
    LR: 'LBR', LS: 'LSO', LT: 'LTU', LU: 'LUX', LV: 'LVA', LY: 'LBY', MA: 'MAR', MC: 'MCO', MD: 'MDA', ME: 'MNE',
    MF: 'MAF', MG: 'MDG', MH: 'MHL', MK: 'MKD', ML: 'MLI', MM: 'MMR', MN: 'MNG', MO: 'MAC', MP: 'MNP', MQ: 'MTQ',
    MR: 'MRT', MS: 'MSR', MT: 'MLT', MU: 'MUS', MV: 'MDV', MW: 'MWI', MX: 'MEX', MY: 'MYS', MZ: 'MOZ', NA: 'NAM',
    NC: 'NCL', NE: 'NER', NF: 'NFK', NG: 'NGA', NI: 'NIC', NL: 'NLD', NO: 'NOR', NP: 'NPL', NR: 'NRU', NU: 'NIU',
    NZ: 'NZL', OM: 'OMN', PA: 'PAN', PE: 'PER', PF: 'PYF', PG: 'PNG', PH: 'PHL', PK: 'PAK', PL: 'POL', PM: 'SPM',
    PN: 'PCN', PR: 'PRI', PS: 'PSE', PT: 'PRT', PW: 'PLW', PY: 'PRY', QA: 'QAT', RE: 'REU', RO: 'ROU', RS: 'SRB',
    RU: 'RUS', RW: 'RWA', SA: 'SAU', SB: 'SLB', SC: 'SYC', SD: 'SDN', SE: 'SWE', SG: 'SGP', SH: 'SHN', SI: 'SVN',
    SJ: 'SJM', SK: 'SVK', SL: 'SLE', SM: 'SMR', SN: 'SEN', SO: 'SOM', SR: 'SUR', SS: 'SSD', ST: 'STP', SV: 'SLV',
    SX: 'SXM', SY: 'SYR', SZ: 'SWZ', TC: 'TCA', TD: 'TCD', TF: 'ATF', TG: 'TGO', TH: 'THA', TJ: 'TJK', TK: 'TKL',
    TL: 'TLS', TM: 'TKM', TN: 'TUN', TO: 'TON', TR: 'TUR', TT: 'TTO', TV: 'TUV', TW: 'TWN', TZ: 'TZA', UA: 'UKR',
    UG: 'UGA', UM: 'UMI', US: 'USA', UY: 'URY', UZ: 'UZB', VA: 'VAT', VC: 'VCT', VE: 'VEN', VG: 'VGB', VI: 'VIR',
    VN: 'VNM', VU: 'VUT', WF: 'WLF', WS: 'WSM', YE: 'YEM', YT: 'MYT', ZA: 'ZAF', ZM: 'ZMB', ZW: 'ZWE',
}

function locationMatches(property: Record<string, unknown>, query: ProviderQuery) {
    const address = object(object(property.contactInfo).address)
    const country = text(address.countryCode).toUpperCase()
    if (query.country && country != query.country && country != countryCodes[query.country]) return false
    if (query.latitude !== undefined && query.longitude !== undefined) {
        const latitude = address.latitude
        const longitude = address.longitude
        if (typeof latitude != 'number' || typeof longitude != 'number') return false
        const radians = Math.PI / 180
        const latitudeDelta = (latitude - query.latitude) * radians
        const longitudeDelta = (longitude - query.longitude) * radians
        const distance = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitude * radians) * Math.cos(query.latitude * radians) *
            Math.sin(longitudeDelta / 2) ** 2
        return 6371 * 2 * Math.atan2(Math.sqrt(distance), Math.sqrt(Math.max(0, 1 - distance))) <= (query.radiusKm ?? 10)
    }
    if (query.destination) {
        const place = query.destination.trim().toLocaleLowerCase()
        return [address.cityName, address.region, property.name].some(value => text(value).trim().toLocaleLowerCase() == place)
    }
    return true
}

function credentialKey(deps: ProviderDeps) {
    return createHash('sha256').update(deps.env.TRAVELLINE_CLIENT_ID! + ':' + deps.env.TRAVELLINE_CLIENT_SECRET!).digest('hex')
}

function propertyIds(query: ProviderQuery, deps: ProviderDeps) {
    if ((query.rooms ?? 1) != 1) throw new ProviderQueryError('Этот метод TravelLine ищет размещение в одном номере на всех указанных взрослых.')
    const ids = refs(query, providerId).hotelIds ?? deps.env.TRAVELLINE_PROPERTY_IDS?.split(',').map(value => value.trim()).filter(Boolean) ?? []
    if (!ids.length) throw new ProviderQueryError('Нужны разрешённые propertyIds TravelLine в providerRefs.travelline.hotelIds или TRAVELLINE_PROPERTY_IDS.')
    if (ids.length > 200) throw new ProviderQueryError('Search API TravelLine принимает до 200 propertyIds в одном запросе.')
    return [...new Set(ids)]
}

function bookingUrl(value: unknown) {
    if (typeof value != 'string' || !value) return null
    try {
        const url = new URL(value)
        return url.protocol == 'https:' && !url.username && !url.password ? url.href : null
    } catch {return null}
}

function totalForStay(value: unknown) {
    const total = object(value)
    const before = total.priceBeforeTax
    const tax = total.taxAmount
    const valid = typeof before == 'number' && typeof tax == 'number' && Number.isFinite(before) && Number.isFinite(tax)
    if (!valid || before < 0 || tax < 0) return null
    return Math.round((before + tax) * 100) / 100
}

function readOffer(value: unknown, query: ProviderQuery, deps: ProviderDeps, metadata: Map<string, Record<string, unknown>>) {
    const stay = object(value)
    const id = text(stay.propertyId)
    const room = object(stay.roomType)
    const rate = object(stay.ratePlan)
    if (!text(room.id) || !text(rate.id)) return null
    const privateRate = [rate.corporateIds, rate.corporateCodes].some(values => Array.isArray(values) && values.length > 0)
    if (privateRate) return null
    const property = metadata.get(id) ?? {}
    const address = object(object(property.contactInfo).address)
    const quoteId = [text(room.id), text(rate.id), query.checkIn, query.checkOut, query.adults].join(':')
    const offer = hotelOffer(providerId, query, deps, {
        hotelId: id, rateId: quoteId, name: text(property.name) || 'TravelLine · ' + id,
        total: totalForStay(stay.total), currency: stay.currencyCode, sourceUrl: docsUrl,
        bookingUrl: bookingUrl(stay.bookingFormLink), board: text(stay.mealPlanCode) || null, taxes: true,
        priceType: 'retail', latitude: typeof address.latitude == 'number' ? address.latitude : undefined,
        longitude: typeof address.longitude == 'number' ? address.longitude : undefined,
        conditions: 'Полная сумма за один номер и весь период, включая переданные налоги и сборы к оплате при заезде. ' +
            text(stay.fullPlacementsName) + ' Доступ ограничен отелями, разрешёнными TravelLine и отельером. Отмена и дополнительные услуги проверяются перед оформлением.',
    })
    return offer
}

export function createTravelLineAdapter() {
    const tokens = new Map<string, {value: string, until: number}>()
    const authorizing = new Map<string, Promise<string>>()
    const properties = new Map<string, {value: Map<string, Record<string, unknown>>, until: number}>()

    async function token(deps: ProviderDeps) {
        const key = credentialKey(deps)
        const previous = tokens.get(key)
        if (previous && previous.until > deps.now().getTime()) return previous.value
        const pending = authorizing.get(key)
        if (pending) return pending
        async function authorize() {
            const body = new URLSearchParams({grant_type: 'client_credentials', client_id: deps.env.TRAVELLINE_CLIENT_ID!,
                client_secret: deps.env.TRAVELLINE_CLIENT_SECRET!})
            const response = object(await requestJson(deps, apiBase + '/auth/token', {method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: body.toString()}))
            const value = text(response.access_token)
            const expires = Number(response.expires_in)
            if (!value || !Number.isFinite(expires) || expires <= 0) throw new Error('TravelLine не подтвердил OAuth токен.')
            tokens.set(key, {value, until: deps.now().getTime() + Math.min(expires, 900) * 1000 - 10_000})
            return value
        }
        const work = authorize()
        authorizing.set(key, work)
        try {return await work} finally {authorizing.delete(key)}
    }

    async function metadata(accessToken: string, deps: ProviderDeps) {
        const key = credentialKey(deps)
        const previous = properties.get(key)
        if (previous && previous.until > deps.now().getTime()) return previous.value
        try {
            const response = await requestJson(deps, apiBase + '/api/content/v1/properties?include=All&languageCode=en&count=200',
                {headers: {Authorization: 'Bearer ' + accessToken, Accept: 'application/json'}})
            const value = new Map(rows(object(response).properties, 'TravelLine properties').map(object).map(property => [text(property.id), property]))
            properties.set(key, {value, until: deps.now().getTime() + 3_600_000})
            return value
        } catch {
            const value = new Map<string, Record<string, unknown>>()
            properties.set(key, {value, until: deps.now().getTime() + 60_000})
            return value
        }
    }

    async function execute(query: ProviderQuery, deps: ProviderDeps) {
        const deadline = AbortSignal.timeout(20_000)
        const upstream = deps.fetch
        async function boundedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
            const signals = init?.signal ? [deadline, init.signal] : [deadline]
            return upstream(input, {...init, signal: AbortSignal.any(signals)})
        }
        deps = {...deps, fetch: boundedFetch}
        const ids = propertyIds(query, deps)
        const accessToken = await token(deps)
        const headers = {Authorization: 'Bearer ' + accessToken}
        const payload = object(await requestJson(deps, apiBase + '/api/search/v1/properties/room-stays/search', jsonPost({
            propertyIds: ids, adults: query.adults, arrivalDate: query.checkIn, departureDate: query.checkOut,
            include: 'roomTypeShortContent|ratePlanShortContent',
        }, headers)))
        const selected = rows(payload.roomStays, 'TravelLine roomStays').map(object).filter(stay => ids.includes(text(stay.propertyId)))
        const names = selected.length ? await metadata(accessToken, deps) : new Map<string, Record<string, unknown>>()
        const offers: ProviderOffer[] = []
        for (const value of selected) {
            if (!locationMatches(names.get(text(value.propertyId)) ?? {}, query)) continue
            const offer = readOffer(value, query, deps, names)
            if (offer) offers.push(offer)
        }
        const geographicQuery = query.country || query.destination || query.latitude !== undefined || query.longitude !== undefined
        if (geographicQuery && selected.length > 0 && offers.length == 0) {
            throw new ProviderQueryError('TravelLine не подтвердил объекты в выбранном месте. Проверьте разрешённые IDs и доступ к Content API.')
        }
        return offers
    }

    const core = stayAdapter({id: providerId, website: docsUrl, requiredEnv: ['TRAVELLINE_CLIENT_ID', 'TRAVELLINE_CLIENT_SECRET']}, execute)
    async function search(query: ProviderQuery, deps: ProviderDeps) {
        const result = await core.search(query, deps)
        if (result.status != 'live') return result
        const offset = query.offset ?? 0
        const limit = query.limit ?? 30
        const total = result.offers.length
        const offers = result.offers.slice(offset, offset + limit)
        const nextOffset = offset + offers.length < total ? offset + offers.length : null
        return {...result, offers, total, nextOffset, partial: nextOffset !== null}
    }
    return {search}
}

export const {search} = createTravelLineAdapter()
export default {search}
