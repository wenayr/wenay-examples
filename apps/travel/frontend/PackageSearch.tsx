import {useCallback, useEffect, useEffectEvent, useMemo, useRef, useState} from 'react'
import type {PackageCalendar, PackageHotel, PackagePage, PackageSummary} from '../src/package-contract.ts'
import type {PackageMapHotels} from '../src/package-area-contract.ts'
import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import type {PackageTrends} from '../src/package-trends-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {DirectoryMap, type MapProperty, type tMapBounds, type tMapCamera} from './DirectoryMap.tsx'
import {directoryUrl, useDirectoryQuery, useDirectoryTransport} from './directory-query.ts'
import {dateLabel, hotelCount} from './presentation.ts'
import {loadPackages, packageQuery, savePackages, supportsPackage, usualBudget, type PackagePreferences} from './package-preferences.ts'
import {PackageFilters} from './PackageFilters.tsx'
import {PackageHotelPage} from './PackageHotelPage.tsx'
import {hotelCalendarRequired, hotelSectionForRoute, type tHotelPageSection} from './hotel-page-entry.ts'
import {HotelQuickSearch} from './HotelQuickSearch.tsx'
import {usePackageFavourites} from './package-favourites.ts'
import {selectedPackageFare} from './package-selection.ts'
import {browseFields, browseForRoute, dismissTravelDetail, openTravelDetail, packagesForRoute, replaceTravelHash, travelHash, travelRoute, type TravelRoute} from './navigation.ts'
import './package-map.css'
import {cameraForRoute} from './map-camera.ts'
import {matrixCellKey, matrixMinimum, matrixOverview, matrixSnapshotCells, matrixViewForRoute, refreshedMatrixSelection} from './package-matrix.ts'
import {usePackageMatrix} from './package-matrix-query.ts'
import {useAgency} from './agency/AgencyProvider.tsx'
import {usePageVisible} from './visible-refresh.ts'
import {hotelsInMapArea, insideMapBounds, mapPriceStatus, packageHotelId, type tPackageHotel} from './package-hotel.ts'
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
        photos: 'photos' in marker ? marker.photos : undefined,
        propertyUrl: 'url' in marker ? marker.url : undefined,
        tooltip: marker.name + ' · ' + (label ?? 'Цена ещё не подтверждена'),
    }
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
    const compactPriceMode = agency?.compactPriceMode ?? 'matrix'
    const [visiblePhotoIds, setVisiblePhotoIds] = useState<readonly string[]>([])
    const visiblePhotos = useCallback(function visiblePhotos(ids: readonly string[]) {
        setVisiblePhotoIds(current => {
            if (current.length == ids.length && ids.every(id => current.includes(id))) return current
            return [...ids]
        })
    }, [])
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [focusRevision, setFocusRevision] = useState(0)
    const favourites = usePackageFavourites()
    const [favouriteFilter, setFavouriteFilter] = useState<tFavouriteFilter>(() => {
        const value = route.query.get('favourite') ?? 'all'
        return Object.hasOwn(favouriteFilters, value) ? value as tFavouriteFilter : 'all'
    })
    const [open, setOpen] = useState<{hotelId: string, name: string} | null>(
        openHotel && initial.hotelId ? {hotelId: initial.hotelId, name: initialHotelName || 'Выбранный отель'} : null)
    const [priceView, setPriceView] = useState<'graph' | 'matrix'>(route.query.get('priceView') == 'graph' ? 'graph' : 'matrix')
    const [hotelSection, setHotelSection] = useState(() => hotelSectionForRoute(route.query))
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
    const tripContext = JSON.stringify([agency?.slug, agency?.revision, packageQuery(prefs), prefs.minStars, areaMode])
    const visible = usePageVisible()
    const transport = useDirectoryTransport()
    const liveMode = transport.mode == 'sse' ? 'live' : transport.mode.replace('http-', '')
    const openedOrigin = openedIdentity && packageHotelId(openedIdentity) == prefs.hotelId ? openedIdentity.destinationId : undefined
    const rememberedOrigin = rememberedHotel?.id == prefs.hotelId ? rememberedHotel.destinationId : undefined
    const originToResolve = openedOrigin ?? rememberedOrigin ?? route.query.get('hotelDestination') ?? prefs.destination
    const resolvingOrigin = Boolean(open && !knownPlaces.some(place => place.id == originToResolve))
    const originQuery = useDirectoryQuery<{destinations: SupplyDestination[]}>(visible && resolvingOrigin
        ? directoryUrl('destinations', {id: originToResolve}) : null)
    const mapActive = visible && !open
    const range = bounds && {west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3]}
    const catalogParams = {destination: prefs.destination, minStars: prefs.minStars || undefined}
    const catalogScope = directoryUrl('package-map-hotels', catalogParams)
    const catalogUrl = directoryUrl('package-map-hotels', {...catalogParams, ...range})
    const catalog = useDirectoryQuery<PackageMapHotels>(mapActive && bounds ? catalogUrl : null)
    const [lastCatalog, setLastCatalog] = useState<{scope: string, page: PackageMapHotels} | null>(null)
    useEffect(() => {
        if (catalog.data) setLastCatalog({scope: catalogScope, page: catalog.data})
    }, [catalogScope, catalog.data])
    const url = directoryUrl('packages', {...packageQuery(prefs), minStars: prefs.minStars || undefined, areaMode,
        limit: 100, ...range})
    const [settledUrl, setSettledUrl] = useState(url)
    useEffect(() => {
        if (url === settledUrl) return
        const timer = setTimeout(() => setSettledUrl(url), 250)
        return () => clearTimeout(timer)
    }, [url, settledUrl])
    const query = useDirectoryQuery<PackagePage>(mapActive && bounds && url == settledUrl ? url : null)
    const data = query.data
    const area = catalog.data?.area ?? data?.area
    // During a pan only coordinates still inside the new bounds can bridge the next catalog read.
    const previousHotels = lastCatalog?.scope == catalogScope ? lastCatalog.page.knownHotels : undefined
    const catalogHotels = catalog.data?.knownHotels ?? previousHotels
    const mapHotels = useMemo(() => hotelsInMapArea(catalogHotels ?? [], data, bounds), [catalogHotels, data, bounds])
    useEffect(() => {
        const discovered = [...(area?.destinations ?? []), ...(originQuery.data?.destinations ?? [])]
        if (!discovered.length) return
        setKnownPlaces(current => {
            const places = new Map(current.map(place => [place.id, place]))
            discovered.forEach(place => places.set(place.id, place))
            if (places.size == current.length && discovered.every(place => current.includes(place))) return current
            return [...places.values()]
        })
    }, [area?.destinations, originQuery.data?.destinations])
    const updating = mapActive && (!bounds || url != settledUrl || query.loading)
    const loadingHotels = mapActive && (!bounds || catalog.loading) && !catalog.data && !data && !mapHotels.size
    const searchedIdentity = searchedHotel && packageHotelId(searchedHotel.hotel) == prefs.hotelId ? searchedHotel.hotel : undefined
    const openedSelection = openedIdentity && packageHotelId(openedIdentity) == prefs.hotelId ? openedIdentity : undefined
    const selectedCandidate = data?.items.find(item => item.hotelId == prefs.hotelId) ?? mapHotels.get(prefs.hotelId) ?? searchedIdentity ?? openedSelection
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
    const miniAxes = matrixOverview(prefs.firstDeparture, prefs.lastDeparture, matrixView)
    const miniDepartures = miniAxes.departures
    const miniNights = miniAxes.nights
    const selectedMapPoint = selectedCandidate && markerProperty(selectedCandidate)
    const selectedInView = selectedMapPoint && insideMapBounds(selectedMapPoint, bounds)
    const selectedCardVisible = selectedInView && visiblePhotoIds.includes(prefs.hotelId)
    const miniEnabled = Boolean(mapActive && compactPriceMode == 'matrix' && selectedCardVisible && resolvedDetailDestination && url == settledUrl)
    const miniQuery = usePackageMatrix(detailPrefs, miniDepartures, miniNights, miniEnabled)
    function rememberMini(cells: PackageMatrixCell[]) {
        if (!cells.length) return
        setMiniSnapshot(current => {
            const previous = current.context == miniContext ? current.cells : []
            const merged = new Map(previous.map(cell => [matrixCellKey(cell.departure, cell.nights), cell]))
            if (cells.every(cell => merged.get(matrixCellKey(cell.departure, cell.nights)) == cell)) return current
            cells.forEach(cell => merged.set(matrixCellKey(cell.departure, cell.nights), cell))
            return {context: miniContext, cells: [...merged.values()].slice(-matrixSnapshotCells)}
        })
    }
    const rememberMiniSnapshot = useEffectEvent(rememberMini)
    useEffect(() => { rememberMiniSnapshot(miniQuery.cells) }, [miniQuery.cells])
    const needsCalendar = hotelCalendarRequired(priceView, prefs.fareId, matrixSelection?.inBudget?.id)
    const calendarUrl = visible && resolvedDetailDestination && prefs.hotelId && (open || prefs.fareId) && url == settledUrl && needsCalendar
        ? directoryUrl('package-calendar', {...packageQuery(detailPrefs), hotelId: prefs.hotelId}) : null
    const calendarQuery = useDirectoryQuery<PackageCalendar>(calendarUrl)
    const calendar = calendarQuery.data
    useEffect(() => {
        if (!calendar) return
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
    const trendsUrl = mapActive && data?.markers.length ? directoryUrl('package-trends', {
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
        const located = [...mapHotels.values()].flatMap(hotel => {
            const point = markerProperty(hotel)
            return point ? [point] : []
        })
        function decorate(point: MapProperty) {
            const selected = point.id == prefs.hotelId && compactPriceMode == 'matrix'
            return {...point, trend: trends.get(point.id), favouriteLevel: favourites.levels[point.id] ?? 0,
                priceNights: prefs.nights, compactPriceMode,
                compactMatrix: {departures: miniDepartures, nights: miniNights,
                    cells: selected && miniSnapshot.context == miniContext ? miniSnapshot.cells : [],
                    staleCellKeys: selected ? miniQuery.staleCellKeys : [], pending: selected && miniQuery.loading}}
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
        const needsMiniPrice = point && point.priceTotal == null && !prefs.fareId && !selectedFare && !missingSelection
        if (needsMiniPrice) {
            const cells = miniSnapshot.context == miniContext ? miniSnapshot.cells : []
            const fare = matrixMinimum(cells, prefs, {staleCellKeys: miniQuery.staleCellKeys})
            if (fare) {
                point.priceTotal = fare.total
                point.priceLabel = price(fare.total)
                const checked = new Date(fare.checkedAt).toLocaleString('ru-RU')
                point.tooltip = point.name + ' · вылет ' + dateLabel(fare.departure) + ' · ' + price(fare.total) + ' за группу · проверено ' + checked
            }
        }
        if (point && missingSelection) {
            point.priceLabel = undefined
            point.priceTotal = undefined
            point.tooltip = point.name + ' · прежний тариф не найден. Выберите другой вылет на графике.'
        }
        if (favouriteFilter == 'all') return markers
        if (favouriteFilter == 'marked') return markers.filter(marker => marker.favouriteLevel > 0)
        return markers.filter(marker => marker.favouriteLevel == Number(favouriteFilter))
    }, [data, mapHotels, prefs.hotelId, prefs.nights, prefs.fareId, selectedFare, missingSelection, trends, favourites.levels, favouriteFilter,
        searchedSelection, bounds, compactPriceMode, miniSnapshot, miniContext, miniQuery.staleCellKeys, miniQuery.loading,
        miniDepartures.join(','), miniNights.join(',')])
    useEffect(() => { void savePackages(prefs) }, [prefs])
    function searchLink(detail = open, selected = prefs.hotelId, view = priceView, section = hotelSection) {
        const {destination, ...filters} = prefs
        const browse = browseFields({bounds, offset: 0, selection: selected, view: 'map'})
        return travelHash('packages', destination, {...filters, ...browse,
            areaMode, hotelDestination: selected ? requestedOrigin : undefined,
            mapLat: camera?.latitude, mapLon: camera?.longitude, mapZoom: camera?.zoom,
            fareId: selected == prefs.hotelId ? prefs.fareId : undefined,
            hotelId: detail?.hotelId, hotelName: detail?.name, hotelView: detail ? '1' : undefined,
            priceView: detail && view == 'graph' ? 'graph' : undefined,
            hotelSection: detail ? section : undefined,
            matrixFrom: matrixView.firstNights, matrixTo: matrixView.lastNights,
            matrixRow: matrixView.durationOffset, matrixDate: matrixView.dateOffset,
            hotelSearch: hotelSearch || undefined, hotelSearchOpen: searchExpanded ? '1' : undefined,
            hotelSearchOffset: searchOffset || undefined,
            favourite: favouriteFilter == 'all' ? undefined : favouriteFilter})
    }
    useEffect(() => {
        replaceTravelHash(searchLink())
    }, [prefs, bounds, camera, open, favouriteFilter, priceView, hotelSection, matrixView, hotelSearch, searchExpanded, searchOffset])
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
        return data?.items.find(item => item.hotelId == id) ?? mapHotels.get(id)
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
        const section: tHotelPageSection = view == 'matrix' ? 'matrix' : 'gallery'
        setPriceView('matrix')
        setHotelSection(section)
        if (hotelId != prefs.hotelId) {
            setMatrixSelection(null)
            setUnconfirmedFareId('')
        }
        replaceTravelHash(searchLink(null, hotelId))
        openTravelDetail(searchLink(detail, hotelId, 'matrix', section))
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
    function locateMapHotel(hotel: tPackageHotel) {
        if (hotel.latitude == null || hotel.longitude == null) return
        selectHotel(hotel)
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
        dismissTravelDetail(() => setOpen(null))
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
    const mapDestination = camera ? knownPlaces.reduce((nearest, place) => {
        const distance = (point: SupplyDestination) => Math.hypot(point.latitude - camera.latitude, point.longitude - camera.longitude)
        return distance(place) < distance(nearest) ? place : nearest
    }, destination) : destination
    const hasCatalogResult = Boolean(catalog.data || data || mapHotels.size)
    const hasHotels = points.length > 0
    const narrowedBudget = prefs.minTotal > 0 || prefs.maxTotal < usualBudget
    const inBudget = points.filter(({priceTotal}) => priceTotal != null && priceTotal >= prefs.minTotal && priceTotal <= prefs.maxTotal).length
    const unsupported = area?.coverage == 'unsupported'
    const prices = mapPriceStatus(points, data, updating, query.error)
    return <main className="package-map-page" id="packages" data-live-transport={liveMode}
        data-live-epoch={transport.epoch} data-live-resets={transport.resets} data-live-profile={transport.profile}>
        <div className="package-map-stage">
            <DirectoryMap destination={mapDestination} hotels={points} selectedId={prefs.hotelId || null} onPhotoCards={visiblePhotos}
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
                onLocate={id => {
                    const hotel = findHotel(id)
                    if (hotel) locateMapHotel(hotel)
                }}
                onFavourite={favourites.setLevel} camera={camera} onCamera={setCamera}
                onRefresh={query.refresh} showLabels={display.showLabels} focusKey={focusRevision}
                onSearchArea={searchArea} bounds={bounds}
                detailedByDefault loading={loadingHotels} immersive/>
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
            <div className="package-map-status" aria-live="polite" aria-busy={loadingHotels}>
                <strong>В области карты</strong>
                {hasCatalogResult && <span>{favouriteFilter == 'all' ? hotelCount(points.length) : 'С отметками · ' + points.length}</span>}
                {hasHotels && narrowedBudget && <span>С ценой в бюджете · {inBudget}</span>}
                {loadingHotels && <span>Загружаем отели…</span>}
                {liveMode == 'offline' && <span>Нет связи</span>}
                {prices && !(narrowedBudget && inBudget) && <span>{prices.label}</span>}
                {prices?.savedAt && <span>Сохранённый снимок от{' '}
                    <time dateTime={prices.savedAt}>{new Date(prices.savedAt).toLocaleString('ru-RU')}</time></span>}
                {!hasCatalogResult && catalog.error && <button type="button" onClick={catalog.retry}>Загрузить отели повторно</button>}
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
            {unsupported && !hasHotels && <span className="package-map-coverage">В этом районе пока нет отелей в каталоге</span>}
        </div>
        {favourites.temporary && <p className="package-map-storage-notice" role="status">Отметки сохраняются до закрытия вкладки.</p>}
        {open && !resolvedDetailDestination && <section className="package-map-origin-loading" role="status">
            <span>{originQuery.error ?? (originQuery.data?.destinations.length == 0
                ? 'Регион выбранного отеля пока не подключён.' : 'Подключаем регион выбранного отеля…')}</span>
            <button type="button" onClick={() => dismissTravelDetail(() => setOpen(null))}>Вернуться к карте</button>
        </section>}
        {open && resolvedDetailDestination && <PackageHotelPage
            hotel={detailHotel} prefs={detailPrefs} destination={detailDestination} calendar={calendar}
            selectedFare={selectedFare} error={calendarQuery.error} loading={calendarQuery.loading}
            onRetry={calendarQuery.retry} onFare={fareId => {
                setMatrixSelection(null)
                setUnconfirmedFareId('')
                setPrefs(current => ({...current, fareId}))
            }}
            onClose={() => dismissTravelDetail(() => setOpen(null))} onLocate={locateHotel} onRestoreFocus={focusOpener}
            onChange={changeMatrixTrip} entrySection={hotelSection} onSection={setHotelSection}
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
