import type {TravelChatQuery, TravelChatResult} from '../../src/assistant-contract.ts'
import type {FlightQuery} from '../../src/flight-contract.ts'
import {Icon} from '../Icons.tsx'
import {SourceLine, sourceStatus} from '../DirectoryOffers.tsx'
import {hotelCount} from '../presentation.ts'
import {validDate} from '../directory-preferences.ts'

export type AssistantSearch =
    | {kind: 'packages' | 'catalog', query: Partial<TravelChatQuery>, hotelId?: string, hotelName?: string, fareId?: string}
    | {kind: 'flights', query: FlightQuery}

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const departure = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
export const dateText = (day: string) => validDate(day) ? departure.format(new Date(day + 'T00:00:00Z')) : '—'
export const costText = (cents: number) => euros.format(cents / 100)

export function Options({result, query, onApply}: {
    result: TravelChatResult, query: Partial<TravelChatQuery>, onApply: (action: AssistantSearch) => void
}) {
    if (result.kind === 'flights') return <section className="assistant-options">
        <h3>Поиск авиабилетов</h3>
        <div className="assistant-flight"><span>{result.query.origin}</span><Icon name="plane"/><span>{result.query.destination}</span></div>
        <p>{dateText(result.query.departure)}{result.query.returnDate && <> — {dateText(result.query.returnDate)}</>} · взрослых: {result.query.adults}
            {result.query.checkedBag && ' · с багажом'}</p>
        <button className="assistant-primary" type="button" onClick={() => onApply({kind: 'flights', query: result.query})}>
            Проверить рейсы и цены <Icon name="arrow" size={16}/></button>
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
