import {useEffect, useState, type FormEvent} from 'react'
import type {FlightBenchmark, FlightDay, FlightOffer, FlightQuery, FlightSearch, FlightSlice} from '../../src/flight-contract.ts'
import type {SupplySource} from '../../src/supply-contract.ts'
import {SourceLine, sourceStatus} from '../DirectoryOffers.tsx'
import {safeHref} from '../DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import {Icon} from '../Icons.tsx'
import {shiftDate} from '../directory-preferences.ts'
import {dateLabel} from '../presentation.ts'
import {travelHash, type TravelRoute} from '../navigation.ts'
import {AirportPicker} from './AirportPicker.tsx'
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
    </article>
}

function flightType(direct: boolean | null) {
    if (direct === null) return 'Тип рейса не указан'
    return direct ? 'Прямой рейс' : 'С пересадкой'
}

function FlexibleDates({days, source, selected, onDate}: {
    days: FlightDay[], source?: SupplySource, selected: string, onDate: (date: string) => void
}) {
    if (!days.length) {
        return source && <p className="flight-note">{source.name} · {sourceStatus[source.status]}. {source.description}</p>
    }
    return <section className="flight-calendar" aria-label="Цены на соседние даты">
        <div className="flight-section-heading"><h3>Соседние даты</h3><span>airBaltic · за одного, в одну сторону</span></div>
        <div className="flight-day-grid">{days.map(day => <div className="flight-day" key={day.departure}>
            <button aria-pressed={day.departure == selected} onClick={() => onDate(day.departure)}
                aria-label={'Искать на ' + dateLabel(day.departure) + ', от ' + euro(day.perPerson)}>
                <span>{dateLabel(day.departure)}</span><strong>{euro(day.perPerson)}</strong><small>{flightType(day.direct)}</small>
            </button>
            <a href={safeHref(day.sourceUrl)} target="_blank" rel="noopener noreferrer">У airBaltic ↗</a>
            {day.benchmark && <Benchmark value={day.benchmark} dates/>}
        </div>)}</div>
        <p className="flight-note">{source?.updatedAt && <>Проверено {sourceTime(source.updatedAt)}. </>}
            Календарь показывает ориентир на вылет. Выберите день, чтобы запросить стоимость всего маршрута.</p>
    </section>
}

function emptyFares(received: number, source?: SupplySource) {
    if (received) return 'Срок полученных тарифов истёк.'
    if (source?.status == 'live' || source?.status == 'cached') return 'Поставщик не вернул тарифов по этим условиям.'
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
    return <section className="flight-results" aria-label="Результаты поиска">
        <h2>{query.origin} → {query.destination}</h2>
        <p className="flight-query-summary">{dateLabel(query.departure)}{query.returnDate ? ' — ' + dateLabel(query.returnDate) : ' · в одну сторону'}
            {' · взрослых ' + query.adults}{query.checkedBag && ' · с багажом'}</p>
        {!query.checkedBag && <FlexibleDates days={data.calendar} source={reference} selected={query.departure} onDate={onDate}/>}
        <section>
            <div className="flight-section-heading"><h3>Стоимость всей поездки</h3>
                {exact && <span>{exact.name}{exact.updatedAt && ' · ' + sourceTime(exact.updatedAt)}</span>}
            </div>
            {offers.length ? <div className="flight-offers">{offers.map(offer => <Offer key={offer.id} offer={offer} people={query.adults}/>)}</div>
                : <p className="flight-empty">{emptyFares(data.offers.length, exact)}{' '}
                    <button onClick={search.retry} className="travel-link">Запросить снова</button></p>}
        </section>
        {data.routeQuote && !query.checkedBag && <aside className="flight-route-quote">
            <h3>Ориентир на выбранный маршрут</h3>
            <p><strong>От {euro(data.routeQuote.total)}</strong> за всю поездку и всех пассажиров
                {data.routeQuote.carrier && ' · ' + data.routeQuote.carrier}.</p>
            <p className="flight-note">{data.routeQuote.description}</p>
            <div><a href={safeHref(data.routeQuote.sourceUrl)} target="_blank" rel="noopener noreferrer">Посмотреть в Google Flights ↗</a>
                <time dateTime={data.routeQuote.checkedAt}>Проверено {sourceTime(data.routeQuote.checkedAt)}</time></div>
        </aside>}
        {!!data.links.length && <section className="flight-handoff"><h3>Проверить у продавца</h3>
            <p>Откроется поиск на выбранный маршрут. Цена и места подтверждаются у продавца перед оплатой.</p>
            <div>{data.links.map(link => <a href={safeHref(link.url)} key={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}</div>
        </section>}
        <SourceLine sources={data.sources}/>
    </section>
}

function FlightForm({initial, auto}: {initial: FlightQuery, auto: boolean}) {
    const [draft, setDraft] = useState(initial)
    const [query, setQuery] = useState<FlightQuery | null>(auto && !flightError(initial) ? initial : null)
    const [refresh, setRefresh] = useState(0)
    const [error, setError] = useState('')
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
        setDraft(next)
        setQuery(next)
        setRefresh(n => n + 1)
        window.history.replaceState(null, '', flightLink(next))
    }
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
        <a href={travelHash('assistant', undefined, {...flightParams(query), kind: 'flights'})}>Уточнить маршрут в помощнике</a></div>
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
    if (!saved) return null
    return <section className="flight-resume"><Icon name="plane"/><div><strong>Последний поиск авиабилетов</strong>
        <p>{saved.origin} → {saved.destination} · {dateLabel(saved.departure)}{saved.returnDate && ' — ' + dateLabel(saved.returnDate)}
            {' · взрослых '}{saved.adults}</p></div>
        <a href={flightLink(saved)}>Проверить цены →</a></section>
}

export function Flights({route}: {route: TravelRoute}) {
    const base = useSavedFlight(defaultFlight)
    return <main className="travel-home flight-home"><header><p><Icon name="plane" size={16}/> Самостоятельная поездка</p>
        <h1>Авиабилеты</h1><span>Выберите аэропорты и сравните даты вылета.</span></header>
        {base && <FlightForm initial={flightForRoute(base, route.query)} auto={route.query.has('departure')}/>}
    </main>
}
