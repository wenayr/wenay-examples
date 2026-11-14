import {useEffect, useState} from 'react'
import type {CountryMarket, MarketCatalog, MarketPartner, MarketProvider} from '../src/market-contract.ts'
import {marketCountries} from '../src/market-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {marketContext, marketSearchLink} from './market-links.ts'
import {createMarketPreferences, marketCountry} from './market-preferences.ts'
import {MarketEvidenceLinks as Evidence, MarketNotices} from './MarketNotices.tsx'
import {providerKindNames, providerQueryFromParams, providerStatusNames} from './provider-client.ts'
import {replaceTravelHash, travelHash, type TravelRoute} from './navigation.ts'
import './markets.css'

const preferences = createMarketPreferences()
const englishNames = new Intl.DisplayNames(['en'], {type: 'region'})
const partnerKinds = {airline: 'Авиакомпания', 'tour-operator': 'Туроператор', agency: 'Агентство', dmc: 'Принимающая компания', wholesaler: 'Оптовик'} as const
const connections = {
    'price-adapter': 'Адаптер в системе', 'partner-api': 'API по договору', 'partner-onboarding': 'Заявка на сотрудничество',
    'official-site': 'Официальный сайт', paused: 'Подключение приостановлено',
} as const satisfies Record<MarketPartner['connection'], string>
const coverageNames = {
    'query-verified': 'Подтверждено запросом', documented: 'Заявлено в документации',
    'request-check': 'Проверяется на конкретном запросе', unavailable: 'Доступность не подтверждена',
} as const satisfies Record<MarketProvider['coverage'], string>
const products = ['all', 'flights', 'hotels', 'packages', 'deals'] as const
type tProduct = typeof products[number]

function productForRoute(route: TravelRoute) {
    const kind = route.query.get('product')
    return products.includes(kind as tProduct) ? kind as tProduct : 'all'
}

function MarketPartnerCard({partner}: {partner: MarketPartner}) {
    const partnership = partner.partnershipUrl != partner.website
    return <article className="market-partner"><div className="market-partner-heading"><div>
        <p>{partnerKinds[partner.kind]}{partner.iata && ' · ' + partner.iata}</p><h3>{partner.name}</h3></div>
        <span>{connections[partner.connection]}</span></div>
        <p>{partner.description}</p>
        <p className="market-partner-scope">{partner.relationship == 'based' ? 'Компания этого рынка' : 'Компания, обслуживающая рынок'}</p>
        <div className="market-actions"><a href={safeHref(partner.website)} target="_blank" rel="noopener noreferrer">Официальный сайт ↗</a>
            {partnership && <a href={safeHref(partner.partnershipUrl)} target="_blank" rel="noopener noreferrer">Сотрудничество ↗</a>}
            {partner.providerIds?.map(id => <a key={id} href={travelHash('providers', undefined, {search: id})}>Источник {id} →</a>)}</div>
        <details><summary>Подтверждение и условия канала</summary><Evidence items={partner.evidence}/></details>
    </article>
}

function MarketProviders({market, product}: {market: CountryMarket, product: tProduct}) {
    const providers = market.providers.filter(item => product == 'all' || item.kinds.includes(product))
    return <section className="market-providers" aria-labelledby="market-providers-heading">
        <div className="market-section-heading"><h2 id="market-providers-heading">Источники цен</h2><a href="#providers">Настройка подключений →</a></div>
        <p>Покрытие рынка и доступ к API проверяются отдельно. Наличие предложения определяется параметрами поездки.</p>
        {!providers.length && <p role="status">В этом разделе пока нет подходящего источника. Можно согласовать прямое подключение с поставщиком.</p>}
        <div className="market-provider-list">{providers.map(provider => <details key={provider.providerId}>
            <summary><strong>{provider.name}</strong><span>{provider.configured && provider.enabled
                ? providerStatusNames[provider.status] : 'Требуется подключение'}</span></summary>
            <p>{provider.kinds.map(kind => providerKindNames[kind]).join(' · ')} · {coverageNames[provider.coverage]}</p>
            <p>{provider.coverageDescription}</p><p>{provider.activation}</p>
            {provider.onboarding == 'paused' && <p className="market-notice-label">Приём новых заявок приостановлен.</p>}
            <div className="market-actions"><a href={travelHash('providers', undefined, {search: provider.providerId})}>Проверить параметры →</a>
                <a href={safeHref(provider.docsUrl)} target="_blank" rel="noopener noreferrer">Документация ↗</a></div>
            <Evidence items={provider.evidence}/>
        </details>)}</div>
    </section>
}

function MarketSearch({market, params}: {market: CountryMarket, params: URLSearchParams}) {
    return <section className="market-search" aria-labelledby="market-search-heading"><h2 id="market-search-heading">Спланировать поездку</h2>
        {market.aviationStatus == 'closed' ? <p className="market-notice-label">Вылеты и прилёты через гражданские аэропорты страны сейчас закрыты.
            Выберите действующий аэропорт другой страны в общем поиске.</p> : <div>
            <h3>Аэропорты</h3><p>Выберите нужную сторону маршрута. Остальные параметры поездки сохранятся.</p>
            <div className="market-hubs">{market.hubs.map(hub => <div key={hub.iata}><strong>{hub.city} <span>{hub.iata}</span></strong>
                {market.commercialStatus == 'review-required' ? <span className="market-commercial-check">Прилёт · проверка условий продажи</span>
                    : <a href={marketSearchLink(market.code, 'flights', params, {destination: hub.iata})}>Прилететь сюда →</a>}
                <a href={marketSearchLink(market.code, 'flights', params, {origin: hub.iata})}>Вылететь отсюда →</a></div>)}</div>
        </div>}
        {market.commercialStatus == 'review-required' ? <p className="market-notice-label">
            Поиск местных туристических услуг требует проверки ограничений для эстонского агентства. Подробности указаны выше.</p> : <>
        <div><h3>Отели</h3><div className="market-actions market-city-links">{market.cities.map(city =>
            <a key={city.name} href={marketSearchLink(market.code, 'hotels', params, {
                destination: city.query, latitude: city.latitude, longitude: city.longitude,
            })}>{city.name} →</a>)}</div></div>
        <div className="market-actions market-search-links"><a href={marketSearchLink(market.code, 'deals', params)}>Горящие предложения в стране →</a></div>
        </>}
        <div className="market-actions market-search-links"><a href={travelHash('flights', undefined, marketContext(params))}>
            Выбрать другой аэропорт →</a></div>
    </section>
}

function TripContext({fields, onChange}: {fields: Record<string, string>, onChange: (fields: Record<string, string>) => void}) {
    const defaults = providerQueryFromParams(new URLSearchParams(fields), 'flights')
    function update(key: string, value: string) {
        const next = {...fields, [key]: value}
        if (key == 'departure') next.checkIn = value
        if (key == 'returnDate') next.checkOut = value
        if (key == 'adults') delete next.adultAges
        onChange(next)
    }
    return <details className="market-trip-context"><summary>Параметры поездки · {defaults.adults} взрослых · {defaults.currency}</summary>
        <div className="market-context-fields"><label>Вылет или заезд<input type="date" value={fields.departure ?? fields.checkIn ?? defaults.departure ?? ''}
            onChange={event => update('departure', event.target.value)}/></label>
            <label>Возвращение или выезд<input type="date" value={fields.returnDate ?? fields.checkOut ?? ''}
                onChange={event => update('returnDate', event.target.value)}/></label>
            <label>Взрослых<input type="number" min="1" max="9" value={fields.adults ?? defaults.adults}
                onChange={event => update('adults', event.target.value)}/></label>
            <label>Страна бронирующего<input list="market-country-codes" maxLength={2} value={fields.bookerCountry ?? ''}
                placeholder="ISO2, например EE"
                onChange={event => update('bookerCountry', event.target.value.toUpperCase())}/></label>
            <label>Гражданство путешественника<input list="market-country-codes" maxLength={2} value={fields.nationality ?? ''} placeholder="ISO2, например UA"
                onChange={event => update('nationality', event.target.value.toUpperCase())}/></label>
        </div><datalist id="market-country-codes">{Object.entries(marketCountries).map(([code, item]) =>
            <option key={code} value={code}>{item.name}</option>)}</datalist>
        <p>Валюта поиска {defaults.currency}. Страна назначения, страна бронирующего и гражданство задаются отдельно.</p>
    </details>
}

function CountryDetail({market, product, params}: {market: CountryMarket, product: tProduct, params: URLSearchParams}) {
    const [phrase, setPhrase] = useState('')
    const term = phrase.trim().toLocaleLowerCase('ru')
    const partners = [...market.airlines, ...market.tourism].filter(item => {
        if (product == 'flights' && item.kind != 'airline') return false
        if (product != 'all' && product != 'flights' && item.kind == 'airline') return false
        return [item.name, item.iata, item.description, partnerKinds[item.kind]].join(' ').toLocaleLowerCase('ru').includes(term)
    })
    return <article className="market-country"><header className="market-country-heading">
        <p>{market.region} · {market.code} · Местная валюта {market.currency}</p>
        <h1>{market.name}</h1><p>{market.summary}</p></header>
        <MarketNotices items={market.notices}/>
        <MarketSearch market={market} params={params}/>
        <section className="market-companies" aria-labelledby="market-companies-heading"><div className="market-section-heading">
            <h2 id="market-companies-heading">Авиакомпании и туристические партнёры</h2>
            <label>Найти компанию<input type="search" value={phrase} placeholder="Название, тип или IATA"
                onChange={event => setPhrase(event.target.value)}/></label></div>
            {!partners.length && <p role="status">Компаний с такими параметрами не найдено.</p>}
            <div className="market-partner-grid">{partners.map(partner => <MarketPartnerCard key={partner.id} partner={partner}/>)}</div>
        </section><MarketProviders market={market} product={product}/>
        <div className="market-actions market-guide-links"><a href={travelHash('guides', undefined, {guide: 'markets'})}>
            Как подключать поставщиков в этих странах →</a>
            <a href={travelHash('guides', undefined, {guide: 'b2b'})}>Анкета агентства и вопросы к договору →</a></div>
    </article>
}

function searchableMarket(item: CountryMarket, term: string) {
    const names = [...item.airlines, ...item.tourism].map(partner => partner.name).join(' ')
    const aliases = item.code == 'GB' ? 'UK Англия England Great Britain' : ''
    return [item.name, item.code, englishNames.of(item.code), item.region, names, aliases].join(' ').toLocaleLowerCase('ru').includes(term)
}

export function Markets({route}: {route: TravelRoute}) {
    const catalog = useDirectoryQuery<MarketCatalog>(directoryUrl('markets'))
    const [country, setCountry] = useState(() => marketCountry(route.destination))
    const [phrase, setPhrase] = useState(route.query.get('search') ?? '')
    const [product, setProduct] = useState<tProduct>(() => productForRoute(route))
    const [context, setContext] = useState(() => marketContext(route.query))
    useEffect(() => {
        let active = true
        if (country) void preferences.save(country)
        else void preferences.load().then(saved => { if (active && saved) setCountry(saved) })
        return () => { active = false }
    }, [country])
    function fields(nextContext = context, nextPhrase = phrase, nextProduct = product) {
        return {...nextContext, search: nextPhrase || undefined, product: nextProduct == 'all' ? undefined : nextProduct}
    }
    function updateContext(next: Record<string, string>) {
        setContext(next)
        replaceTravelHash(travelHash('markets', country ?? undefined, fields(next)))
    }
    function filter(nextPhrase: string, nextProduct: tProduct) {
        setPhrase(nextPhrase)
        setProduct(nextProduct)
        replaceTravelHash(travelHash('markets', country ?? undefined, fields(context, nextPhrase, nextProduct)))
    }
    const items = catalog.data?.items ?? []
    const selected = items.find(item => item.code == country)
    const visible = items.filter(item => searchableMarket(item, phrase.trim().toLocaleLowerCase('ru')))
    return <main className="travel-home markets-home"><header className="agency-heading"><p>Маршруты и деловые подключения</p>
        <h1>20 стран Евразии</h1><span>{catalog.data?.selection ?? 'Выберите страну, авиакомпании, туристических партнёров и доступные каналы поиска.'}</span>
        <div><a href={travelHash('guides', undefined, {guide: 'markets'})}>Руководство по рынкам →</a><a href="#providers">Состояние интеграций →</a></div>
    </header>
        {catalog.error && <p role="status">{catalog.error} <button type="button" onClick={catalog.retry}>Повторить</button></p>}
        {!catalog.data && !catalog.error && <p role="status">Загружаем страны и источники…</p>}
        {catalog.data && <>
            <div className="market-overview"><p><strong>{catalog.data.summary.countries}</strong> стран</p>
                <p><strong>{catalog.data.summary.airlines}</strong> авиакомпаний</p>
                <p><strong>{catalog.data.summary.tourismPartners}</strong> туристических партнёров</p>
                <p><strong>{catalog.data.summary.priceProviders}</strong> независимых источников цен</p></div>
            <TripContext fields={context} onChange={updateContext}/>
            <div className="market-product-filter" role="group" aria-label="Тип продукта">{products.map(kind =>
                <button key={kind} type="button" aria-pressed={kind == product} onClick={() => filter(phrase, kind)}>
                    {kind == 'all' ? 'Все продукты' : providerKindNames[kind]}</button>)}</div>
            <div className="market-layout"><aside className="market-sidebar"><label>Страна или компания<input type="search" value={phrase}
                placeholder="Япония, UK, Uzbekistan, Ryanair" onChange={event => filter(event.target.value, product)}/></label>
                <p className="market-country-count" role="status">Стран в подборке {visible.length} из {items.length}</p>
                <nav aria-label="Страны Евразии">{visible.map(item => <a key={item.code}
                    href={travelHash('markets', item.code, fields())} aria-current={item.code == country ? 'page' : undefined}>
                    <strong>{item.name}</strong><small>{item.airlines.length} авиакомпаний · {item.tourism.length} туристических партнёров</small></a>)}</nav>
            </aside><div className="market-detail">{selected ? <CountryDetail key={selected.code} market={selected} product={product}
                params={new URLSearchParams(context)}/> : <section className="market-choose"><h2>Выберите страну</h2>
                    <p>В карточке страны собраны перевозчики, туристические поставщики, каналы подключения и условия доступа.</p>
                    <p>Готовые параметры поездки сохранятся при переходе к поиску.</p></section>}</div></div>
        </>}
    </main>
}
