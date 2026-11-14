import type {TravelChatQuery, TravelChatResult} from '../../src/assistant-contract.ts'
import type {FlightQuery, FlightSearch} from '../../src/flight-contract.ts'
import {Icon} from '../Icons.tsx'
import {SourceLine, sourceStatus} from '../DirectoryOffers.tsx'
import {hotelCount} from '../presentation.ts'
import {validDate} from '../directory-preferences.ts'
import {safeHref} from '../DirectoryCard.tsx'
import {providerQueryLink} from '../provider-client.ts'
import type {ProviderSearch} from '../../src/provider-contract.ts'
import {priceBasisNames, priceTypeNames, providerMoney, providerTime} from '../ProviderResults.tsx'

export type AssistantSearch =
    | {kind: 'packages' | 'catalog', query: Partial<TravelChatQuery>, hotelId?: string, hotelName?: string, fareId?: string}
    | {kind: 'flights', query: FlightQuery}

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const departure = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
export const dateText = (day: string) => validDate(day) ? departure.format(new Date(day + 'T00:00:00Z')) : '—'
export const costText = (cents: number) => euros.format(cents / 100)

function FlightSummary({search}: {search?: FlightSearch}) {
    if (!search) return null
    const quotes = (search.routeQuotes ?? (search.routeQuote ? [search.routeQuote] : [])).slice(0, 3)
    return <>
        {!!quotes.length && <ul className="assistant-option-list">{quotes.map((quote, index) => <li key={quote.id ?? index}>
            <a href={safeHref(quote.sourceUrl)} target="_blank" rel="noopener noreferrer">
                <span><strong>{quote.carrier ?? 'Перевозчик не указан'}</strong>
                    <small>{quote.providerName ?? 'Google Flights'} · опубликованный ориентир</small></span>
                <span className="assistant-amount">От {costText(quote.total)}<small>за всю поездку</small></span>
            </a></li>)}</ul>}
        {search.offers.length > 0 && <p>Тарифов поставщика · {search.offers.length}. Срок действия и условия видны в сравнении.</p>}
        {!!quotes.length && <p>Состав багажа и окончательные условия уточняются у продавца.</p>}
        <SourceLine sources={search.sources}/>
    </>
}

function ProviderSummary({search}: {search: ProviderSearch}) {
    return <>
        {!!search.offers.length && <ul className="assistant-option-list">{search.offers.slice(0, 3).map(offer => <li key={offer.providerId + offer.id}>
            <a href={safeHref(offer.bookingUrl || offer.sourceUrl)} target="_blank" rel="noopener noreferrer">
                <span><strong>{offer.title}</strong><small>{offer.providerId} · {priceBasisNames[offer.price.basis]}</small>
                    <small>{priceTypeNames[offer.price.type ?? 'unknown']} · проверено {providerTime(offer.checkedAt)}</small></span>
                <span className="assistant-amount">{offer.accuracy != 'live-offer' && 'От '}
                    {providerMoney(offer.price.amount, offer.price.currency)}</span>
            </a></li>)}</ul>}
        <p>Источников в поиске · {search.results.length}. Условия каждого предложения доступны в полном сравнении.</p>
    </>
}

export function Options({result, query, onApply}: {
    result: TravelChatResult, query: Partial<TravelChatQuery>, onApply: (action: AssistantSearch) => void
}) {
    if (result.kind === 'flights') return <section className="assistant-options">
        <h3>Поиск авиабилетов</h3>
        <div className="assistant-flight"><span>{result.query.origin}</span><Icon name="plane"/><span>{result.query.destination}</span></div>
        <p>{dateText(result.query.departure)}{result.query.returnDate && <> — {dateText(result.query.returnDate)}</>} · взрослых: {result.query.adults}
            {result.query.checkedBag && ' · с багажом'}</p>
        {result.providerSearch ? <ProviderSummary search={result.providerSearch}/> : <FlightSummary search={result.search}/>}
        <a className="assistant-primary" href={providerQueryLink(result.providerSearch?.query ?? {...result.query, kind: 'flights', currency: 'EUR'})}>
            Сравнить все источники <Icon name="arrow" size={16}/></a>
        <button type="button" className="travel-link" onClick={() => onApply({kind: 'flights', query: result.query})}>Календарь соседних дат</button>
    </section>
    return <section className="assistant-options">
        <h3>{result.kind === 'packages' ? 'Пакетные туры' : 'Отели на карте'}</h3>
        {result.kind === 'packages' && <p>{result.source.name} · {sourceStatus[result.source.status]}
            {result.source.updatedAt && <> · <time dateTime={result.source.updatedAt}>
                {new Date(result.source.updatedAt).toLocaleDateString('ru-RU')}</time></>}</p>}
        {result.kind === 'catalog' && <p>Цены и наличие проверяются отдельно для выбранного отеля.</p>}
        {result.items.length > 0 && <>
            <p>{result.items.length < result.total ? 'Первые ' + result.items.length + ' из ' + result.total : hotelCount(result.total)}</p>
            <ul className="assistant-option-list">
                {result.kind === 'packages' ? result.items.map(item => <li key={item.hotelId}>
                    <button type="button" onClick={() => onApply({kind: result.kind, query, hotelId: item.hotelId,
                        fareId: item.best.id, hotelName: item.name})}>
                        <span><strong>{item.name}</strong><small>{item.stars != null && item.stars + ' ★ · '}вылет {dateText(item.best.departure)}</small></span>
                        <span className="assistant-amount">{costText(item.best.total)}<small>за группу</small></span>
                    </button>
                </li>) : result.items.map(item => <li key={item.id}>
                    <button type="button" onClick={() => onApply({kind: result.kind, query, hotelId: item.id, hotelName: item.name})}>
                        <span><strong>{item.name}</strong>{item.locality && <small>{item.locality}</small>}</span><Icon name="map" size={17}/>
                    </button>
                </li>)}
            </ul>
        </>}
        <button className="assistant-primary" type="button" onClick={() => onApply({kind: result.kind, query})}>
            {result.kind === 'packages' ? 'Открыть подбор туров' : 'Открыть карту отелей'} <Icon name="arrow" size={16}/>
        </button>
        {result.kind === 'packages' && <SourceLine sources={[result.source]}/>}
    </section>
}
