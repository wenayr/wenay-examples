import {useEffect, useEffectEvent, useMemo, useRef, useState} from 'react'
import type {PackageCalendar, PackageHotel, PackagePage, PackageSummary} from '../src/package-contract.ts'
import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import type {PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type MapProperty, type tMapBounds, type tMapCamera} from './DirectoryMap.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {dateLabel, hotelCount} from './presentation.ts'
import {loadPackages, packageQuery, savePackages, supportsPackage, type PackagePreferences} from './package-preferences.ts'
import {PackageFilters} from './PackageFilters.tsx'
import {PackageHotelPage} from './PackageHotelPage.tsx'
import {PackageMatrixPopup} from './PackageMatrixPopup.tsx'
import {HotelQuickSearch} from './HotelQuickSearch.tsx'
import {usePackageFavourites} from './package-favourites.ts'
import {selectedPackageFare} from './package-selection.ts'
import {browseFields, browseForRoute, dismissTravelDetail, openTravelDetail, packagesForRoute, replaceTravelHash, travelHash, travelRoute, type TravelRoute} from './navigation.ts'
import './package-map.css'
import {cameraForRoute} from './map-camera.ts'
import {matrixViewForRoute, refreshedMatrixSelection} from './package-matrix.ts'
import {usePageVisible, useVisibleRefresh} from './visible-refresh.ts'
import {packageHotelId, type tPackageHotel} from './package-hotel.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})
const pageSize = 12
const price = (total: number) => euros.format(total / 100)
const favouriteFilters = {
    all: 'Все отели', marked: 'С отметками', 1: 'Интересно', 2: 'Нравится', 3: 'Приоритет',
} as const
type tFavouriteFilter = keyof typeof favouriteFilters

function markerProperty(marker: tPackageHotel): MapProperty | null {
    if (marker.latitude == null || marker.longitude == null) return null
    const id = packageHotelId(marker)
    const total = 'minTotal' in marker ? marker.minTotal : undefined
    const label = total == null ? 'Проверить цену' : price(total)
    return {
        id, name: marker.name, latitude: marker.latitude, longitude: marker.longitude,
        priceTotal: total, priceLabel: label, photo: marker.photo ?? null,
        tooltip: marker.name + ' · ' + label,
    }
}

function BrowsePackages({initial, destinations, initialHotelName, openHotel, route}: {
    initial: PackagePreferences, destinations: SupplyDestination[], initialHotelName: string, openHotel: boolean, route: TravelRoute,
}) {
    const initialBrowse = browseForRoute(route, pageSize)
    const [prefs, setPrefs] = useState({...initial, hotelId: initialBrowse.selection || initial.hotelId})
    const destination = destinations.find(d => d.id === prefs.destination) ?? destinations[0]
    const [bounds, setBounds] = useState<tMapBounds | null>(initialBrowse.bounds)
    const [camera, setCamera] = useState<tMapCamera | null>(() => cameraForRoute(route))
    const favourites = usePackageFavourites()
    const [favouriteFilter, setFavouriteFilter] = useState<tFavouriteFilter>(() => {
        const value = route.query.get('favourite') ?? 'all'
        return Object.hasOwn(favouriteFilters, value) ? value as tFavouriteFilter : 'all'
    })
    const [open, setOpen] = useState<{hotelId: string, name: string} | null>(
        openHotel && initial.hotelId ? {hotelId: initial.hotelId, name: initialHotelName || 'Выбранный отель'} : null)
    const [priceView, setPriceView] = useState<'graph' | 'matrix'>(route.query.get('priceView') == 'matrix' ? 'matrix' : 'graph')
    const [matrixSelection, setMatrixSelection] = useState<PackageMatrixCell | null>(null)
    const [unconfirmedFareId, setUnconfirmedFareId] = useState('')
    const [matrixView, setMatrixView] = useState(() => matrixViewForRoute(initial.nights, route.query))
    const [hotelSearch, setHotelSearch] = useState((route.query.get('hotelSearch') ?? '').slice(0, 120))
    const [searchExpanded, setSearchExpanded] = useState(route.query.get('hotelSearchOpen') == '1' || Boolean(route.query.get('hotelSearch')))
    const [searchOffset, setSearchOffset] = useState(() => {
        const value = Number(route.query.get('hotelSearchOffset') ?? 0)
        return Number.isSafeInteger(value) && value >= 0 && value <= 100_000 ? Math.floor(value / 8) * 8 : 0
    })
    const [searchedHotel, setSearchedHotel] = useState<{hotel: PackageSummary | PackageHotel, context: string} | null>(null)
    const [openedIdentity, setOpenedIdentity] = useState<tPackageHotel | null>(null)
    const opener = useRef<HTMLElement | null>(null)
    const [fitRevision, setFitRevision] = useState(0)
    const [fitWhenReady, setFitWhenReady] = useState(false)
    const [snapshot, setSnapshot] = useState<{context: string, data: PackagePage} | null>(null)
    const tripContext = JSON.stringify({...packageQuery(prefs), minStars: prefs.minStars})
    const visible = usePageVisible()
    const mapActive = visible && !open
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined,
        limit: 100, ...range})
    const [settledUrl, setSettledUrl] = useState(url)
    useEffect(() => {
        if (url === settledUrl) return
        const timer = setTimeout(() => setSettledUrl(url), 250)
        return () => clearTimeout(timer)
    }, [url, settledUrl])
    const query = useDirectoryQuery<PackagePage>(mapActive ? settledUrl : null)
    const latest = url == settledUrl ? query.data : undefined
    const previous = snapshot?.context == tripContext ? snapshot.data : undefined
    const sourceRetryAt = latest?.source.retryAt
    const data = sourceRetryAt ? previous ?? latest : latest ?? previous
    const updating = url != settledUrl || query.loading
    const error = url == settledUrl ? query.error : undefined
    const sourceUnavailable = latest?.source.status == 'unavailable'
    useVisibleRefresh({enabled: mapActive, busy: updating, retryAt: query.error ? undefined : sourceRetryAt, onRefresh: query.retry})
    useEffect(() => {
        if (latest && !latest.source.retryAt) setSnapshot({context: tripContext, data: latest})
    }, [latest, tripContext])
    useEffect(() => {
        if (fitWhenReady && latest && !updating) {
            setFitRevision(value => value + 1)
            setFitWhenReady(false)
        }
    }, [fitWhenReady, latest, updating])
    useEffect(() => {
        if (prefs.hotelId || !latest || updating) return
        const first = latest.markers[0] ?? latest.items[0] ?? latest.knownHotels?.[0]
        if (first) setPrefs(current => current.hotelId ? current : {...current, hotelId: packageHotelId(first)})
    }, [latest, prefs.hotelId, updating])
    const needsCalendar = priceView == 'graph' || !open && !matrixSelection
    const calendarUrl = visible && prefs.hotelId && (open || prefs.fareId) && url == settledUrl && needsCalendar
        ? directoryUrl('package-calendar', {...packageQuery(prefs), hotelId: prefs.hotelId}) : null
    const calendarQuery = useDirectoryQuery<PackageCalendar>(calendarUrl)
    const calendar = calendarQuery.data
    useEffect(() => {
        if (!calendar || priceView != 'graph') return
        if (prefs.fareId) {
            const confirmed = calendar.days.some(day => day.inBudget?.id == prefs.fareId)
            setUnconfirmedFareId(confirmed ? '' : prefs.fareId)
        }
        setMatrixSelection(current => {
            if (!current?.inBudget) return current
            const selected = current.inBudget
            const found = calendar.days.some(day => day.inBudget?.id == selected.id && day.inBudget.total == selected.total)
            return found ? current : null
        })
    }, [calendar, priceView, prefs.fareId])
    const trendsUrl = mapActive && latest?.markers.length && !updating ? directoryUrl('package-trends', {
        ...packageQuery(prefs), minStars: prefs.minStars || undefined, ...range,
    }) : null
    const trendsQuery = useDirectoryQuery<PackageTrends>(trendsUrl)
    const trends = useMemo(() => new Map(trendsQuery.data?.items.map(item => [item.hotelId, item.days]) ?? []), [trendsQuery.data])
    const matrixFare = matrixSelection?.inBudget?.id == prefs.fareId ? matrixSelection.inBudget : undefined
    const calendarFare = selectedPackageFare(calendar, prefs.fareId)
    const selectedFare = matrixFare ?? calendarFare
    const missingSelection = Boolean(prefs.fareId && !selectedFare && (calendar || unconfirmedFareId == prefs.fareId))
    const searchedIdentity = searchedHotel && packageHotelId(searchedHotel.hotel) == prefs.hotelId ? searchedHotel.hotel : undefined
    const searchedSelection = searchedHotel?.context == tripContext ? searchedIdentity : undefined
    const openedSelection = openedIdentity && packageHotelId(openedIdentity) == prefs.hotelId ? openedIdentity : undefined
    const selectedHotel = data?.items.find(item => item.hotelId == prefs.hotelId) ?? data?.markers.find(item => item.hotelId == prefs.hotelId)
        ?? data?.knownHotels?.find(item => item.id == prefs.hotelId) ?? searchedIdentity ?? openedSelection
    const selectedName = calendar?.hotel.name ?? selectedHotel?.name ?? initialHotelName ?? 'Выбранный отель'
    const points = useMemo(() => {
        const byId = new Map([...(data?.knownHotels ?? []), ...(data?.markers ?? [])].map(hotel => [packageHotelId(hotel), hotel] as const))
        const located = [...byId.values()].flatMap(hotel => {
            const point = markerProperty(hotel)
            return point ? [point] : []
        })
        const markers = located.map(point => ({...point, trend: trends.get(point.id), favouriteLevel: favourites.levels[point.id] ?? 0}))
        const selected = data?.items.find(item => item.hotelId === prefs.hotelId) ?? searchedSelection
        const selectedPoint = selected && markerProperty(selected)
        if (selectedPoint && !markers.some(marker => marker.id == selectedPoint.id)) {
            markers.push({...selectedPoint, trend: trends.get(selectedPoint.id), favouriteLevel: favourites.levels[selectedPoint.id] ?? 0})
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
        if (favouriteFilter == 'all') return markers
        if (favouriteFilter == 'marked') return markers.filter(marker => marker.favouriteLevel > 0)
        return markers.filter(marker => marker.favouriteLevel == Number(favouriteFilter))
    }, [data, prefs.hotelId, selectedFare, missingSelection, trends, favourites.levels, favouriteFilter, searchedSelection])
    useEffect(() => { void savePackages(prefs) }, [prefs])
    function searchLink(detail = open, selected = prefs.hotelId, view = priceView) {
        const {destination, ...filters} = prefs
        const browse = browseFields({bounds, offset: 0, selection: selected, view: 'map'})
        return travelHash('packages', destination, {...filters, ...browse,
            mapLat: camera?.latitude, mapLon: camera?.longitude, mapZoom: camera?.zoom,
            fareId: selected == prefs.hotelId ? prefs.fareId : undefined,
            hotelId: detail?.hotelId, hotelName: detail?.name, hotelView: detail ? '1' : undefined,
            priceView: detail && view == 'matrix' ? 'matrix' : undefined,
            matrixFrom: matrixView.firstNights, matrixTo: matrixView.lastNights,
            matrixRow: matrixView.durationOffset, matrixDate: matrixView.dateOffset,
            hotelSearch: hotelSearch || undefined, hotelSearchOpen: searchExpanded ? '1' : undefined,
            hotelSearchOffset: searchOffset || undefined,
            favourite: favouriteFilter == 'all' ? undefined : favouriteFilter})
    }
    useEffect(() => {
        replaceTravelHash(searchLink())
    }, [prefs, bounds, camera, open, favouriteFilter, priceView, matrixView, hotelSearch, searchExpanded, searchOffset])
    const preserveMapOnBack = useEffectEvent(() => {
        const returned = travelRoute(window.location.hash)
        const returnsToMap = returned.page == 'packages' && returned.destination == prefs.destination && !returned.query.has('hotelId')
        if (!returnsToMap) return
        window.history.replaceState({...window.history.state, travelDetail: false}, '', searchLink(null))
        setOpen(null)
    })
    useEffect(() => {
        if (!open || !window.history.state?.travelDetail) return
        function returned() { preserveMapOnBack() }
        window.addEventListener('popstate', returned)
        return () => window.removeEventListener('popstate', returned)
    }, [Boolean(open)])
    function change(patch: Partial<PackagePreferences>) {
        const changedDestination = patch.destination != null && patch.destination != prefs.destination
        if (changedDestination) {
            setBounds(null)
            setCamera(null)
        }
        const changingBudget = patch.minTotal != null || patch.maxTotal != null
        if (!changingBudget || changedDestination) setOpen(null)
        setMatrixSelection(null)
        setUnconfirmedFareId('')
        setPrefs(current => ({...current, ...patch, hotelId: changedDestination ? '' : current.hotelId, fareId: ''}))
    }
    function searchArea(area: tMapBounds | null) {
        setBounds(area)
    }
    function showDirection() {
        setCamera(null)
        searchArea(null)
        setFitWhenReady(true)
    }
    function findHotel(id: string) {
        return data?.items.find(item => item.hotelId == id) ?? data?.markers.find(item => item.hotelId == id)
            ?? data?.knownHotels?.find(item => item.id == id)
            ?? (searchedHotel && packageHotelId(searchedHotel.hotel) == id ? searchedHotel.hotel : undefined)
    }
    function focusOpener() {
        if (opener.current?.isConnected && opener.current != document.body) {
            opener.current.focus({preventScroll: true})
            return
        }
        const result = [...document.querySelectorAll<HTMLElement>('[data-hotel-result-id]')]
            .find(element => element.dataset.hotelResultId == prefs.hotelId)
        const resultButton = result?.querySelector<HTMLButtonElement>('.is-primary')
        const marker = [...document.querySelectorAll<HTMLElement>('[data-hotel-ids]')]
            .find(element => element.dataset.hotelIds?.includes('"' + prefs.hotelId + '"'))
        if (resultButton) {
            resultButton.focus()
            return
        }
        const control = marker?.querySelector<HTMLButtonElement>('.map-hotel-card__matrix')
        if (control) control.focus({preventScroll: true})
        else document.getElementById('package-hotel-search')?.focus({preventScroll: true})
    }
    function selectHotel(hotel: tPackageHotel) {
        const hotelId = packageHotelId(hotel)
        if (hotelId != prefs.hotelId) {
            setMatrixSelection(null)
            setUnconfirmedFareId('')
        }
        setPrefs(current => ({...current, hotelId, fareId: current.hotelId == hotelId ? current.fareId : ''}))
    }
    function show(hotel: tPackageHotel, view: 'graph' | 'matrix' = 'graph', trigger?: HTMLElement) {
        const hotelId = packageHotelId(hotel)
        const detail = {hotelId, name: hotel.name}
        setOpenedIdentity(hotel)
        opener.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
        setPriceView(view)
        if (hotelId != prefs.hotelId) {
            setMatrixSelection(null)
            setUnconfirmedFareId('')
        }
        replaceTravelHash(searchLink(null, hotelId))
        openTravelDetail(searchLink(detail, hotelId, view))
        setOpen(detail)
        setPrefs(current => ({...current, hotelId, fareId: current.hotelId == hotelId ? current.fareId : ''}))
    }
    function selectMatrixFare(cell: PackageMatrixCell) {
        if (!cell.inBudget) return
        setMatrixSelection(cell)
        setUnconfirmedFareId('')
        setPrefs(current => ({...current, nights: cell.nights, fareId: cell.inBudget!.id}))
    }
    function changeMatrixTrip(patch: Partial<PackagePreferences>) {
        setMatrixSelection(null)
        setUnconfirmedFareId('')
        setPrefs(current => ({...current, ...patch, fareId: ''}))
    }
    function locateSearchHotel(hotel: PackageSummary | PackageHotel) {
        setSearchedHotel({hotel, context: tripContext})
        selectHotel(hotel)
        if (hotel.latitude == null || hotel.longitude == null) return
        setBounds(null)
        setCamera({latitude: hotel.latitude, longitude: hotel.longitude, zoom: 15.5})
    }
    function matrixSnapshot(cells: PackageMatrixCell[], failedCellKeys: string[]) {
        let selected = matrixSelection
        if (!selected && !unconfirmedFareId && prefs.fareId) {
            selected = cells.find(cell => cell.inBudget?.id == prefs.fareId && cell.nights == prefs.nights) ?? null
        }
        const refreshed = refreshedMatrixSelection(selected, cells, failedCellKeys)
        if (selected && !refreshed) setUnconfirmedFareId(prefs.fareId)
        setMatrixSelection(refreshed)
    }
    function locateHotel() {
        if (selectedHotel?.latitude == null || selectedHotel.longitude == null) return
        setCamera({latitude: selectedHotel.latitude, longitude: selectedHotel.longitude, zoom: 15})
        setOpen(null)
    }
    const detailHotel = calendar?.hotel ?? selectedHotel ?? {
        id: open?.hotelId ?? prefs.hotelId, name: open?.name ?? selectedName, stars: null,
        latitude: null, longitude: null, url: '',
    }
    return <main className="package-map-page" id="packages">
        <div className="package-map-stage">
            <DirectoryMap destination={destination} hotels={points} selectedId={prefs.hotelId || null}
                onSelect={id => {
                    const hotel = findHotel(id)
                    if (hotel) selectHotel(hotel)
                }}
                onOpen={id => {
                    const hotel = findHotel(id)
                    if (hotel) show(hotel)
                }}
                onMatrix={id => {
                    const hotel = findHotel(id)
                    const marker = [...document.querySelectorAll<HTMLElement>('[data-hotel-ids]')]
                        .find(element => element.dataset.hotelIds?.includes('"' + id + '"'))
                    const trigger = marker?.querySelector<HTMLButtonElement>('.map-hotel-card__matrix')
                    if (hotel) show(hotel, 'matrix', trigger ?? undefined)
                }}
                onFavourite={favourites.setLevel} camera={camera} onCamera={setCamera}
                onSearchArea={searchArea} bounds={bounds} onShowAll={showDirection} fitAllKey={fitRevision}
                detailedByDefault loading={updating} immersive/>
        </div>
        <HotelQuickSearch prefs={prefs} destination={destination} value={hotelSearch} onValue={setHotelSearch}
            expanded={searchExpanded} onExpanded={setSearchExpanded} offset={searchOffset} onOffset={setSearchOffset}
            suspended={Boolean(open)} onLocate={locateSearchHotel}
            onOpen={(hotel, view, trigger) => {
                setSearchedHotel({hotel, context: tripContext})
                show(hotel, view, trigger)
            }}/>
        <PackageFilters prefs={prefs} destinations={destinations} onChange={change} immersive/>
        <div className="package-map-toolbar">
            <div className="package-map-status" aria-live="polite" aria-busy={updating}>
                <strong>{destination.name}</strong>
                {data && <span>{favouriteFilter == 'all' ? hotelCount(data.direction.total + (data.knownHotels?.length ?? 0)) :
                    'С отметками · ' + points.length}</span>}
                {updating && <span>Обновляем цены…</span>}
                {error && <button type="button" onClick={query.retry}>Повторить поиск</button>}
                {!updating && data?.total == 0 && !sourceUnavailable && !sourceRetryAt && <span>Цены по этим параметрам пока не получены</span>}
                {sourceRetryAt && <>
                    <span>Ожидаем обновления до {new Date(sourceRetryAt).toLocaleTimeString('ru-RU')}</span>
                    {data?.source.updatedAt && <span>Цены от {new Date(data.source.updatedAt).toLocaleTimeString('ru-RU')}</span>}
                </>}
                {!updating && sourceUnavailable && !sourceRetryAt && <>
                    <span>Поставщик пока не подтвердил цены</span>
                    <button type="button" onClick={query.retry}>Повторить</button>
                </>}
            </div>
            <button type="button" disabled={updating} onClick={query.refresh} title="Заново запросить цены видимых отелей">↻ Цены</button>
            <select className="package-map-favourite-filter" aria-label="Показать избранные отели" value={favouriteFilter}
                onChange={event => setFavouriteFilter(event.target.value as tFavouriteFilter)}>
                {Object.entries(favouriteFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {bounds && <button type="button" className="package-map-show-all" onClick={showDirection}>Всё направление</button>}
        </div>
        {error && !data && <p className="package-map-error" role="status">{error}</p>}
        {favourites.temporary && <p className="package-map-storage-notice" role="status">Отметки сохраняются до закрытия вкладки.</p>}
        {open && priceView == 'matrix' && <PackageMatrixPopup hotel={detailHotel} prefs={prefs} destination={destination}
            selectedFare={selectedFare} selectionSource={matrixFare ? matrixSelection?.source : calendar?.source}
            selectionCheckedAt={matrixFare ? matrixSelection?.checkedAt : undefined} view={matrixView}
            onView={patch => setMatrixView(current => ({...current, ...patch}))} onSelect={selectMatrixFare} onSnapshot={matrixSnapshot}
            onChange={changeMatrixTrip} onClose={() => dismissTravelDetail(() => setOpen(null))} onRestoreFocus={focusOpener}
            onHotel={() => setPriceView('graph')} onLocate={locateHotel} favouriteLevel={favourites.levels[open.hotelId] ?? 0}
            onFavourite={level => favourites.setLevel(open.hotelId, level)}/>}
        {open && priceView == 'graph' && <PackageHotelPage hotel={detailHotel} prefs={prefs} destination={destination} calendar={calendar}
            selectedFare={selectedFare} error={calendarQuery.error} loading={calendarQuery.loading}
            onRetry={calendarQuery.retry} onFare={fareId => {
                setMatrixSelection(null)
                setUnconfirmedFareId('')
                setPrefs(current => ({...current, fareId}))
            }}
            onClose={() => dismissTravelDetail(() => setOpen(null))} onLocate={locateHotel}
            favouriteLevel={favourites.levels[open.hotelId] ?? 0}
            onFavourite={level => favourites.setLevel(open.hotelId, level)} priceView={priceView} onPriceView={setPriceView}
            onMatrixFare={selectMatrixFare} selectionSource={matrixFare ? matrixSelection?.source : undefined}
            selectionCheckedAt={matrixFare ? matrixSelection?.checkedAt : undefined}
            onMatrixSnapshot={matrixSnapshot} matrixView={matrixView}
            onMatrixView={patch => setMatrixView(current => ({...current, ...patch}))}/>}
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
