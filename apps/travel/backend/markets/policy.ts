import type {ProviderQuery} from '../../src/provider-contract.ts'
import {airportByCode} from '../flights/airports.ts'
import {marketCities} from './locations.ts'
import {marketCountries, type MarketNotice, type tMarketCountry} from '../../src/market-contract.ts'

export const operatingModel = {country: 'EE', activity: 'travel-agency', checkedAt: '2026-11-14'} as const

export const ukraineAirspaceNotice = {
    kind: 'airspace', title: 'Гражданское воздушное пространство закрыто',
    description: 'EASA ссылается на украинский NOTAM A0021/26 о закрытых FIR для гражданских полётов. ' +
        'Поиск из украинских аэропортов и в них приостановлен. Перевозчики Украины могут выполнять рейсы из иностранных аэропортов. ' +
        'Срок пересмотра бюллетеня 31 января 2027 года не означает дату открытия.',
    evidence: [{title: 'EASA CZIB-2022-01R14, украинский NOTAM A0021/26',
        url: 'https://www.easa.europa.eu/en/domains/air-operations/czibs/czib-2022-01r14', checkedAt: '2026-11-14'}],
} satisfies MarketNotice

export const russiaTourismNotice = {
    kind: 'commercial', title: 'Туристическое направление требует правовой проверки',
    description: 'Для текущей модели эстонского агентства действует проверка применимости Article 5n(2) Regulation 833/2014 к туризму в России. ' +
        'Персонализированный туристический поиск назначения Россия пока не активирован. Гражданство путешественника и вылет из России в другую страну ' +
        'не являются таким запретом. Применимость исключений, включая регулируемые CRS, устанавливается отдельно.',
    evidence: [{title: 'Европейская комиссия, FAQ Article 5n, вопросы 40–47',
        url: 'https://finance.ec.europa.eu/system/files/2023-07/faqs-sanctions-russia-services-provision_en.pdf', checkedAt: '2026-11-14'},
    {title: 'Regulation 2026/1848, изменение Article 5n(2a)',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?qid=1786137726648&uri=OJ%3AL_202601848', checkedAt: '2026-11-14'}],
} satisfies MarketNotice

function normalized(value: string) {
    return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const names = new Map<string, tMarketCountry>()
const english = new Intl.DisplayNames('en', {type: 'region'})
for (const [rawCode, market] of Object.entries(marketCountries)) {
    const code = rawCode as tMarketCountry
    for (const name of [code, market.name, english.of(code) ?? '']) names.set(normalized(name), code)
    for (const city of marketCities[code]) {
        names.set(normalized(city.name), code)
        names.set(normalized(city.query), code)
    }
}
names.set('russian federation', 'RU')
names.set('saint petersburg', 'RU')
names.set('st petersburg', 'RU')
names.set('kiev', 'UA')
names.set('south korea', 'KR')
names.set('viet nam', 'VN')
names.set('uk', 'GB')

export function marketCountry(value: string | undefined) {
    return value ? names.get(normalized(value)) : undefined
}

export function queryMarkets(query: ProviderQuery) {
    const flightBearing = query.kind != 'hotels'
    const origin = flightBearing ? airportByCode(query.origin ?? '')?.countryCode : undefined
    const arrival = flightBearing ? airportByCode(query.destination ?? '')?.countryCode : undefined
    return {origin, destination: arrival ?? marketCountry(query.destination) ?? marketCountry(query.country)}
}

export function travelRestriction(query: ProviderQuery): MarketNotice | null {
    const countries = queryMarkets(query)
    const flightBearing = query.kind != 'hotels'
    const endpoints = [query.origin, query.destination].map(code => airportByCode(code ?? '')?.countryCode)
    if (flightBearing && endpoints.includes('UA')) return ukraineAirspaceNotice
    if (countries.destination == 'RU') return russiaTourismNotice
    return null
}
