import {useEffect, useMemo, useRef, useState} from 'react'
import type {PackageCalendar, PackageMarker, PackagePage, PackageSummary} from '../src/package-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type tMapBounds} from './DirectoryMap.tsx'
import {safeHref} from './DirectoryCard.tsx'
import {SourceLine, sourceStatus} from './DirectoryOffers.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {dateLabel, hotelCount, photo} from './presentation.ts'
import {loadPackages, packageHash, packageQuery, savePackages, supportsPackage, type PackagePreferences} from './package-preferences.ts'
import {PackageFilters} from './PackageFilters.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {CalendarPreview} from './CalendarPreview.tsx'
import {packagesForRoute, travelHash, type TravelRoute} from './navigation.ts'
import {BrowseViews, useBrowseViews} from './BrowseViews.tsx'
import {packageTrip} from './trip/model.ts'
import {SaveTripButton} from './trip/TripPlan.tsx'
import type {SupplySource} from '../src/supply-contract.ts'
import {Icon} from './Icons.tsx'
import {shiftDate} from './directory-preferences.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})
const pageSize = 12
const price = (total: number) => euros.format(total / 100)
const rangeLabel = (min: number, max: number) => min === max ? price(min) : price(min) + ' – ' + price(max)
const partyLabel = (prefs: PackagePreferences) => 'За группу · взрослых: ' + prefs.adults + ' · ночей: ' + prefs.nights

function stars(value: number | null) {
    return value == null ? '' : value + ' ★'
}

function markerProperty(marker: PackageMarker) {
    const quote = rangeLabel(marker.minTotal, marker.maxTotal)
    return {
        id: marker.hotelId, name: marker.name, latitude: marker.latitude, longitude: marker.longitude,
        priceLabel: price(marker.minTotal), tooltip: [marker.name, stars(marker.stars), quote + ' за группу'].filter(Boolean).join(' · '),
    }
}

function PackageDetail({hotel, destination, prefs, onFare, onClose, onDate, onCalendar}: {
    hotel: {hotelId: string, name: string}
    prefs: PackagePreferences
    destination: SupplyDestination
    onDate: (date: string) => void
    onCalendar: (calendar: PackageCalendar) => void
    onFare: (id: string) => void
    onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const url = directoryUrl('package-calendar', {...packageQuery(prefs), hotelId: hotel.hotelId})
    const query = useDirectoryQuery<PackageCalendar>(url)
    const calendar = query.data
    useEffect(() => {
        if (calendar) onCalendar(calendar)
    }, [calendar, onCalendar])
    const fares = calendar?.days.flatMap(day => day.inBudget ? [day.inBudget] : []) ?? []
    const cheapest = fares.reduce<typeof fares[number] | undefined>((best, fare) => !best || fare.total < best.total ? fare : best, undefined)
    const selected = prefs.fareId ? fares.find(fare => fare.id === prefs.fareId) : cheapest
    useEffect(() => {
        const node = dialog.current
        node?.showModal()
        return () => node?.close()
    }, [])
    return <dialog className="hotel-detail directory-detail package-detail" ref={dialog} aria-labelledby="package-hotel-name"
        onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
        <div className="detail-content">
            <button type="button" className="detail-close" onClick={onClose} aria-label="Закрыть карточку тура"><Icon name="close"/></button>
            <p className="property-location"><Icon name="plane" size={16}/> Пакетный тур из Таллина
                {calendar?.hotel.stars != null && ' · ' + stars(calendar.hotel.stars)}</p>
            <h2 id="package-hotel-name">{calendar?.hotel.name ?? hotel.name}</h2>
            <p className="directory-period">{dateLabel(prefs.firstDeparture)} — {dateLabel(prefs.lastDeparture)} · {partyLabel(prefs)}</p>
            {calendar && <>
                <PriceCalendar days={calendar.days} selectedOfferId={selected?.id ?? null} onSelect={fare => onFare(fare.id)}/>
                {prefs.fareId && !selected && <p className="package-coverage" role="status">
                    Прежний тариф не найден среди текущих цен. Можно выбрать другой вылет на графике.</p>}
                {selected && <p className="package-selected" aria-live="polite"><span>Выбранный вылет · {dateLabel(selected.departure)}</span>
                    <strong>{price(selected.total)} <small>за группу</small></strong></p>}
                {selected && <div className="package-fare-actions">
                    <SaveTripButton item={packageTrip(calendar.hotel, selected, destination, prefs, calendar.source,
                        calendar.days.find(day => day.departure === selected.departure)?.checkedAt)}/>
                    {prefs.firstDeparture !== prefs.lastDeparture && <button type="button" className="travel-link"
                        onClick={() => onDate(selected.departure)}>Все отели с вылетом {dateLabel(selected.departure)}</button>}
                </div>}
                {safeHref(calendar.hotel.url) && <a className="package-supplier" href={safeHref(calendar.hotel.url)}
                    target="_blank" rel="noopener noreferrer">Отель у {calendar.source.name} ↗</a>}
                <p className="package-coverage">График показывает минимум по вылету и самый дешёвый полученный тариф в вашем бюджете.
                    Окончательную цену и наличие уточняйте у оператора.</p>
                <SourceLine sources={[calendar.source]}/>
            </>}
            {query.error && <p className="directory-error" role="status">{query.error} <button type="button" onClick={query.retry}>Повторить</button></p>}
            {!calendar && !query.error && <p role="status">Проверяем вылеты этого отеля…</p>}
        </div>
    </dialog>
}

function TourCard({item, prefs, destination, source, selected, onOpen, onLocate}: {
    item: PackageSummary
    destination: SupplyDestination
    source: SupplySource
    prefs: PackagePreferences
    selected: boolean
    onOpen: () => void
    onLocate: () => void
}) {
    return <article aria-label={item.name} className={'property-card package-card' + (selected ? ' is-selected' : '')}>
        <div className="property-body">
            <div className="property-location">{item.stars != null && <span className="package-stars">{stars(item.stars)}</span>}
                Вылет {dateLabel(item.best.departure)}</div>
            <h3><button type="button" onClick={onOpen}>{item.name}</button></h3>
            <strong className="package-price">{rangeLabel(item.minTotal, item.maxTotal)}</strong>
            <span className="property-category">{partyLabel(prefs)}</span>
            <SaveTripButton item={packageTrip({id:item.hotelId, name:item.name, stars:item.stars}, item.best, destination, prefs, source)}/>
            <div className="property-actions"><button type="button" onClick={onOpen}>Цены по датам <Icon name="arrow" size={14}/></button>
                {item.latitude != null && item.longitude != null && <button type="button" className="locate"
                    aria-label={'На карте: ' + item.name} onClick={onLocate}><Icon name="map" size={15}/> На карте</button>}</div>
        </div>
    </article>
}

function BrowsePackages({initial, destinations, initialHotelName, openHotel}: {
    initial: PackagePreferences, destinations: SupplyDestination[], initialHotelName: string, openHotel: boolean,
}) {
    const [prefs, setPrefs] = useState(initial)
    const destination = destinations.find(d => d.id === prefs.destination) ?? destinations[0]
    const [bounds, setBounds] = useState<tMapBounds | null>(null)
    const [offset, setOffset] = useState(0)
    const [open, setOpen] = useState<{hotelId: string, name: string} | null>(
        openHotel && initial.hotelId ? {hotelId: initial.hotelId, name: initialHotelName || 'Выбранный отель'} : null)
    const views = useBrowseViews()
    const [preview, setPreview] = useState<PackageCalendar | null>(null)
    const map = useRef<HTMLElement>(null)
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined,
        offset, limit: pageSize, ...range})
    const [settledUrl, setSettledUrl] = useState(url)
    useEffect(() => {
        if (url === settledUrl) return
        const timer = setTimeout(() => setSettledUrl(url), 250)
        return () => clearTimeout(timer)
    }, [url, settledUrl])
    const {data, error, retry} = useDirectoryQuery<PackagePage>(url === settledUrl ? url : null)
    const points = useMemo(() => {
        const markers = data?.markers.map(markerProperty) ?? []
        const selected = data?.items.find(item => item.hotelId === prefs.hotelId)
        if (selected?.latitude != null && selected.longitude != null && !markers.some(marker => marker.id === selected.hotelId)) {
            markers.push(markerProperty({...selected, latitude: selected.latitude, longitude: selected.longitude}))
        }
        return markers
    }, [data, prefs.hotelId])
    useEffect(() => { void savePackages(prefs) }, [prefs])
    function change(patch: Partial<PackagePreferences>) {
        setPreview(null)
        if (patch.destination !== undefined) {
            setBounds(null)
            window.history.replaceState(null, '', packageHash(patch.destination))
        }
        setOffset(0)
        setOpen(null)
        setPrefs(current => ({...current, ...patch, hotelId: '', fareId: ''}))
    }
    function searchArea(area: tMapBounds | null) {
        setBounds(area)
        setOffset(0)
        setOpen(null)
        if (area) views.setView('list')
    }
    function show(hotel: {hotelId: string, name: string}) {
        setOpen(hotel)
        setPrefs(current => ({...current, hotelId: hotel.hotelId, fareId: current.hotelId === hotel.hotelId ? current.fareId : ''}))
    }
    const assistant = travelHash('assistant', destination.id, {...packageQuery(prefs), kind: 'packages', minStars: prefs.minStars})
    const catalog = travelHash('catalog', destination.id, {
        checkIn: prefs.firstDeparture, checkOut: shiftDate(prefs.firstDeparture, prefs.nights), adults: prefs.adults,
    })
    return <main className="travel-home directory-home" id="packages">
        <header className={'directory-hero' + (destination.id === 'hurghada' ? ' has-cover' : '')}>
            {destination.id === 'hurghada' && <img src={photo('hurghada')} alt="" fetchPriority="high"/>}
            <div><p><Icon name="plane" size={17}/> Пакетные туры из Таллина</p><h1>{destination.name}</h1>
                <span><Icon name="pin" size={15}/> {destination.country}</span></div>
        </header>
        <div className="directory-layout">
            <PackageFilters prefs={prefs} destinations={destinations} onChange={change}/>
            <div className="directory-results">
                <div className="directory-summary"><div><p>{partyLabel(prefs)}</p><h2>Туры по датам вылета</h2></div>
                    <div className="directory-summary-actions" aria-live="polite">{data ? hotelCount(data.total) : (error || 'Загрузка…')}</div></div>
                <div className="browse-quick">
                    <a href={assistant}>Уточнить в помощнике</a>
                    <a href={catalog}>Отели без перелёта</a>
                </div>
                <BrowseViews {...views}/>
                <div className="directory-columns" data-view={views.view}>
                    <section className="directory-map-panel" ref={map} aria-label="Пакетные туры на карте">
                        <DirectoryMap destination={destination} hotels={points} selectedId={prefs.hotelId || null}
                            onSelect={id => {
                                const hotel = data?.markers.find(m => m.hotelId === id) ?? data?.items.find(item => item.hotelId === id)
                                if (hotel) show(hotel)
                            }}
                            onSearchArea={searchArea}/>
                        {!open && preview && points.some(marker => marker.id === preview.hotel.id) && prefs.hotelId === preview.hotel.id &&
                            <CalendarPreview calendar={preview} onOpen={() => show({hotelId: preview.hotel.id, name: preview.hotel.name})}/>}
                        {bounds && <button type="button" className="directory-area-reset" onClick={() => searchArea(null)}>Показать всё направление</button>}
                        {data && !points.length && data.total > 0 && <p className="directory-credits">
                            У найденных отелей пока нет подтверждённых координат. Все варианты доступны в списке.</p>}
                        {data?.markersTruncated && <p className="directory-credits">
                            Увеличьте карту и выберите «Искать в этой области», чтобы увидеть больше отелей.</p>}
                    </section>
                    <section className="directory-card-column" aria-label="Карточки пакетных туров" aria-busy={!data && !error}>
                        {data && !data.total && <div className="no-matches">
                            <h3>{data.source.status === 'unavailable' ? 'Тарифы пока недоступны' : 'Туров по этим параметрам пока нет'}</h3>
                            <p>{data.source.description || 'Попробуйте изменить даты вылета или бюджет.'}</p></div>}
                        {error && <p className="directory-error" role="status">{error} <button type="button" onClick={retry}>Повторить</button></p>}
                        {!data && !error && <p role="status" className="directory-loading">Запрашиваем предложения оператора…</p>}
                        <div className="directory-card-grid">{data?.items.map(item =>
                            <TourCard key={item.hotelId} item={item} prefs={prefs} destination={destination} source={data.source}
                                selected={prefs.hotelId === item.hotelId} onOpen={() => show(item)}
                                onLocate={() => {
                                    setPrefs(current => ({...current, hotelId: item.hotelId, fareId: current.hotelId === item.hotelId ? current.fareId : ''}))
                                    views.setView('map')
                                    requestAnimationFrame(() => map.current?.scrollIntoView({block: 'nearest'}))
                                }}/>)}</div>
                        {data && data.total > pageSize && <nav className="directory-pagination" aria-label="Страницы туров">
                            <button type="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Назад</button>
                            <span>{offset + 1}–{offset + data.items.length} из {data.total}</span>
                            <button type="button" disabled={data.nextOffset == null} onClick={() => {
                                if (data.nextOffset != null) setOffset(data.nextOffset)
                            }}>Дальше</button>
                        </nav>}
                    </section>
                </div>
                {data && <><p className="directory-credits">{data.source.name} · {sourceStatus[data.source.status]}
                    {data.source.updatedAt && <> · <time
                        dateTime={data.source.updatedAt}>{new Date(data.source.updatedAt).toLocaleString('ru-RU')}</time></>}</p>
                    <SourceLine sources={[data.source]}/></>}
            </div>
        </div>
        {open && <PackageDetail key={open.hotelId} hotel={open} destination={destination} prefs={prefs} onClose={() => setOpen(null)}
            onCalendar={setPreview}
            onDate={date => change({firstDeparture:date, lastDeparture:date})}
            onFare={fareId => setPrefs(current => ({...current, fareId}))}/>}
    </main>
}

export function PackageSearch({route}: {route: TravelRoute}) {
    const places = useDirectoryQuery<{destinations: SupplyDestination[]}>(directoryUrl('destinations'))
    const [stored, setStored] = useState<PackagePreferences | null>(null)
    useEffect(() => {
        let active = true
        void loadPackages().then(value => { if (active) setStored(value) })
        return () => { active = false }
    }, [])
    const destinations = places.data?.destinations.filter(place => supportsPackage(place.id))
    if (places.error) return <main className="travel-home"><h1>Пакетные туры</h1><p className="directory-error">{places.error}
        {' '}<button onClick={places.retry}>Повторить</button></p></main>
    if (!stored || !destinations) return <main className="travel-home"><h1>Пакетные туры</h1><p role="status">Загружаем направления…</p></main>
    if (!destinations.length) return <main className="travel-home"><h1>Пакетные туры</h1><p>Нет направлений у оператора.</p></main>
    const requested = route.destination ?? stored.destination
    const destination = destinations.find(place => place.id === requested)?.id ?? destinations[0].id
    const initial = packagesForRoute(stored, {...route, destination})
    return <BrowsePackages destinations={destinations} initial={initial} initialHotelName={route.query.get('hotelName') ?? ''}
        openHotel={route.query.has('hotelId')}/>
}
