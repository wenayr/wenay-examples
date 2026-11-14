import {useEffect, useRef, useState, type FormEvent} from 'react'
import type {FlightBenchmark, FlightDay, FlightOffer, FlightQuery, FlightSearch, FlightSlice} from '../../src/flight-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {SourceLine} from '../DirectoryOffers.tsx'
import {safeHref} from '../DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import {Icon} from '../Icons.tsx'
import {shiftDate} from '../directory-preferences.ts'
import {dateLabel} from '../presentation.ts'
import {travelHash, type TravelRoute} from '../navigation.ts'
import {AirportPicker} from './AirportPicker.tsx'
import {ExactFlightDetails, PublishedPrices, SavedFlightPrices} from './FlightPrices.tsx'
import {flightQueryKey} from './comparison.ts'
import {AirlineSites} from './FlightSources.tsx'
import {providerQueryLink} from '../provider-client.ts'
import {defaultFlight, flightError, flightForRoute, flightLink, flightParams, loadFlight, saveFlight} from './preferences.ts'
import './flights.css'

const eur = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})
const euro = (total: number) => eur.format(total / 100)
const dateAndTime = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'})
const sourceTime = (value: string) => dateAndTime.format(new Date(value))

function Benchmark({value, dates}: {value: FlightBenchmark, dates?: boolean}) {
    const comparison = dates ? 'Другие даты с тем же типом перелёта' : 'Другие тарифы на те же рейсы с сопоставимыми условиями'
    return <p className="flight-benchmark"><b>На {euro(value.saving)} дешевле</b> медианы {euro(value.median)}. {comparison} · {value.count}.</p>
}

function Leg({slice}: {slice: FlightSlice}) {
    const departure = slice.departingAt.slice(0, 10)
    const arrival = slice.arrivingAt.slice(0, 10)
    return <div className="flight-leg">
        <span><b>{slice.origin} → {slice.destination}</b> · {dateLabel(departure)}</span>
        <span>{slice.departingAt.slice(11, 16)} → {slice.arrivingAt.slice(11, 16)}{arrival != departure && ' · ' + dateLabel(arrival)}</span>
        <small>{slice.stops == 0 ? 'Прямой рейс' : 'Пересадок · ' + slice.stops}</small>
    </div>
}

function Offer({offer, people}: {offer: FlightOffer, people: number}) {
    const baggage = offer.checkedBags === null ? 'Данные о багаже не получены' : 'Зарегистрированный багаж на человека · ' + offer.checkedBags
    return <article className="flight-offer">
        <div className="flight-offer-heading">
            <div><small>Перевозчик</small><strong>{offer.carrier}</strong></div>
            <div><strong>{euro(offer.total)}</strong><small>за всех · {people} пасс.</small></div>
        </div>
        {offer.slices.map(slice => <Leg key={slice.departingAt + slice.origin} slice={slice}/>)}
        <p className="flight-note">{baggage} · Тариф до <time dateTime={offer.expiresAt}>{sourceTime(offer.expiresAt)}</time></p>
        {offer.benchmark && <Benchmark value={offer.benchmark}/>}
        <ExactFlightDetails offer={offer}/>
    </article>
}

function flightType(direct: boolean | null) {
    if (direct === null) return 'Тип рейса не указан'
    return direct ? 'Прямой рейс' : 'С пересадкой'
}

function FlexibleDates({days, source, selected, onDate, name}: {
    days: FlightDay[], source?: SupplySource, selected: string, onDate: (date: string) => void, name: string,
}) {
    if (!days.length) return null
    return <section className="flight-calendar" aria-label="Цены на соседние даты">
        <div className="flight-section-heading"><h3>Соседние даты</h3><span>{name} · за одного, в одну сторону</span></div>
        <div className="flight-day-grid">{days.map(day => <div className="flight-day" key={day.departure}>
            <button aria-pressed={day.departure == selected} onClick={() => onDate(day.departure)}
                aria-label={'Искать на ' + dateLabel(day.departure) + ', от ' + euro(day.perPerson)}>
                <span>{dateLabel(day.departure)}</span><strong>{euro(day.perPerson)}</strong><small>{flightType(day.direct)}</small>
            </button>
            <a href={safeHref(day.sourceUrl)} target="_blank" rel="noopener noreferrer">У {name} ↗</a>
            {day.benchmark && <Benchmark value={day.benchmark} dates/>}
        </div>)}</div>
        <p className="flight-note">{source?.updatedAt && <>Проверено {sourceTime(source.updatedAt)}. </>}
            Календарь показывает ориентир на вылет. Выберите день, чтобы запросить стоимость всего маршрута.</p>
    </section>
}

function emptyFares(received: number, source?: SupplySource) {
    if (received) return 'Срок полученных тарифов истёк.'
    if (source?.status == 'live' || source?.status == 'cached') return 'Поставщик не вернул тарифов по этим условиям.'
    if (source?.status == 'requires-access') return 'Тарифы с подтверждением мест сейчас недоступны. Проверьте опубликованные цены или поиск у продавца.'
    return source?.description || 'Подтверждённых цен на весь маршрут пока нет.'
}

function FlightResults({query, onDate, refresh}: {query: FlightQuery, onDate: (date: string) => void, refresh: number}) {
    const search = useDirectoryQuery<FlightSearch>(directoryUrl('flights', flightParams(query)), refresh)
    const [now, setNow] = useState(Date.now)
    const data = search.data
    useEffect(() => {
        if (!data?.offers.length) return
        const next = Math.min(...data.offers.map(item => Date.parse(item.expiresAt)).filter(time => time > now))
        if (!Number.isFinite(next)) return
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, next - Date.now() + 20))
        return () => clearTimeout(timer)
    }, [data, now])
    if (search.error) return <p role="status" className="directory-error">Не удалось получить ответ о рейсах.
        {' '}<button onClick={search.retry}>Повторить поиск</button></p>
    if (!data) return <p role="status" className="flight-loading">Запрашиваем цены на маршрут…</p>
    const offers = data.offers.filter(offer => Date.parse(offer.expiresAt) > Math.max(now, Date.now()))
    const exact = data.sources.find(source => source.id.includes('duffel'))
    const reference = data.sources.find(source => source.id.includes('baltic'))
    const quotes = data.routeQuotes ?? (data.routeQuote ? [data.routeQuote] : [])
    const calendars = data.calendars ?? [{providerId: 'airbaltic', providerName: 'airBaltic', rows: data.calendar, source: reference}]
    return <section className="flight-results" aria-label="Результаты поиска">
        {search.loading && <p className="flight-note" role="status">Обновляем цены, показаны последние данные этого маршрута…</p>}
        <h2>{query.origin} → {query.destination}</h2>
        <p className="flight-query-summary">{dateLabel(query.departure)}{query.returnDate ? ' — ' + dateLabel(query.returnDate) : ' · в одну сторону'}
            {' · взрослых ' + query.adults}{query.checkedBag && ' · с багажом'}</p>
        {quotes.length > 0 && <PublishedPrices key={flightQueryKey(query)} rows={quotes} query={query}/>}
        <section>
            <div className="flight-section-heading"><h3>Тарифы поставщика</h3>
                {exact && <span>{exact.name}{exact.updatedAt && ' · ' + sourceTime(exact.updatedAt)}</span>}
            </div>
            {offers.length ? <div className="flight-offers">{offers.map(offer => <Offer key={offer.id} offer={offer} people={query.adults}/>)}</div>
                : <p className="flight-empty">{emptyFares(data.offers.length, exact)}{' '}
                    <button onClick={search.retry} className="travel-link">Запросить снова</button></p>}
        </section>
        {!query.checkedBag && calendars.map(calendar => <FlexibleDates key={calendar.providerId} name={calendar.providerName}
            days={calendar.rows} source={calendar.source} selected={query.departure} onDate={onDate}/>)}
        {!!data.links.length && <section className="flight-handoff"><h3>Проверить у продавца</h3>
            <p>Откроется поиск на выбранный маршрут. Цена и места подтверждаются у продавца перед оплатой.</p>
            <div>{data.links.map(link => <a href={safeHref(link.url)} key={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</div>
        </section>}
        <AirlineSites items={data.carrierLinks ?? []}/>
        <SourceLine sources={data.sources}/>
    </section>
}

function FlightForm({initial, auto}: {initial: FlightQuery, auto: boolean}) {
    const [draft, setDraft] = useState(initial)
    const [query, setQuery] = useState<FlightQuery | null>(auto && !flightError(initial) ? initial : null)
    const [refresh, setRefresh] = useState(0)
    const [error, setError] = useState('')
    const submitted = useRef(auto && !flightError(initial) ? JSON.stringify(initial) : '')
    const draftKey = JSON.stringify(draft)
    const today = new Date().toISOString().slice(0, 10)
    useEffect(() => { if (query) void saveFlight(query) }, [query])
    function update(fields: Partial<FlightQuery>) {
        setDraft(current => ({...current, ...fields}))
        setError('')
    }
    function submit(next: FlightQuery) {
        const reason = flightError(next)
        setError(reason)
        if (reason) return
        submitted.current = JSON.stringify(next)
        setDraft(next)
        setQuery(next)
        setRefresh(n => n + 1)
        window.history.replaceState(null, '', flightLink(next))
    }
    useEffect(() => {
        if (flightError(draft) || draftKey == submitted.current) return
        const timer = setTimeout(() => {
            if (draftKey != submitted.current) submit(draft)
        }, 500)
        return () => clearTimeout(timer)
    }, [draftKey])
    useEffect(() => {
        if (!query) return
        let checked = Date.now()
        function refreshPrices() {
            if (document.hidden || Date.now() - checked < 60_000) return
            checked = Date.now()
            setRefresh(value => value + 1)
        }
        const timer = setInterval(refreshPrices, 60_000)
        document.addEventListener('visibilitychange', refreshPrices)
        return () => {
            clearInterval(timer)
            document.removeEventListener('visibilitychange', refreshPrices)
        }
    }, [JSON.stringify(query)])
    function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        submit(draft)
    }
    return <><form className="flight-form" onSubmit={search}>
        <div className="discover-segments" role="group" aria-label="Тип маршрута">
            <button type="button" aria-pressed={draft.returnDate === null} onClick={() => update({returnDate: null})}>В одну сторону</button>
            <button type="button" aria-pressed={draft.returnDate !== null}
                onClick={() => update({returnDate: draft.returnDate ?? shiftDate(draft.departure || today, 7)})}>Туда и обратно</button>
        </div>
        <div className="flight-airports">
            <AirportPicker label="Аэропорт вылета" value={draft.origin} onChange={origin => update({origin})}/>
            <button type="button" className="flight-swap" aria-label="Поменять аэропорты местами" title="Поменять аэропорты местами"
                disabled={!draft.origin || !draft.destination} onClick={() => update({origin: draft.destination, destination: draft.origin})}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M3 8h17l-4-4M21 16H4l4 4" strokeLinejoin="round" strokeLinecap="round"/>
                </svg>
            </button>
            <AirportPicker label="Аэропорт прилёта" value={draft.destination} onChange={destination => update({destination})}/>
        </div>
        <div className="flight-fields">
            <label>Вылет<input type="date" required min={today} value={draft.departure} onChange={event => {
                const date = event.target.value
                update({departure: date, returnDate: draft.returnDate && draft.returnDate < date ? date : draft.returnDate})
            }}/></label>
            {draft.returnDate !== null && <label>Обратно<input type="date" required min={draft.departure || today}
                value={draft.returnDate} onChange={event => update({returnDate: event.target.value})}/></label>}
            <label>Взрослых<select value={draft.adults} onChange={event => update({adults: Number(event.target.value)})}>
                {Array.from({length: 9}, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
        </div>
        <div className="flight-form-actions"><label><input type="checkbox" checked={draft.checkedBag}
            onChange={event => update({checkedBag: event.target.checked})}/> С зарегистрированным багажом на каждого</label>
            <button type="submit" className="search-flight">Найти авиабилеты <Icon name="arrow" size={16}/></button></div>
        {error && <p role="alert">{error}</p>}
    </form>
    {query && <><div className="browse-quick">
        <a href={travelHash('assistant', undefined, {...flightParams(query), kind: 'flights'})}>Уточнить маршрут в помощнике</a>
        <a href={providerQueryLink({...query, kind: 'flights', currency: 'EUR'})}>Сравнить все источники</a></div>
        <FlightResults query={query} refresh={refresh} onDate={departure => submit({...query, departure})}/></>}
    </>
}

function useSavedFlight(fallback?: () => FlightQuery) {
    const [saved, setSaved] = useState<FlightQuery | null>(null)
    useEffect(() => {
        let active = true
        void loadFlight().then(value => {
            if (active) setSaved(value ?? fallback?.() ?? null)
        })
        return () => { active = false }
    }, [fallback])
    return saved
}

export function FlightResume() {
    const saved = useSavedFlight()
    return <>{saved && <section className="flight-resume"><Icon name="plane"/><div><strong>Последний поиск авиабилетов</strong>
        <p>{saved.origin} → {saved.destination} · {dateLabel(saved.departure)}{saved.returnDate && ' — ' + dateLabel(saved.returnDate)}
            {' · взрослых '}{saved.adults}</p></div>
        <a href={flightLink(saved)}>Проверить цены →</a></section>}<SavedFlightPrices/></>
}

export function Flights({route}: {route: TravelRoute}) {
    const base = useSavedFlight(defaultFlight)
    return <main className="travel-home flight-home"><header><p><Icon name="plane" size={16}/> Самостоятельная поездка</p>
        <h1>Авиабилеты</h1><span>Сравните авиакомпании, цены и условия на свой маршрут.</span></header>
        {base && <FlightForm initial={flightForRoute(base, route.query)} auto/>}
    </main>
}
