import {useEffect, useEffectEvent, useMemo, useState} from 'react'
import type {PackageCalendar, PackageMarker, PackagePage} from '../src/package-contract.ts'
import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import type {PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type tMapBounds, type tMapCamera} from './DirectoryMap.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {dateLabel, hotelCount} from './presentation.ts'
import {loadPackages, packageQuery, savePackages, supportsPackage, type PackagePreferences} from './package-preferences.ts'
import {PackageFilters} from './PackageFilters.tsx'
import {PackageHotelPage} from './PackageHotelPage.tsx'
import {usePackageFavourites} from './package-favourites.ts'
import {selectedPackageFare} from './package-selection.ts'
import {browseFields, browseForRoute, dismissTravelDetail, openTravelDetail, packagesForRoute, replaceTravelHash, travelHash, travelRoute, type TravelRoute} from './navigation.ts'
import './package-map.css'
import {cameraForRoute} from './map-camera.ts'
import {matrixViewForRoute, refreshedMatrixSelection} from './package-matrix.ts'

const euros = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2})
const pageSize = 12
const price = (total: number) => euros.format(total / 100)
const favouriteFilters = {
    all: 'Все отели', marked: 'С отметками', 1: 'Интересно', 2: 'Нравится', 3: 'Приоритет',
} as const
type tFavouriteFilter = keyof typeof favouriteFilters

function markerProperty(marker: PackageMarker) {
    return {
        id: marker.hotelId, name: marker.name, latitude: marker.latitude, longitude: marker.longitude,
        priceTotal: marker.minTotal, priceLabel: price(marker.minTotal), photo: marker.photo ?? null,
        tooltip: marker.name + ' · ' + price(marker.minTotal) + ' за группу',
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
    const [fitRevision, setFitRevision] = useState(0)
    const [fitWhenReady, setFitWhenReady] = useState(false)
    const [snapshot, setSnapshot] = useState<{destination: string, data: PackagePage} | null>(null)
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined,
        limit: 100, ...range})
    const [settledUrl, setSettledUrl] = useState(url)
    useEffect(() => {
        if (url === settledUrl) return
        const timer = setTimeout(() => setSettledUrl(url), 250)
        return () => clearTimeout(timer)
    }, [url, settledUrl])
    const query = useDirectoryQuery<PackagePage>(settledUrl)
    const latest = url == settledUrl ? query.data : undefined
    const previous = snapshot?.destination == prefs.destination ? snapshot.data : undefined
    const sourceRetryAt = latest?.source.retryAt
    const data = sourceRetryAt ? previous ?? latest : latest ?? previous
    const updating = url != settledUrl || query.loading
    const error = url == settledUrl ? query.error : undefined
    const sourceUnavailable = latest?.source.status == 'unavailable'
    const retryPackages = useEffectEvent(query.retry)
    useEffect(() => {
        if (!sourceRetryAt) return
        const delay = Math.max(0, Date.parse(sourceRetryAt) - Date.now())
        const timer = setTimeout(() => retryPackages(), delay)
        return () => clearTimeout(timer)
    }, [sourceRetryAt])
    useEffect(() => {
        if (latest && !latest.source.retryAt) setSnapshot({destination: prefs.destination, data: latest})
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
    const needsCalendar = priceView == 'graph' || !open && !matrixSelection
    const calendarUrl = prefs.hotelId && (open || prefs.fareId) && url == settledUrl && needsCalendar
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
    const trendsUrl = latest?.markers.length && !updating ? directoryUrl('package-trends', {
        ...packageQuery(prefs), minStars: prefs.minStars || undefined, ...range,
    }) : null
    const trendsQuery = useDirectoryQuery<PackageTrends>(trendsUrl)
    const trends = useMemo(() => new Map(trendsQuery.data?.items.map(item => [item.hotelId, item.days]) ?? []), [trendsQuery.data])
    const matrixFare = matrixSelection?.inBudget?.id == prefs.fareId ? matrixSelection.inBudget : undefined
    const calendarFare = selectedPackageFare(calendar, prefs.fareId)
    const selectedFare = matrixFare ?? calendarFare
    const missingSelection = Boolean(prefs.fareId && !selectedFare && (calendar || unconfirmedFareId == prefs.fareId))
    const selectedHotel = data?.markers.find(item => item.hotelId == prefs.hotelId) ?? data?.items.find(item => item.hotelId == prefs.hotelId)
    const selectedName = calendar?.hotel.name ?? selectedHotel?.name ?? initialHotelName ?? 'Выбранный отель'
    const points = useMemo(() => {
        const markers = data?.markers.map(marker => ({...markerProperty(marker), trend: trends.get(marker.hotelId),
            favouriteLevel: favourites.levels[marker.hotelId] ?? 0})) ?? []
        const selected = data?.items.find(item => item.hotelId === prefs.hotelId)
        if (selected?.latitude != null && selected.longitude != null && !markers.some(marker => marker.id === selected.hotelId)) {
            markers.push({...markerProperty({...selected, latitude: selected.latitude, longitude: selected.longitude}),
                trend: trends.get(selected.hotelId), favouriteLevel: favourites.levels[selected.hotelId] ?? 0})
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
    }, [data, prefs.hotelId, selectedFare, missingSelection, trends, favourites.levels, favouriteFilter])
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
            favourite: favouriteFilter == 'all' ? undefined : favouriteFilter})
    }
    useEffect(() => {
        replaceTravelHash(searchLink())
    }, [prefs, bounds, camera, open, favouriteFilter, priceView, matrixView])
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
    function selectHotel(hotel: {hotelId: string, name: string}) {
        if (hotel.hotelId != prefs.hotelId) {
            setMatrixSelection(null)
            setUnconfirmedFareId('')
        }
        setPrefs(current => ({...current, hotelId: hotel.hotelId, fareId: current.hotelId == hotel.hotelId ? current.fareId : ''}))
    }
    function show(hotel: {hotelId: string, name: string}, view: 'graph' | 'matrix' = 'graph') {
        setPriceView(view)
        if (hotel.hotelId != prefs.hotelId) {
            setMatrixSelection(null)
            setUnconfirmedFareId('')
        }
        replaceTravelHash(searchLink(null, hotel.hotelId))
        openTravelDetail(searchLink(hotel, hotel.hotelId, view))
        setOpen(hotel)
        setPrefs(current => ({...current, hotelId: hotel.hotelId, fareId: current.hotelId === hotel.hotelId ? current.fareId : ''}))
    }
    function selectMatrixFare(cell: PackageMatrixCell) {
        if (!cell.inBudget) return
        setMatrixSelection(cell)
        setUnconfirmedFareId('')
        setPrefs(current => ({...current, nights: cell.nights, fareId: cell.inBudget!.id}))
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
                    const hotel = data?.markers.find(item => item.hotelId == id)
                    if (hotel) selectHotel(hotel)
                }}
                onOpen={id => {
                    const hotel = data?.markers.find(item => item.hotelId == id)
                    if (hotel) show(hotel)
                }}
                onMatrix={id => {
                    const hotel = data?.markers.find(item => item.hotelId == id)
                    if (hotel) show(hotel, 'matrix')
                }}
                onFavourite={favourites.setLevel} camera={camera} onCamera={setCamera}
                onSearchArea={searchArea} bounds={bounds} onShowAll={showDirection} fitAllKey={fitRevision}
                detailedByDefault loading={updating} immersive/>
        </div>
        <PackageFilters prefs={prefs} destinations={destinations} onChange={change} immersive/>
        <div className="package-map-toolbar">
            <div className="package-map-status" aria-live="polite" aria-busy={updating}>
                <strong>{destination.name}</strong>
                {data && <span>{favouriteFilter == 'all' ? hotelCount(data.direction.total) : 'С отметками · ' + points.length}</span>}
                {updating && <span>Обновляем цены…</span>}
                {error && <button type="button" onClick={query.retry}>Повторить поиск</button>}
                {!updating && data?.total == 0 && !sourceUnavailable && !sourceRetryAt && <span>По этим параметрам туров нет</span>}
                {sourceRetryAt && <>
                    <span>Ожидаем обновления до {new Date(sourceRetryAt).toLocaleTimeString('ru-RU')}</span>
                    {data?.source.updatedAt && <span>Цены от {new Date(data.source.updatedAt).toLocaleTimeString('ru-RU')}</span>}
                </>}
                {!updating && sourceUnavailable && !sourceRetryAt && <>
                    <span>Поставщик пока не подтвердил цены</span>
                    <button type="button" onClick={query.retry}>Повторить</button>
                </>}
            </div>
            <select className="package-map-favourite-filter" aria-label="Показать избранные отели" value={favouriteFilter}
                onChange={event => setFavouriteFilter(event.target.value as tFavouriteFilter)}>
                {Object.entries(favouriteFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {bounds && <button type="button" className="package-map-show-all" onClick={showDirection}>Всё направление</button>}
        </div>
        {error && !data && <p className="package-map-error" role="status">{error}</p>}
        {favourites.temporary && <p className="package-map-storage-notice" role="status">Отметки сохраняются до закрытия вкладки.</p>}
        {open && <PackageHotelPage hotel={detailHotel} prefs={prefs} destination={destination} calendar={calendar}
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
