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
import {matrixCellKey, matrixDates, matrixFirstNights, matrixNights, matrixViewForRoute, refreshedMatrixSelection} from './package-matrix.ts'
import {usePackageMatrix} from './package-matrix-query.ts'
import {useAgency} from './agency/AgencyProvider.tsx'
import {usePageVisible, useVisibleRefresh} from './visible-refresh.ts'
import {packageHotelId, type tPackageHotel} from './package-hotel.ts'
import {useMapDisplayPreferences} from './map-display-preferences.ts'
import {MapCardIcon} from './map-card-icons.tsx'
import {loadSelectedMapHotel, saveSelectedMapHotel, selectedMapHotelReference, type tSelectedMapHotel} from './package-map-selection.ts'

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
    const label = total == null ? undefined : price(total)
    return {
        id, name: marker.name, latitude: marker.latitude, longitude: marker.longitude,
        priceTotal: total, priceLabel: label, photo: marker.photo ?? null,
        tooltip: marker.name + ' · ' + (label ?? 'Цена ещё не подтверждена'),
    }
}

function insideMapBounds(point: MapProperty, bounds: tMapBounds | null) {
    if (!bounds) return true
    const longitude = point.longitude >= bounds[0] && point.longitude <= bounds[2]
    const latitude = point.latitude >= bounds[1] && point.latitude <= bounds[3]
    return longitude && latitude
}

function BrowsePackages({initial, destinations, initialHotelName, openHotel, route}: {
    initial: PackagePreferences, destinations: SupplyDestination[], initialHotelName: string, openHotel: boolean, route: TravelRoute,
}) {
    const initialBrowse = browseForRoute(route, pageSize)
    const [prefs, setPrefs] = useState({...initial, hotelId: initialBrowse.selection || initial.hotelId})
    const destination = destinations.find(d => d.id === prefs.destination) ?? destinations[0]
    const [knownPlaces, setKnownPlaces] = useState(destinations)
    const [bounds, setBounds] = useState<tMapBounds | null>(initialBrowse.bounds)
    const [camera, setCamera] = useState<tMapCamera | null>(() => cameraForRoute(route))
    const areaMode = 'map'
    const display = useMapDisplayPreferences()
    const {agency} = useAgency()
    const compactPriceMode = agency?.compactPriceMode ?? 'graph'
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [focusRevision, setFocusRevision] = useState(0)
    const favourites = usePackageFavourites()
    const [favouriteFilter, setFavouriteFilter] = useState<tFavouriteFilter>(() => {
        const value = route.query.get('favourite') ?? 'all'
        return Object.hasOwn(favouriteFilters, value) ? value as tFavouriteFilter : 'all'
    })
    const [open, setOpen] = useState<{hotelId: string, name: string} | null>(
        openHotel && initial.hotelId ? {hotelId: initial.hotelId, name: initialHotelName || 'Выбранный отель'} : null)
    const [priceView, setPriceView] = useState<'graph' | 'matrix'>(route.query.get('priceView') == 'matrix' ? 'matrix' : 'graph')
    const [matrixSelection, setMatrixSelection] = useState<PackageMatrixCell | null>(null)
    const [miniSnapshot, setMiniSnapshot] = useState<{context: string, cells: PackageMatrixCell[]}>({context: '', cells: []})
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
    const [rememberedHotel, setRememberedHotel] = useState<tSelectedMapHotel | null>(null)
    const [referenceReady, setReferenceReady] = useState(false)
    useEffect(() => {
        let active = true
        void loadSelectedMapHotel().then(function loaded(hotel) {
            if (!active) return
            setRememberedHotel(current => current ?? hotel)
            setReferenceReady(true)
        })
        return () => { active = false }
    }, [])
    const opener = useRef<HTMLElement | null>(null)
    const [snapshot, setSnapshot] = useState<{context: string, data: PackagePage} | null>(null)
    const tripContext = JSON.stringify({...packageQuery(prefs), minStars: prefs.minStars, areaMode})
    const visible = usePageVisible()
    const openedOrigin = openedIdentity && packageHotelId(openedIdentity) == prefs.hotelId ? openedIdentity.destinationId : undefined
    const rememberedOrigin = rememberedHotel?.id == prefs.hotelId ? rememberedHotel.destinationId : undefined
    const originToResolve = openedOrigin ?? rememberedOrigin ?? route.query.get('hotelDestination') ?? prefs.destination
    const resolvingOrigin = Boolean(open && !knownPlaces.some(place => place.id == originToResolve))
    const originQuery = useDirectoryQuery<{destinations: SupplyDestination[]}>(visible && resolvingOrigin
        ? directoryUrl('destinations', {id: originToResolve}) : null)
    const mapActive = visible && !open
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined, areaMode,
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
    useEffect(() => {
        const discovered = [...(latest?.area?.destinations ?? []), ...(originQuery.data?.destinations ?? [])]
        if (!discovered.length) return
        setKnownPlaces(current => {
            const places = new Map(current.map(place => [place.id, place]))
            discovered.forEach(place => places.set(place.id, place))
            if (places.size == current.length && discovered.every(place => current.includes(place))) return current
            return [...places.values()]
        })
    }, [latest?.area?.destinations, originQuery.data?.destinations])
    const updating = url != settledUrl || query.loading
    const error = url == settledUrl ? query.error : undefined
    const sourceUnavailable = latest?.source.status == 'unavailable'
    useVisibleRefresh({enabled: mapActive, busy: updating, retryAt: query.error ? undefined : sourceRetryAt, onRefresh: query.retry})
    useEffect(() => {
        if (latest && !latest.source.retryAt) setSnapshot({context: tripContext, data: latest})
    }, [latest, tripContext])
    const searchedIdentity = searchedHotel && packageHotelId(searchedHotel.hotel) == prefs.hotelId ? searchedHotel.hotel : undefined
    const openedSelection = openedIdentity && packageHotelId(openedIdentity) == prefs.hotelId ? openedIdentity : undefined
    const selectedCandidate = data?.items.find(item => item.hotelId == prefs.hotelId) ?? data?.markers.find(item => item.hotelId == prefs.hotelId)
        ?? data?.knownHotels?.find(item => item.id == prefs.hotelId) ?? searchedIdentity ?? openedSelection
    const selectedReference = selectedMapHotelReference(rememberedHotel, prefs.hotelId, selectedCandidate)
    const selectedHotel = selectedReference ? {...selectedCandidate, ...selectedReference} : selectedCandidate
    useEffect(() => {
        if (!referenceReady && !selectedCandidate) return
        setRememberedHotel(current => {
            const next = selectedMapHotelReference(current, prefs.hotelId, selectedCandidate)
            if (next != current) void saveSelectedMapHotel(next)
            return next
        })
    }, [referenceReady, prefs.hotelId, selectedCandidate])
    const requestedOrigin = selectedHotel?.destinationId ?? route.query.get('hotelDestination') ?? prefs.destination
    const resolvedDetailDestination = knownPlaces.find(place => place.id == requestedOrigin)
    const detailDestination = resolvedDetailDestination ?? destination
    const detailPrefs = {...prefs, destination: detailDestination.id}
    const miniContext = JSON.stringify({agencySlug: agency?.slug, agencyRevision: agency?.revision,
        hotelId: prefs.hotelId, destination: detailDestination.id, first: prefs.firstDeparture,
        last: prefs.lastDeparture, adults: prefs.adults, min: prefs.minTotal, max: prefs.maxTotal})
    const miniDates = matrixDates(prefs.firstDeparture, prefs.lastDeparture)
    const miniOffset = Math.min(matrixView.dateOffset, Math.max(0, miniDates.length - 3))
    const miniDepartures = miniDates.slice(miniOffset, miniOffset + 3)
    const miniNights = matrixNights(matrixFirstNights(prefs.nights))
    const selectedMapPoint = selectedCandidate && markerProperty(selectedCandidate)
    const selectedInView = selectedMapPoint && insideMapBounds(selectedMapPoint, bounds)
    const miniEnabled = Boolean(mapActive && compactPriceMode == 'matrix' && selectedInView && resolvedDetailDestination && !updating)
    const miniQuery = usePackageMatrix(detailPrefs, miniDepartures, miniNights, miniEnabled)
    useVisibleRefresh({enabled: miniEnabled, busy: miniQuery.loading, onRefresh: miniQuery.retry})
    function rememberMini(cells: PackageMatrixCell[]) {
        if (!cells.length) return
        setMiniSnapshot(current => {
            const previous = current.context == miniContext ? current.cells : []
            const merged = new Map(previous.map(cell => [matrixCellKey(cell.departure, cell.nights), cell]))
            if (cells.every(cell => merged.get(matrixCellKey(cell.departure, cell.nights)) == cell)) return current
            cells.forEach(cell => merged.set(matrixCellKey(cell.departure, cell.nights), cell))
            return {context: miniContext, cells: [...merged.values()].slice(-96)}
        })
    }
    const rememberMiniSnapshot = useEffectEvent(rememberMini)
    useEffect(() => { rememberMiniSnapshot(miniQuery.cells) }, [miniQuery.cells])
    const needsCalendar = priceView == 'graph' || !open && !matrixSelection
    const calendarUrl = visible && resolvedDetailDestination && prefs.hotelId && (open || prefs.fareId) && url == settledUrl && needsCalendar
        ? directoryUrl('package-calendar', {...packageQuery(detailPrefs), hotelId: prefs.hotelId}) : null
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
        ...packageQuery(prefs), minStars: prefs.minStars || undefined, areaMode, ...range,
    }) : null
    const trendsQuery = useDirectoryQuery<PackageTrends>(trendsUrl)
    const trends = useMemo(() => new Map(trendsQuery.data?.items.map(item => [item.hotelId, item.days]) ?? []), [trendsQuery.data])
    const matrixFare = matrixSelection?.inBudget?.id == prefs.fareId ? matrixSelection.inBudget : undefined
    const calendarFare = selectedPackageFare(calendar, prefs.fareId)
    const selectedFare = matrixFare ?? calendarFare
    const missingSelection = Boolean(prefs.fareId && !selectedFare && (calendar || unconfirmedFareId == prefs.fareId))
    const searchedSelection = searchedHotel?.context == tripContext ? searchedIdentity : undefined
    const selectedName = calendar?.hotel.name ?? selectedHotel?.name ?? initialHotelName ?? 'Выбранный отель'
    const points = useMemo(() => {
        const byId = new Map([...(data?.knownHotels ?? []), ...(data?.markers ?? [])].map(hotel => [packageHotelId(hotel), hotel] as const))
        const located = [...byId.values()].flatMap(hotel => {
            const point = markerProperty(hotel)
            return point ? [point] : []
        })
        function decorate(point: MapProperty) {
            const selected = point.id == prefs.hotelId && compactPriceMode == 'matrix'
            return {...point, trend: trends.get(point.id), favouriteLevel: favourites.levels[point.id] ?? 0,
                priceNights: prefs.nights, compactPriceMode,
                compactMatrix: selected ? {departures: miniDepartures, nights: miniNights,
                    cells: miniSnapshot.context == miniContext ? miniSnapshot.cells : [],
                    staleCellKeys: miniQuery.staleCellKeys, pending: miniQuery.loading} : undefined}
        }
        const markers = located.map(decorate)
        const selected = data?.items.find(item => item.hotelId === prefs.hotelId) ?? searchedSelection
        const selectedPoint = selected && markerProperty(selected)
        const selectedVisible = selectedPoint && insideMapBounds(selectedPoint, bounds)
        if (selectedPoint && selectedVisible && !markers.some(marker => marker.id == selectedPoint.id)) {
            markers.push(decorate(selectedPoint))
        }
        const point = markers.find(marker => marker.id == prefs.hotelId)
        if (point && selectedFare) {
            point.priceTotal = selectedFare.total
            point.priceLabel = price(selectedFare.total)
            point.tooltip = point.name + ' · вылет ' + dateLabel(selectedFare.departure) + ' · ' + price(selectedFare.total) + ' за группу'
        }
        if (point && missingSelection) {
            point.priceLabel = undefined
            point.priceTotal = undefined
            point.tooltip = point.name + ' · прежний тариф не найден. Выберите другой вылет на графике.'
        }
        if (favouriteFilter == 'all') return markers
        if (favouriteFilter == 'marked') return markers.filter(marker => marker.favouriteLevel > 0)
        return markers.filter(marker => marker.favouriteLevel == Number(favouriteFilter))
    }, [data, prefs.hotelId, prefs.nights, selectedFare, missingSelection, trends, favourites.levels, favouriteFilter,
        searchedSelection, bounds, compactPriceMode, miniSnapshot, miniContext, miniQuery.staleCellKeys, miniQuery.loading,
        miniDepartures.join(','), miniNights.join(',')])
    useEffect(() => { void savePackages(prefs) }, [prefs])
    function searchLink(detail = open, selected = prefs.hotelId, view = priceView) {
        const {destination, ...filters} = prefs
        const browse = browseFields({bounds, offset: 0, selection: selected, view: 'map'})
        return travelHash('packages', destination, {...filters, ...browse,
            areaMode, hotelDestination: selected ? requestedOrigin : undefined,
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
        setOpenedIdentity(hotel)
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
        setCamera({latitude: hotel.latitude, longitude: hotel.longitude, zoom: 15.5})
        setFocusRevision(value => value + 1)
    }
    function matrixSnapshot(cells: PackageMatrixCell[], failedCellKeys: string[]) {
        rememberMini(cells)
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
        setFocusRevision(value => value + 1)
        setOpen(null)
    }
    function navigateRegion(id: string) {
        const place = knownPlaces.find(item => item.id == id)
        if (!place) return
        setOpen(null)
        setMatrixSelection(null)
        setUnconfirmedFareId('')
        setBounds(null)
        setCamera({latitude: place.latitude, longitude: place.longitude, zoom: 12})
        setPrefs(current => ({...current, destination: id, hotelId: '', fareId: ''}))
    }
    const detailHotel = calendar?.hotel ?? selectedHotel ?? {
        id: open?.hotelId ?? prefs.hotelId, name: open?.name ?? selectedName, stars: null,
        latitude: null, longitude: null, url: '',
    }
    const mapDestination = data?.area?.destinations.find(place => {
        if (!camera) return place.id == destination.id
        return data.area?.destinations.every(other => {
            const current = Math.hypot(place.latitude - camera.latitude, place.longitude - camera.longitude)
            const alternative = Math.hypot(other.latitude - camera.latitude, other.longitude - camera.longitude)
            return current <= alternative
        })
    }) ?? destination
    return <main className="package-map-page" id="packages">
        <div className="package-map-stage">
            <DirectoryMap destination={mapDestination} hotels={points} selectedId={prefs.hotelId || null}
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
                onRefresh={query.refresh} showLabels={display.showLabels} focusKey={focusRevision}
                onSearchArea={searchArea} bounds={bounds}
                detailedByDefault loading={updating} immersive/>
        </div>
        <HotelQuickSearch prefs={prefs} destination={destination} value={hotelSearch} onValue={setHotelSearch}
            bounds={bounds} areaMode={areaMode}
            expanded={searchExpanded} onExpanded={setSearchExpanded} offset={searchOffset} onOffset={setSearchOffset}
            suspended={Boolean(open)} onLocate={locateSearchHotel}
            onOpen={(hotel, view, trigger) => {
                setSearchedHotel({hotel, context: tripContext})
                show(hotel, view, trigger)
            }}/>
        <PackageFilters prefs={prefs} destinations={knownPlaces} onChange={change} onNavigate={navigateRegion} immersive/>
        <div className="package-map-toolbar">
            <div className="package-map-status" aria-live="polite" aria-busy={updating}>
                <strong>В области карты</strong>
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
            <button type="button" disabled={updating} onClick={query.refresh} title="Заново запросить цены видимых отелей"
                aria-label="Обновить цены в области карты"><MapCardIcon name="refresh"/>{display.showLabels && 'Цены'}</button>
            <select className="package-map-favourite-filter" aria-label="Показать избранные отели" value={favouriteFilter}
                onChange={event => setFavouriteFilter(event.target.value as tFavouriteFilter)}>
                {Object.entries(favouriteFilters).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {selectedHotel && <button type="button" onClick={locateHotel} disabled={selectedHotel.latitude == null || selectedHotel.longitude == null}
                title={'Показать выбранный отель · ' + selectedName} aria-label={'Показать выбранный отель · ' + selectedName}>
                <MapCardIcon name="locate"/>{display.showLabels && 'Выбранный отель'}</button>}
            <button type="button" title="Настройки карты" aria-label="Настройки карты" aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(value => !value)}><MapCardIcon name="settings"/>{display.showLabels && 'Настройки'}</button>
            {settingsOpen && <section className="map-display-settings" aria-label="Настройки отображения карты">
                <label><input type="checkbox" checked={display.showLabels} onChange={event => void display.setShowLabels(event.target.checked)}/>
                    Подписи кнопок</label>
                <p>Короткие подсказки доступны при наведении и с клавиатуры.</p>
            </section>}
            {data?.area?.description && <span className="package-map-coverage" title={data.area.description}>
                {data.area.coverage == 'unsupported' ? 'Для этой области пока нет подключённого источника' : data.area.description}</span>}
        </div>
        {error && !data && <p className="package-map-error" role="status">{error}</p>}
        {favourites.temporary && <p className="package-map-storage-notice" role="status">Отметки сохраняются до закрытия вкладки.</p>}
        {open && !resolvedDetailDestination && <section className="package-map-origin-loading" role="status">
            <span>{originQuery.error ?? (originQuery.data?.destinations.length == 0
                ? 'Регион выбранного отеля пока не подключён.' : 'Подключаем регион выбранного отеля…')}</span>
            <button type="button" onClick={() => dismissTravelDetail(() => setOpen(null))}>Вернуться к карте</button>
        </section>}
        {open && resolvedDetailDestination && priceView == 'matrix' && <PackageMatrixPopup
            hotel={detailHotel} prefs={detailPrefs} destination={detailDestination}
            selectedFare={selectedFare} selectionSource={matrixFare ? matrixSelection?.source : calendar?.source}
            selectionCheckedAt={matrixFare ? matrixSelection?.checkedAt : undefined} view={matrixView}
            onView={patch => setMatrixView(current => ({...current, ...patch}))} onSelect={selectMatrixFare} onSnapshot={matrixSnapshot}
            onChange={changeMatrixTrip} onClose={() => dismissTravelDetail(() => setOpen(null))} onRestoreFocus={focusOpener}
            onHotel={() => setPriceView('graph')} onLocate={locateHotel} favouriteLevel={favourites.levels[open.hotelId] ?? 0}
            onFavourite={level => favourites.setLevel(open.hotelId, level)}/>}
        {open && resolvedDetailDestination && priceView == 'graph' && <PackageHotelPage
            hotel={detailHotel} prefs={detailPrefs} destination={detailDestination} calendar={calendar}
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
