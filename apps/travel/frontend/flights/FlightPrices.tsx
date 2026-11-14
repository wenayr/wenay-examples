import {useEffect, useState} from 'react'
import type {FlightOffer, FlightQuery, RouteQuote} from '../../src/flight-contract.ts'
import {safeHref} from '../DirectoryCard.tsx'
import {dateLabel} from '../presentation.ts'
import {flightLink} from './preferences.ts'
import {
    defaultComparison, flightQueryKey, flightSorts, loadComparison, maxFlightSelections,
    quoteKey, readFlightSelections, saveComparison, toggleFlightSelection,
    type FlightComparisonPreferences, type SavedFlightSelection,
} from './comparison.ts'

const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const time = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'})
export const flightMoney = (total: number) => money.format(total / 100)
export const checkedTime = (value: string) => time.format(new Date(value))
const providerName = (quote: RouteQuote) => quote.providerName ?? 'Google Flights'
const providerKey = (quote: RouteQuote) => quote.providerId ?? 'google-flights'
const carrierName = (quote: RouteQuote) => quote.carrier ?? 'Перевозчик не указан'

function stopsText(stops: number | null | undefined) {
    if (stops == null) return 'Пересадки не указаны'
    if (stops == 0) return 'Прямой рейс'
    return 'Пересадок · ' + stops
}

function baggageText(count: number | null | undefined) {
    if (count == null) return 'Багаж уточняется у продавца'
    if (count == 0) return 'Без зарегистрированного багажа'
    return 'Багаж на человека · ' + count
}

function durationText(quote: RouteQuote) {
    const minutes = quote.details?.durationMinutes
    if (minutes == null) return quote.details?.duration || 'Не указано'
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    if (!hours) return remainder + ' мин'
    return hours + ' ч' + (remainder ? ' ' + remainder + ' мин' : '')
}

function departureOrder(quote: RouteQuote) {
    const clock = quote.details?.outbound?.match(/\b(\d{1,2}):(\d{2})\b/)
    return clock ? Number(clock[1]) * 60 + Number(clock[2]) : Infinity
}

function orderedQuotes(rows: RouteQuote[], prefs: FlightComparisonPreferences) {
    function matches(quote: RouteQuote) {
        if (prefs.provider != 'all' && providerKey(quote) != prefs.provider) return false
        if (prefs.carrier != 'all' && carrierName(quote) != prefs.carrier) return false
        if (prefs.maxStops === null) return true
        const stops = quote.details?.stops
        return stops != null && stops <= prefs.maxStops
    }
    function order(a: RouteQuote, b: RouteQuote) {
        let difference = 0
        if (prefs.sort == 'departure') difference = departureOrder(a) - departureOrder(b)
        if (prefs.sort == 'duration') difference = (a.details?.durationMinutes ?? Infinity) - (b.details?.durationMinutes ?? Infinity)
        return (Number.isNaN(difference) ? 0 : difference) || a.total - b.total || quoteKey(a).localeCompare(quoteKey(b))
    }
    return rows.filter(matches).sort(order)
}

function FilterPrices({rows, prefs, onChange}: {
    rows: RouteQuote[], prefs: FlightComparisonPreferences, onChange: (next: FlightComparisonPreferences) => void,
}) {
    const providers = new Map(rows.map(quote => [providerKey(quote), providerName(quote)]))
    const carriers = [...new Set(rows.map(carrierName))].sort()
    function change(fields: Partial<FlightComparisonPreferences>) {
        onChange({...prefs, ...fields})
    }
    return <div className="flight-price-filters">
        <label>Порядок<select value={prefs.sort} onChange={event => change({sort: event.target.value as FlightComparisonPreferences['sort']})}>
            {Object.entries(flightSorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Источник<select value={prefs.provider} onChange={event => change({provider: event.target.value})}>
            <option value="all">Все источники</option>
            {prefs.provider != 'all' && !providers.has(prefs.provider) && <option value={prefs.provider}>Сохранённый источник</option>}
            {[...providers].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Авиакомпания<select value={prefs.carrier} onChange={event => change({carrier: event.target.value})}>
            <option value="all">Все авиакомпании</option>
            {prefs.carrier != 'all' && !carriers.includes(prefs.carrier) && <option>{prefs.carrier}</option>}
            {carriers.map(name => <option key={name}>{name}</option>)}</select></label>
        <label>Пересадки на вылете<select value={prefs.maxStops ?? 'all'}
            onChange={event => change({maxStops: event.target.value == 'all' ? null : Number(event.target.value) as 0 | 1})}>
            <option value="all">Любые и неизвестные</option><option value="0">Прямой рейс</option><option value="1">Не более одной</option>
        </select></label>
        <button type="button" onClick={() => onChange(defaultComparison())}>Сбросить фильтры</button>
    </div>
}

function QuoteCard({quote, people, selected, limit, onSelect}: {
    quote: RouteQuote, people: number, selected: boolean, limit: boolean, onSelect: () => void,
}) {
    return <article className="flight-price-card">
        <div className="flight-offer-heading"><div><small>{providerName(quote)}</small><h4>{carrierName(quote)}</h4></div>
            <div><strong>От {flightMoney(quote.total)}</strong><small>за всю поездку · {people} пасс.</small></div></div>
        <dl className="flight-price-details">
            <div><dt>Вылет</dt><dd>{quote.details?.outbound || 'Время не указано'}</dd></div>
            <div><dt>В пути на вылете</dt><dd>{durationText(quote)}</dd></div>
            <div><dt>Маршрут вылета</dt><dd>{stopsText(quote.details?.stops)}</dd></div>
            <div><dt>Зарегистрированный багаж</dt><dd>{baggageText(quote.details?.checkedBags)}</dd></div>
        </dl>
        {quote.details?.cabinBag == 'excluded' && <p className="flight-note">Ручная кладь на верхней полке не включена.</p>}
        <details className="flight-price-conditions"><summary>Условия опубликованной цены</summary><p>{quote.description}</p>
            <p>Состав сборов, багаж и условия возврата подтверждает продавец при выборе тарифа.</p></details>
        <p className="flight-price-checked"><time dateTime={quote.checkedAt}>Проверено {checkedTime(quote.checkedAt)}</time></p>
        <div className="flight-price-actions"><label><input type="checkbox" checked={selected} disabled={!selected && limit}
            onChange={onSelect}/> Сохранить и сравнить</label>
            <a href={safeHref(quote.sourceUrl)} target="_blank" rel="noopener noreferrer">Открыть у {providerName(quote)} ↗</a></div>
    </article>
}

function ComparePrices({selected, onRemove}: {selected: SavedFlightSelection[], onRemove: (item: SavedFlightSelection) => void}) {
    if (!selected.length) return null
    return <section className="flight-selected" aria-label="Выбранные перелёты для сравнения">
        <h3>Выбранные варианты · {selected.length} из {maxFlightSelections}</h3>
        <p className="flight-note">Сохранённые цены на одни даты и пассажиров. Багаж и полный состав тарифа уточняются у продавца.</p>
        <div className="flight-compare-scroll"><table className="flight-compare-table"><thead><tr><th scope="col">Условие</th>
            {selected.map(item => <th scope="col" key={quoteKey(item.quote)}>{carrierName(item.quote)}</th>)}</tr></thead>
            <tbody><tr><th scope="row">За всю поездку</th>{selected.map(item => <td key={quoteKey(item.quote)}>
                <strong>От {flightMoney(item.quote.total)}</strong></td>)}</tr>
            <tr><th scope="row">Источник</th>{selected.map(item => <td key={quoteKey(item.quote)}>{providerName(item.quote)}</td>)}</tr>
            <tr><th scope="row">Вылет</th>{selected.map(item => <td key={quoteKey(item.quote)}>{item.quote.details?.outbound || 'Не указан'}</td>)}</tr>
            <tr><th scope="row">В пути на вылете</th>{selected.map(item => <td key={quoteKey(item.quote)}>{durationText(item.quote)}</td>)}</tr>
            <tr><th scope="row">Пересадки на вылете</th>{selected.map(item => <td key={quoteKey(item.quote)}>
                {stopsText(item.quote.details?.stops)}</td>)}</tr>
            <tr><th scope="row">Багаж</th>{selected.map(item => <td key={quoteKey(item.quote)}>{baggageText(item.quote.details?.checkedBags)}</td>)}</tr>
            <tr><th scope="row">Проверено</th>{selected.map(item => <td key={quoteKey(item.quote)}>{checkedTime(item.quote.checkedAt)}</td>)}</tr>
            <tr><th scope="row">Действия</th>{selected.map(item => <td key={quoteKey(item.quote)}>
                <a href={safeHref(item.quote.sourceUrl)} target="_blank" rel="noopener noreferrer">У поставщика ↗</a>
                <button type="button" onClick={() => onRemove(item)} aria-label={'Убрать из сравнения ' + carrierName(item.quote)}>Убрать</button>
            </td>)}</tr></tbody></table></div>
    </section>
}

export function PublishedPrices({rows, query}: {rows: RouteQuote[], query: FlightQuery}) {
    const [prefs, setPrefs] = useState(defaultComparison)
    const [selected, setSelected] = useState<SavedFlightSelection[]>([])
    const [ready, setReady] = useState(false)
    const key = flightQueryKey(query)
    useEffect(() => {
        let active = true
        async function load() {
            const [savedPrefs, selections] = await Promise.all([loadComparison(query), readFlightSelections()])
            if (!active) return
            setPrefs(savedPrefs)
            setSelected(selections.filter(item => flightQueryKey(item.query) == key))
            setReady(true)
        }
        void load()
        return () => { active = false }
    }, [key])
    function update(next: FlightComparisonPreferences) {
        setPrefs(next)
        void saveComparison(query, next)
    }
    async function select(quote: RouteQuote) {
        const all = await toggleFlightSelection(query, quote)
        setSelected(all.filter(item => flightQueryKey(item.query) == key))
    }
    const visible = orderedQuotes(rows, prefs)
    const unknownStops = rows.filter(quote => quote.details?.stops == null).length
    return <section className="flight-published" aria-label="Сравнение опубликованных цен">
        <div className="flight-section-heading"><h3>Сравнить авиакомпании</h3><span>Опубликованные ориентиры в EUR · за всех пассажиров</span></div>
        <p className="flight-note">Цены на ваш маршрут и даты. Время в пути и пересадки относятся к вылету.
            {query.returnDate && ' Состав обратного рейса уточняется при переходе к поставщику.'}</p>
        <FilterPrices rows={rows} prefs={prefs} onChange={update}/>
        <div className="flight-price-count" role="status"><span>Показано {visible.length} из {rows.length}</span>
            {prefs.maxStops !== null && unknownStops > 0 && <span>Без сведений о пересадках · {unknownStops}. Смените фильтр, чтобы увидеть их.</span>}
            {selected.length >= maxFlightSelections && <span>Для нового варианта уберите один из {maxFlightSelections} выбранных.</span>}</div>
        {!visible.length && <p className="flight-empty">По выбранным фильтрам вариантов нет.
            {' '}<button onClick={() => update(defaultComparison())}>Сбросить фильтры</button></p>}
        <div className="flight-published-grid">{visible.map(quote => <QuoteCard key={quoteKey(quote)} quote={quote} people={query.adults}
            selected={selected.some(item => quoteKey(item.quote) == quoteKey(quote))} limit={!ready || selected.length >= maxFlightSelections}
            onSelect={() => { void select(quote) }}/>)}</div>
        <ComparePrices selected={selected} onRemove={item => { void select(item.quote) }}/>
    </section>
}

export function SavedFlightPrices() {
    const [saved, setSaved] = useState<SavedFlightSelection[]>([])
    useEffect(() => {
        let active = true
        async function load() {
            const items = await readFlightSelections()
            if (active) setSaved(items)
        }
        void load()
        window.addEventListener('storage', load)
        return () => {
            active = false
            window.removeEventListener('storage', load)
        }
    }, [])
    async function remove(item: SavedFlightSelection) {
        setSaved(await toggleFlightSelection(item.query, item.quote))
    }
    if (!saved.length) return null
    return <section className="flight-saved-prices"><h2>Сохранённые перелёты</h2>
        <p className="flight-note">Ориентиры на момент проверки. Откройте маршрут, чтобы заново сравнить цены.</p>
        <div className="flight-published-grid">{saved.map(item => <article className="flight-price-card"
            key={flightQueryKey(item.query) + quoteKey(item.quote)}>
            <div className="flight-offer-heading"><h3>{item.query.origin} → {item.query.destination}</h3>
                <strong>От {flightMoney(item.quote.total)}</strong></div>
            <p>{dateLabel(item.query.departure)}{item.query.returnDate && ' — ' + dateLabel(item.query.returnDate)}
                {' · ' + item.query.adults + ' пасс. · ' + carrierName(item.quote)}</p>
            <p className="flight-note">{providerName(item.quote)} · проверено {checkedTime(item.quote.checkedAt)}</p>
            <div className="flight-price-actions"><a href={flightLink(item.query)}>Обновить сравнение →</a>
                <button type="button" onClick={() => { void remove(item) }}>Убрать</button></div>
        </article>)}</div>
    </section>
}

export function ExactFlightDetails({offer}: {offer: FlightOffer}) {
    return <>
        <p className="flight-note">{offer.providerName ?? 'Duffel'}
            {offer.checkedAt && ' · проверено ' + checkedTime(offer.checkedAt)}
            {offer.taxesIncluded === true && ' · налоги включены'}
            {offer.taxesIncluded == null && ' · состав налогов уточняется'}
            {offer.taxesIncluded === false && ' · налоги оплачиваются отдельно'}</p>
        {!!offer.operatingCarriers?.length && <p className="flight-note">Рейсы выполняют {offer.operatingCarriers.join(', ')}.</p>}
        {offer.conditions && <p className="flight-note">{offer.conditions}</p>}
        {offer.sourceUrl && <a className="flight-offer-link" href={safeHref(offer.sourceUrl)} target="_blank" rel="noopener noreferrer">
            Перейти к поставщику ↗</a>}
    </>
}
