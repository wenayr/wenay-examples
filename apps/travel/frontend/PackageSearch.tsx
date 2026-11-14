import {useEffect, useMemo, useRef, useState} from 'react'
import type {PackageCalendar, PackageMarker, PackagePage, PackageSummary} from '../src/package-contract.ts'
import {packageCoordinatePrecisions} from '../src/package-contract.ts'
import type {PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type tMapBounds} from './DirectoryMap.tsx'
import {safeHref} from './DirectoryCard.tsx'
import {SourceLine, sourceStatus} from './DirectoryOffers.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {dateLabel, hotelCount, photo} from './presentation.ts'
import {loadPackages, packageQuery, savePackages, supportsPackage, type PackagePreferences} from './package-preferences.ts'
import {PackageFilters} from './PackageFilters.tsx'
import {PriceCalendar} from './PriceCalendar.tsx'
import {PackagePricePanel} from './PackagePricePanel.tsx'
import {selectedPackageFare, selectedPackageSummary} from './package-selection.ts'
import {browseFields, browseForRoute, dismissTravelDetail, openTravelDetail, packagesForRoute, replaceTravelHash, travelHash, type TravelRoute} from './navigation.ts'
import {BrowseViews, useBrowseViews} from './BrowseViews.tsx'
import {packageTrip} from './trip/model.ts'
import {SaveTripButton} from './trip/TripPlan.tsx'
import type {SupplySource} from '../src/supply-contract.ts'
import {Icon} from './Icons.tsx'
import {shiftDate} from './directory-preferences.ts'
import {providerQueryLink} from './provider-client.ts'

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
    const precision = marker.coordinateSource && packageCoordinatePrecisions[marker.coordinateSource.precision]
    return {
        id: marker.hotelId, name: marker.name, latitude: marker.latitude, longitude: marker.longitude,
        priceTotal: marker.minTotal, priceLabel: price(marker.minTotal),
        tooltip: [marker.name, stars(marker.stars), quote + ' за группу', precision].filter(Boolean).join(' · '),
    }
}

function PackageDetail({hotel, destination, prefs, calendar, error, onRetry, onFare, onClose, onDate}: {
    hotel: {hotelId: string, name: string}
    prefs: PackagePreferences
    destination: SupplyDestination
    onDate: (date: string) => void
    calendar: PackageCalendar | undefined
    error: string | undefined
    onRetry: () => void
    onFare: (id: string) => void
    onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const selected = selectedPackageFare(calendar, prefs.fareId)
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
            {error && <p className="directory-error" role="status">{error} <button type="button" onClick={onRetry}>Повторить</button></p>}
            {!calendar && !error && <p role="status">Проверяем вылеты этого отеля…</p>}
        </div>
    </dialog>
}

function TourCard({item, prefs, destination, source, selected, missingSelection, onOpen, onSelect, onLocate}: {
    item: PackageSummary
    destination: SupplyDestination
    source: SupplySource
    prefs: PackagePreferences
    selected: boolean
    missingSelection: boolean
    onOpen: () => void
    onSelect: () => void
    onLocate: () => void
}) {
    return <article aria-label={item.name} className={'property-card package-card' + (selected ? ' is-selected' : '')}>
        <div className="property-body">
            <div className="property-location">{item.stars != null && <span className="package-stars">{stars(item.stars)}</span>}
                {missingSelection ? 'Выбранный тариф не найден' : 'Вылет ' + dateLabel(item.best.departure)}</div>
            <h3><button type="button" onClick={onOpen}>{item.name}</button></h3>
            {!missingSelection && <strong className="package-price">{rangeLabel(item.minTotal, item.maxTotal)}</strong>}
            <span className="property-category">{partyLabel(prefs)}</span>
            {!missingSelection && <SaveTripButton item={packageTrip({id:item.hotelId, name:item.name, stars:item.stars}, item.best,
                destination, prefs, source)}/>}
            <div className="property-actions"><button type="button" onClick={onSelect}>График цен <Icon name="arrow" size={14}/></button>
                {item.latitude != null && item.longitude != null && <button type="button" className="locate"
                    aria-label={'На карте: ' + item.name} onClick={onLocate}><Icon name="map" size={15}/> На карте</button>}</div>
        </div>
    </article>
}

function BrowsePackages({initial, destinations, initialHotelName, openHotel, route}: {
    initial: PackagePreferences, destinations: SupplyDestination[], initialHotelName: string, openHotel: boolean, route: TravelRoute,
}) {
    const initialBrowse = browseForRoute(route, pageSize)
    const [prefs, setPrefs] = useState({...initial, hotelId: initialBrowse.selection || initial.hotelId})
    const destination = destinations.find(d => d.id === prefs.destination) ?? destinations[0]
    const [bounds, setBounds] = useState<tMapBounds | null>(initialBrowse.bounds)
    const [offset, setOffset] = useState(initialBrowse.offset)
    const [open, setOpen] = useState<{hotelId: string, name: string} | null>(
        openHotel && initial.hotelId ? {hotelId: initial.hotelId, name: initialHotelName || 'Выбранный отель'} : null)
    const views = useBrowseViews(initialBrowse.view)
    const map = useRef<HTMLElement>(null)
    const chart = useRef<HTMLDivElement>(null)
    const [fitRevision, setFitRevision] = useState(0)
    const [fitWhenReady, setFitWhenReady] = useState(false)
    const [snapshot, setSnapshot] = useState<{destination: string, data: PackagePage} | null>(null)
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined,
        offset, limit: pageSize, ...range})
    const [settledUrl, setSettledUrl] = useState(url)
    useEffect(() => {
        if (url === settledUrl) return
        const timer = setTimeout(() => setSettledUrl(url), 250)
        return () => clearTimeout(timer)
    }, [url, settledUrl])
    const query = useDirectoryQuery<PackagePage>(settledUrl)
    const latest = url == settledUrl ? query.data : undefined
    const previous = snapshot?.destination == prefs.destination ? snapshot.data : undefined
    const data = latest ?? previous
    const updating = url != settledUrl || query.loading
    const error = url == settledUrl ? query.error : undefined
    useEffect(() => {
        if (latest) setSnapshot({destination: prefs.destination, data: latest})
    }, [latest, prefs.destination])
    useEffect(() => {
        if (fitWhenReady && latest && !updating) {
            setFitRevision(value => value + 1)
            setFitWhenReady(false)
        }
    }, [fitWhenReady, latest, updating])
    useEffect(() => {
        if (prefs.hotelId || !latest || updating) return
        const first = latest.markers[0] ?? latest.items[0]
        if (first) setPrefs(current => current.hotelId ? current : {...current, hotelId: first.hotelId})
    }, [latest, prefs.hotelId, updating])
    const calendarUrl = prefs.hotelId && url == settledUrl
        ? directoryUrl('package-calendar', {...packageQuery(prefs), hotelId: prefs.hotelId}) : null
    const calendarQuery = useDirectoryQuery<PackageCalendar>(calendarUrl)
    const calendar = calendarQuery.data
    const trendsUrl = latest?.markers.length && !updating ? directoryUrl('package-trends', {
        ...packageQuery(prefs), minStars: prefs.minStars || undefined, ...range,
    }) : null
    const trendsQuery = useDirectoryQuery<PackageTrends>(trendsUrl)
    const trends = useMemo(() => new Map(trendsQuery.data?.items.map(item => [item.hotelId, item.days]) ?? []), [trendsQuery.data])
    const selectedFare = selectedPackageFare(calendar, prefs.fareId)
    const missingSelection = Boolean(prefs.fareId && calendar && !selectedFare)
    const selectedHotel = data?.markers.find(item => item.hotelId == prefs.hotelId) ?? data?.items.find(item => item.hotelId == prefs.hotelId)
    const selectedName = calendar?.hotel.name ?? selectedHotel?.name ?? initialHotelName ?? 'Выбранный отель'
    const points = useMemo(() => {
        const markers = data?.markers.map(marker => ({...markerProperty(marker), trend: trends.get(marker.hotelId)})) ?? []
        const selected = data?.items.find(item => item.hotelId === prefs.hotelId)
        if (selected?.latitude != null && selected.longitude != null && !markers.some(marker => marker.id === selected.hotelId)) {
            markers.push({...markerProperty({...selected, latitude: selected.latitude, longitude: selected.longitude}), trend: trends.get(selected.hotelId)})
        }
        const point = markers.find(marker => marker.id == prefs.hotelId)
        if (point && selectedFare) {
            point.priceTotal = selectedFare.total
            point.priceLabel = price(selectedFare.total)
            point.tooltip = point.name + ' · вылет ' + dateLabel(selectedFare.departure) + ' · ' + price(selectedFare.total) + ' за группу'
        }
        if (point && missingSelection) {
            point.priceLabel = 'Выбрать тариф'
            point.tooltip = point.name + ' · прежний тариф не найден. Выберите другой вылет на графике.'
        }
        return markers
    }, [data, prefs.hotelId, selectedFare, missingSelection, trends])
    useEffect(() => { void savePackages(prefs) }, [prefs])
    function searchLink(detail = open, selected = prefs.hotelId) {
        const {destination, ...filters} = prefs
        const browse = browseFields({bounds, offset, selection: selected, view: views.view})
        return travelHash('packages', destination, {...filters, ...browse, hotelId: detail?.hotelId, hotelName: detail?.name})
    }
    useEffect(() => {
        replaceTravelHash(searchLink())
    }, [prefs, bounds, offset, views.view, open])
    function change(patch: Partial<PackagePreferences>) {
        const changedDestination = patch.destination != null && patch.destination != prefs.destination
        if (changedDestination) {
            setBounds(null)
        }
        setOffset(0)
        setOpen(null)
        setPrefs(current => ({...current, ...patch, hotelId: changedDestination ? '' : current.hotelId, fareId: ''}))
    }
    function searchArea(area: tMapBounds | null) {
        setBounds(area)
        setOffset(0)
    }
    function showDirection() {
        searchArea(null)
        setFitWhenReady(true)
    }
    function selectHotel(hotel: {hotelId: string, name: string}) {
        setPrefs(current => ({...current, hotelId: hotel.hotelId, fareId: current.hotelId == hotel.hotelId ? current.fareId : ''}))
    }
    function showGraph(hotel: {hotelId: string, name: string}) {
        selectHotel(hotel)
        requestAnimationFrame(() => chart.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'}))
    }
    function show(hotel: {hotelId: string, name: string}) {
        openTravelDetail(searchLink(hotel, hotel.hotelId))
        setOpen(hotel)
        setPrefs(current => ({...current, hotelId: hotel.hotelId, fareId: current.hotelId === hotel.hotelId ? current.fareId : ''}))
    }
    const assistant = travelHash('assistant', destination.id, {...packageQuery(prefs), kind: 'packages', minStars: prefs.minStars})
    const catalog = travelHash('catalog', destination.id, {
        checkIn: prefs.firstDeparture, checkOut: shiftDate(prefs.firstDeparture, prefs.nights), adults: prefs.adults,
    })
    return <main className="travel-home directory-home package-search" id="packages">
        <header className={'directory-hero' + (destination.id === 'hurghada' ? ' has-cover' : '')}>
            {destination.id === 'hurghada' && <img src={photo('hurghada')} alt="" fetchPriority="high"/>}
            <div><p><Icon name="plane" size={17}/> Пакетные туры из Таллина</p><h1>{destination.name}</h1>
                <span><Icon name="pin" size={15}/> {destination.country}</span></div>
        </header>
        <div className="directory-layout">
            <PackageFilters prefs={prefs} destinations={destinations} onChange={change}/>
            <div className="directory-results">
                <div className="directory-summary"><div><p>{partyLabel(prefs)}</p><h2>Туры по датам вылета</h2></div>
                    <div className="directory-summary-actions" aria-live="polite">
                        {data ? hotelCount(data.direction.total) : (error || 'Загрузка…')}
                        {updating && data && <span>Обновляем цены…</span>}
                    </div></div>
                <div className="browse-quick">
                    <a href={assistant}>Уточнить в помощнике</a>
                    <a href={catalog}>Отели без перелёта</a>
                    <a href={providerQueryLink({kind: 'packages', origin: 'TLL', destination: prefs.destination,
                        departure: prefs.firstDeparture, returnDate: shiftDate(prefs.firstDeparture, prefs.nights), adults: prefs.adults,
                        checkIn: prefs.firstDeparture, checkOut: shiftDate(prefs.firstDeparture, prefs.nights), currency: 'EUR'})}>
                        Сравнить поставщиков на {dateLabel(prefs.firstDeparture)}</a>
                </div>
                <div className="browse-context" aria-label="Текущие параметры поиска туров">
                    <span>{dateLabel(prefs.firstDeparture)} — {dateLabel(prefs.lastDeparture)}</span>
                    <span>{rangeLabel(prefs.minTotal, prefs.maxTotal)} за группу</span>
                    {prefs.minStars > 0 && <button type="button" onClick={() => change({minStars: 0})}>
                        От {prefs.minStars} ★<Icon name="close" size={12}/></button>}
                    {bounds && <button type="button" onClick={() => searchArea(null)}>
                        Область на карте<Icon name="close" size={12}/></button>}
                </div>
                <div ref={chart} className="package-chart-anchor">
                    {prefs.hotelId && <PackagePricePanel name={selectedName || 'Выбранный отель'} calendar={calendar} selected={selectedFare}
                        missingSelection={missingSelection}
                        loading={updating || calendarQuery.loading} error={calendarQuery.error} party={partyLabel(prefs)}
                        onFare={fareId => setPrefs(current => ({...current, fareId}))}
                        onDate={date => change({firstDeparture: date, lastDeparture: date})}
                        onOpen={() => show({hotelId: prefs.hotelId, name: selectedName})} onRetry={calendarQuery.retry}/>}
                    {!prefs.hotelId && updating && <p className="package-price-panel package-price-panel__loading" role="status">
                        Загружаем отели и график цен…</p>}
                </div>
                <BrowseViews {...views}/>
                <div className="directory-columns" data-view={views.view}>
                    <section className="directory-map-panel" ref={map} aria-label="Пакетные туры на карте">
                        {data && <div className="package-map-coverage" aria-live="polite" aria-busy={updating}
                            data-mapped={data.geo.mapped} data-unresolved={data.geo.unresolved} data-direction-total={data.direction.total}>
                            <strong>На карте {points.length} из {data.total} отелей</strong>
                            <span>Без координат {data.geo.unresolved}</span>
                            {bounds && <span>По всему направлению {hotelCount(data.direction.total)}</span>}
                            <button type="button" className="travel-link" onClick={showDirection}>Показать всё направление</button>
                            {updating && <small>Обновляем цены…</small>}
                            {error && data != latest && <small>Показана предыдущая выдача до обновления.</small>}
                        </div>}
                        <DirectoryMap destination={destination} hotels={points} selectedId={prefs.hotelId || null}
                            onSelect={id => {
                                const hotel = data?.markers.find(m => m.hotelId === id) ?? data?.items.find(item => item.hotelId === id)
                                if (hotel) showGraph(hotel)
                            }}
                            onSearchArea={searchArea} bounds={bounds} onShowAll={showDirection} fitAllKey={fitRevision}
                            detailedByDefault loading={updating}/>
                        {data && !points.length && data.total > 0 && <p className="directory-credits">
                            У найденных отелей пока нет подтверждённых координат. Все варианты доступны в списке.</p>}
                        {data?.markersTruncated && <p className="directory-credits">
                            На карте показана часть координат. Приблизьте нужный район — выдача обновится автоматически.</p>}
                        {data && <p className="directory-credits package-map-series-status" aria-live="polite">
                            {trendsQuery.loading ? 'Проверяем дневные минимумы для миниграфиков…' : 'Миниграфики — дневные минимумы в выбранном бюджете.'}
                            {' '}Пустые дни означают отсутствие опубликованного минимума в этой выборке.
                            {trendsQuery.error && <> {trendsQuery.error}
                                <button type="button" className="travel-link" onClick={trendsQuery.retry}>Повторить</button></>}
                        </p>}
                        <p className="directory-credits">Привязки отелей — TEZ TOUR, Xotelo/Tripadvisor и{' '}
                            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>.
                            {' '}Источник и точность выбранного отеля указаны у графика.</p>
                    </section>
                    <section className="directory-card-column" aria-label="Карточки пакетных туров" aria-busy={updating}>
                        {data && !data.total && <div className="no-matches">
                            <h3>{data.source.status === 'unavailable' ? 'Тарифы пока недоступны' : 'Туров по этим параметрам пока нет'}</h3>
                            <p>{data.source.description || 'Попробуйте изменить даты вылета или бюджет.'}</p></div>}
                        {error && <p className="directory-error" role="status">{error} <button type="button" onClick={query.retry}>Повторить</button></p>}
                        {!data && !error && <p role="status" className="directory-loading">Запрашиваем предложения оператора…</p>}
                        <div className="directory-card-grid">{data?.items.map(item =>
                            <TourCard key={item.hotelId} item={selectedPackageSummary(item, prefs.hotelId, selectedFare)}
                                prefs={prefs} destination={destination} source={data.source}
                                missingSelection={item.hotelId == prefs.hotelId && missingSelection}
                                selected={prefs.hotelId === item.hotelId} onOpen={() => show(item)}
                                onSelect={() => showGraph(item)}
                                onLocate={() => {
                                    setPrefs(current => ({...current, hotelId: item.hotelId, fareId: current.hotelId === item.hotelId ? current.fareId : ''}))
                                    views.setView('map')
                                    requestAnimationFrame(() => map.current?.scrollIntoView({block: 'nearest'}))
                                }}/>)}</div>
                        {data && data.total > pageSize && <nav className="directory-pagination" aria-label="Страницы туров">
                            <button type="button" disabled={!offset || updating} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Назад</button>
                            <span>{offset + 1}–{offset + data.items.length} из {data.total}</span>
                            <button type="button" disabled={data.nextOffset == null || updating} onClick={() => {
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
        {open && <PackageDetail key={open.hotelId} hotel={open} destination={destination} prefs={prefs}
            calendar={calendar} error={calendarQuery.error} onRetry={calendarQuery.retry}
            onClose={() => dismissTravelDetail(() => setOpen(null))}
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
        openHotel={route.query.has('hotelId')} route={route}/>
}
