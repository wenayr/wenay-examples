import {useEffect, useRef, useState} from 'react'
import type {SupplyCatalogPage, SupplyDestination, SupplyHotel, SupplyOptions} from '../src/supply-contract.ts'
import {DirectoryCard} from './DirectoryCard.tsx'
import {DirectoryMap, type tMapBounds} from './DirectoryMap.tsx'
import {DirectoryDetail} from './DirectoryDetail.tsx'
import {Rates, SourceCredits, SourceLine} from './DirectoryOffers.tsx'
import {directoryUrl, useDirectoryEvents, useDirectoryQuery} from './directory-query.ts'
import {createDirectoryPreferences, directoryDefaults, shiftDate, type DirectoryPreferences} from './directory-preferences.ts'
import {Icon} from './Icons.tsx'
import {photo, hotelCount} from './presentation.ts'

const pageSize = 12
const prefsStore = createDirectoryPreferences()

function imageForDestination(id: string) {
    if (id == 'hurghada' || id == 'phuket' || id == 'paphos') return photo(id)
}

function SearchFailure({message, onRetry}: {message: string, onRetry: () => void}) {
    return <p className="directory-error" role="status">{message} <button type="button" onClick={onRetry}>Повторить</button></p>
}

function PackageOffers({destination, prefs, shown, setShown}: {
    destination: SupplyDestination, prefs: DirectoryPreferences, shown: boolean, setShown: (value: boolean) => void,
}) {
    const [count, setCount] = useState(6)
    const [period, setPeriod] = useState<'selected' | 'upcoming'>('selected')
    const dates = period == 'selected' ? {checkIn: prefs.checkIn, checkOut: prefs.checkOut} : {}
    const url = directoryUrl('options', {
        destination: destination.id, ...dates, adults: prefs.adults,
    })
    const options = useDirectoryQuery<SupplyOptions>(shown ? url : null)
    const packages = options.data?.offers.filter(offer => offer.scope == 'package') ?? []
    return <section className="directory-packages">
        <div><Icon name="plane" size={21}/><h2>Пакетные туры из Таллина</h2></div>
        <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? 'Свернуть' : 'Посмотреть предложения'}</button>
        {shown && <div className="directory-package-body">
            <div className="directory-period-options" aria-label="Период пакетного тура">
                <button type="button" aria-pressed={period == 'selected'} onClick={() => setPeriod('selected')}>Выбранные даты</button>
                <button type="button" aria-pressed={period == 'upcoming'} onClick={() => setPeriod('upcoming')}>Ближайшие вылеты · 7 ночей</button>
            </div>
            {options.error && <SearchFailure message={options.error} onRetry={options.retry}/>}
            {!options.data && !options.error && <p role="status">Запрашиваем тарифы поставщиков…</p>}
            {options.data && (packages.length
                ? <><Rates items={packages.slice(0, count)}/>{count < packages.length &&
                    <button type="button" onClick={() => setCount(count + 6)}>Ещё предложения</button>}</>
                : <p>Поставщики пока не вернули пакетные тарифы на эти даты.</p>)}
            {options.data && <SourceLine sources={options.data.sources}/>}
        </div>}
    </section>
}

function Browse({destinations, initial}: {destinations: SupplyDestination[], initial: DirectoryPreferences}) {
    const validInitial = destinations.some(place => place.id == initial.destination)
    const [prefs, setPrefs] = useState(() => ({...initial, destination: validInitial ? initial.destination : destinations[0].id}))
    const destination = destinations.find(place => place.id == prefs.destination) ?? destinations[0]
    const [draft, setDraft] = useState(prefs.search)
    const [offset, setOffset] = useState(0)
    const [bounds, setBounds] = useState<tMapBounds | null>(null)
    const [selection, setSelection] = useState('')
    const [open, setOpen] = useState<SupplyHotel | null>(null)
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [showRates, setShowRates] = useState(false)
    const mapAnchor = useRef<HTMLDivElement>(null)
    const gridAnchor = useRef<HTMLDivElement>(null)
    const packagesAnchor = useRef<HTMLDivElement>(null)
    const range = bounds ? {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]} : undefined
    const url = directoryUrl('catalog', {destination: destination.id, q: prefs.search, source: prefs.source, limit: pageSize, offset, ...range})
    const [refresh, setRefresh] = useState(0)
    const query = useDirectoryQuery<SupplyCatalogPage>(url, refresh)
    const detailUrl = open ? directoryUrl('hotel', {destination: destination.id, hotelId: open.id}) : null
    const detail = useDirectoryQuery<{hotel: SupplyHotel | null}>(detailUrl, refresh)
    const response = query.data
    const [lastPage, setLastPage] = useState<SupplyCatalogPage | undefined>()
    const stable = response ?? (lastPage?.destination.id == destination.id ? lastPage : undefined)
    const items = response?.items ?? []
    useDirectoryEvents(destination.id, stable?.revision, () => setRefresh(previous => previous + 1))
    useEffect(() => {
        if (open && detail.data?.hotel === null) {
            setOpen(null)
            setSelection('')
        }
    }, [open, detail.data])
    useEffect(() => {
        // A removal can empty the last page while a visitor is looking at it.
        if (response && offset > 0 && offset >= response.total) {
            setOffset(Math.max(0, Math.floor((response.total - 1) / pageSize) * pageSize))
        }
    }, [offset, response])
    const visibleHotel = detail.data ? detail.data.hotel : open
    useEffect(() => {
        if (response) setLastPage(response)
    }, [response])
    useEffect(() => {
        const search = draft.trim()
        if (search == prefs.search) return
        const timer = setTimeout(() => {
            setOffset(0)
            setSelection('')
            setOpen(null)
            setPrefs(previous => ({...previous, search}))
        }, 260)
        return () => clearTimeout(timer)
    }, [draft, prefs.search])
    useEffect(() => { void prefsStore.save(prefs) }, [prefs])

    function update(next: Partial<DirectoryPreferences>) {
        setPrefs(previous => ({...previous, ...next}))
        setOffset(0)
        setSelection('')
        setOpen(null)
        if ('destination' in next) {
            setBounds(null)
            setDraft('')
            setPrefs(previous => ({...previous, source: '', search: ''}))
        }
    }

    function searchArea(next: tMapBounds | null) {
        setBounds(next)
        setOffset(0)
        setSelection('')
    }

    function changePage(next: number) {
        setSelection('')
        setOffset(next)
        gridAnchor.current?.scrollIntoView({block: 'start'})
    }

    function showHotel(hotel: SupplyHotel) {
        setSelection(hotel.id)
        setOpen(hotel)
    }

    function showOnMap(hotel: SupplyHotel) {
        setSelection(hotel.id)
        mapAnchor.current?.scrollIntoView({block: 'nearest'})
    }

    function showPackages() {
        setShowRates(true)
        packagesAnchor.current?.scrollIntoView()
    }

    function selectMarker(id: string) {
        const hotel = items.find(item => item.id == id)
        if (hotel) showHotel(hotel)
    }
    const cover = imageForDestination(destination.id)
    const start = new Date().toISOString().slice(0, 10)
    return <>
        <main className="travel-home directory-home" id="catalog">
            <header className={'directory-hero' + (cover ? ' has-cover' : '')}>
                {cover && <img src={cover} alt={'Пейзаж направления ' + destination.name} fetchPriority="high"/>}
                <div><p><Icon name="compass" size={17}/> Каталог отелей</p><h1>{destination.name}</h1>
                    <span><Icon name="pin" size={15}/> {destination.country}</span></div>
            </header>
            <div className="directory-layout">
                <aside className={'directory-filters filters' + (filtersOpen ? ' filters--expanded' : '')}>
                    <div className="filters-heading"><div><Icon name="filters"/><h2>Поиск отелей</h2></div>
                        <button type="button" className="filter-toggle" aria-label="Параметры поиска" aria-expanded={filtersOpen}
                            onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="down"/></button></div>
                    <div className="filter-fields">
                        <label className="filter-field"><span>Направление</span><select aria-label="Направление" value={destination.id}
                            onChange={event => update({destination: event.target.value})}>
                            {destinations.map(d => <option value={d.id} key={d.id}>{d.name} · {d.country}</option>)}</select></label>
                        <label className="filter-field"><span>Название отеля</span><input type="search" placeholder="Найти отель" value={draft}
                            maxLength={120} onChange={event => setDraft(event.target.value)}/></label>
                        <label className="filter-field"><span>Источник</span><select aria-label="Источник" value={prefs.source} onChange={event => update({source: event.target.value})}>
                            <option value="">Все источники</option>{stable?.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            {prefs.source && !stable?.sources.some(s => s.id == prefs.source) && <option value={prefs.source}>{prefs.source}</option>}
                        </select></label>
                        <fieldset><legend>Даты для проверки цены</legend>
                            <label className="filter-field"><span>Заезд</span><input type="date" min={start} value={prefs.checkIn} onChange={event => {
                                const value = event.target.value
                                if (value >= start) update({checkIn: value, checkOut: prefs.checkOut > value ? prefs.checkOut : shiftDate(value, 7)})
                            }}/></label>
                            <label className="filter-field"><span>Выезд</span><input type="date" min={shiftDate(prefs.checkIn, 1)} value={prefs.checkOut}
                                onChange={event => { if (event.target.value > prefs.checkIn) update({checkOut: event.target.value}) }}/></label>
                            <label className="filter-field"><span>Взрослых</span><select aria-label="Взрослых" value={prefs.adults} onChange={e => update({adults: Number(e.target.value)})}>
                                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n}>{n}</option>)}
                            </select></label>
                        </fieldset>
                        <button type="button" className="filter-reset" onClick={() => {
                            setDraft('')
                            searchArea(null)
                            update({...directoryDefaults(), destination: destination.id})
                        }}>Сбросить фильтры</button>
                    </div>
                </aside>
                <div className="directory-results">
                    <div className="directory-summary"><div><p>{destination.country}</p><h2>Отели и размещение</h2></div>
                        <div className="directory-summary-actions">
                            <button type="button" onClick={showPackages}>Пакетные туры ↓</button>
                            <span aria-live="polite">{response ? hotelCount(response.total) : (query.error || 'Загрузка…')}</span></div></div>
                    <div className="directory-columns">
                        <section className="directory-map-panel" aria-label="Отели на карте" ref={mapAnchor}>
                            <DirectoryMap destination={destination} hotels={items} selectedId={selection || null}
                                onSelect={selectMarker} onSearchArea={searchArea}/>
                            {response && <SourceCredits sources={response.sources}/>}
                            {bounds && <button type="button" className="directory-area-reset" onClick={() => searchArea(null)}>
                                Показать всё направление</button>}
                        </section>
                        <div ref={gridAnchor} className="directory-card-column" aria-label="Карточки отелей" aria-busy={!response && !query.error}>
                            {query.error && <SearchFailure message={query.error} onRetry={query.retry}/>}
                            {!response && !query.error && <p role="status" className="directory-loading">Загружаем отели…</p>}
                            {response && !items.length && <div className="no-matches"><h3>В этой выборке нет отелей</h3>
                                <p>Измените название, источник или область поиска.</p></div>}
                            <div className="directory-card-grid">{items.map((hotel, index) =>
                                <DirectoryCard hotel={hotel} key={hotel.id} selected={selection == hotel.id} index={index + 1}
                                    onOpen={showHotel} onLocate={showOnMap}/>)}</div>
                            {response && response.total > 0 && <nav className="directory-pagination" aria-label="Страницы отелей">
                                <button type="button" disabled={offset == 0} onClick={() => changePage(Math.max(0, offset - pageSize))}>Назад</button>
                                <span>{offset + 1}–{offset + items.length} из {response.total}</span>
                                <button type="button" disabled={response.nextOffset == null} onClick={() => {
                                    if (response.nextOffset != null) changePage(response.nextOffset)
                                }}>Дальше</button>
                            </nav>}
                        </div>
                    </div>
                    {response && <SourceLine sources={response.sources}/>}
                    <div ref={packagesAnchor}><PackageOffers key={destination.id} destination={destination} prefs={prefs}
                        shown={showRates} setShown={setShowRates}/></div>
                </div>
            </div>
        </main>
        <footer className="travel-footer"><strong>Wenay Travel</strong><span>Эстония</span>
            <a href={import.meta.env.BASE_URL + 'hotel-photos/credits.html'}>Фотографии отелей</a>
            <a href={import.meta.env.BASE_URL + 'images/credits.html'}>Фотографии направлений</a></footer>
        {visibleHotel && <DirectoryDetail key={visibleHotel.id} hotel={visibleHotel} destination={destination} prefs={prefs} onClose={() => setOpen(null)}/>}
    </>
}

export function Directory() {
    const query = useDirectoryQuery<{destinations: SupplyDestination[]}>(directoryUrl('destinations'))
    const [prefs, setPrefs] = useState<DirectoryPreferences | null>(null)
    useEffect(() => {
        let active = true
        void prefsStore.load().then(value => { if (active) setPrefs(value) })
        return () => { active = false }
    }, [])
    if (query.error) return <main className="travel-home"><h1>Каталог отелей</h1><SearchFailure message={query.error} onRetry={query.retry}/></main>
    if (!query.data || !prefs) return <main className="travel-home"><h1>Каталог отелей</h1><p role="status">Загружаем направления…</p></main>
    if (!query.data.destinations.length) return <main className="travel-home"><h1>Каталог отелей</h1><p>У поставщиков пока нет направлений.</p></main>
    return <Browse destinations={query.data.destinations} initial={prefs}/>
}
