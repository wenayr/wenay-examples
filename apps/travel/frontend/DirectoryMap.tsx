import {useEffect, useEffectEvent, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import * as L from 'leaflet'
import type {GeoJsonObject} from 'geojson'
import {destinations} from '../demo/catalog.ts'
import type {SupplyDestination, SupplyHotel, SupplyPhoto} from '../src/supply-contract.ts'
import type {PackageTrendPoint} from '../src/package-trends-contract.ts'
import {drawAtlas, fitHotelPoints, overlap, type CardBox} from './HotelMap.tsx'
import {Icon} from './Icons.tsx'
import {mapClusters} from './map-clusters.ts'
import {packageFavouriteLevels, type tPackageFavouriteLevel} from './package-favourites.ts'
import {MapPhoto} from './MapPhoto.tsx'

export type tMapBounds = readonly [west: number, south: number, east: number, north: number]

export type MapProperty = Pick<SupplyHotel, 'id' | 'name' | 'latitude' | 'longitude'> & {
    priceLabel?: string
    priceTotal?: number
    tooltip?: string
    trend?: readonly PackageTrendPoint[]
    photo?: SupplyPhoto | null
    photos?: readonly SupplyPhoto[]
    propertyUrl?: string
    favouriteLevel?: tPackageFavouriteLevel
}
export interface tMapCamera {
    latitude: number
    longitude: number
    zoom: number
}
interface MapPhotoMount {hotel: MapProperty, host: HTMLElement}
interface DirectoryMapProps {
    destination: SupplyDestination
    hotels: readonly MapProperty[]
    selectedId: string | null
    onSelect: (id: string) => void
    onSearchArea: (bounds: tMapBounds) => void
    world?: boolean
    bounds?: tMapBounds | null
    onShowAll?: () => void
    fitAllKey?: number | string
    detailedByDefault?: boolean
    loading?: boolean
    immersive?: boolean
    onOpen?: (id: string) => void
    onMatrix?: (id: string) => void
    onFavourite?: (id: string, level: tPackageFavouriteLevel) => void
    camera?: tMapCamera | null
    onCamera?: (camera: tMapCamera) => void
}

// Natural Earth 1:10m land (world-atlas 2.0.2), roads and urban areas. Each local GeoJSON
// is clipped to its destination plus a margin, simplified, and loaded only when selected.
const areaMaps = import.meta.glob<GeoJsonObject>('./atlas/*.json', {import: 'default'})
const mapColors = {
    land: {color: '#96a99a', weight: 1, fillColor: '#e4e6d4', fillOpacity: 1},
    urban: {stroke: false, fillColor: '#cec8af', fillOpacity: 0.68},
    roads: {color: '#b7a17b', weight: 1.5},
} as const

function addBase(map: L.Map, id: string, onLimited: () => void) {
    const group = L.layerGroup().addTo(map)
    if (Object.hasOwn(destinations, id)) {
        group.addLayer(drawAtlas(map, id as keyof typeof destinations))
    } else {
        const load = areaMaps['./atlas/' + id + '.json']
        if (load) {
            void load().then(function addFeatures(geometry) {
                if (!map.hasLayer(group)) return
                L.geoJSON(geometry, {pane: 'atlas', interactive: false, style: function style(feature) {
                    const layer = feature?.properties?.layer
                    if (layer == 'urban') return mapColors.urban
                    if (layer == 'roads') return mapColors.roads
                    return mapColors.land
                }}).addTo(group)
            }).catch(() => { if (map.hasLayer(group)) onLimited() })
        } else onLimited()
    }
    return group
}

function accessibleMarker(marker: L.Marker, label: string, count: number, ids: readonly string[], activate: () => void) {
    const node = marker.getElement()
    node?.setAttribute('aria-label', label)
    node?.setAttribute('data-hotel-count', String(count))
    node?.setAttribute('data-hotel-ids', JSON.stringify(ids))
    node?.addEventListener('keydown', function activateWithSpace(event) {
        if (![' ', 'Enter'].includes(event.key) || event.target != node) return
        event.preventDefault()
        event.stopPropagation()
        activate()
    })
}

const trendMoney = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const svgNamespace = 'http://www.w3.org/2000/svg'

function priceTrend(days: readonly PackageTrendPoint[]) {
    const graph = document.createElementNS(svgNamespace, 'svg')
    graph.setAttribute('viewBox', '0 0 112 18')
    graph.setAttribute('class', 'directory-pin-trend')
    graph.setAttribute('aria-hidden', 'true')
    const quoted = days.filter(day => day.status == 'quoted').map(day => day.total)
    const amounts = quoted.filter((value): value is number => value != null)
    const low = amounts.length ? Math.min(...amounts) : 0
    const high = amounts.length ? Math.max(...amounts) : 0
    const path = document.createElementNS(svgNamespace, 'path')
    let connected = false
    let shape = ''
    days.forEach((day, index) => {
        const x = 3 + index / Math.max(1, days.length - 1) * 106
        const title = document.createElementNS(svgNamespace, 'title')
        title.textContent = day.departure + ' · '
        if (day.total == null || day.status != 'quoted') {
            connected = false
            title.textContent += day.status == 'unknown' ? 'не проверено' : 'цена не получена'
            const gap = document.createElementNS(svgNamespace, 'text')
            gap.setAttribute('x', String(x))
            gap.setAttribute('y', '14')
            gap.textContent = day.status == 'unknown' ? '?' : '–'
            gap.append(title)
            graph.append(gap)
            return
        }
        const y = high == low ? 8 : 14 - 11 * (day.total - low) / (high - low)
        shape += (connected ? ' L ' : ' M ') + x.toFixed(2) + ' ' + y.toFixed(2)
        connected = true
        title.textContent += trendMoney.format(day.total / 100)
        const dot = document.createElementNS(svgNamespace, 'circle')
        dot.setAttribute('cx', String(x))
        dot.setAttribute('cy', String(y))
        dot.setAttribute('r', '2.4')
        dot.append(title)
        graph.append(dot)
    })
    path.setAttribute('d', shape)
    graph.prepend(path)
    return graph
}

function favouriteControls(hotel: MapProperty, change: (level: tPackageFavouriteLevel) => void) {
    const controls = document.createElement('div')
    controls.className = 'map-hotel-card__favorites'
    controls.setAttribute('aria-label', 'Уровень избранного')
    controls.addEventListener('keydown', function keepFavouriteControl(event) {
        if (event.key == 'Enter' || event.key == ' ') event.stopPropagation()
    })
    const symbols = {1: '●', 2: '♥', 3: '⚑'} as const
    const levels = [1, 2, 3] as const
    levels.forEach(level => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'map-hotel-card__favorite'
        button.dataset.level = String(level)
        button.textContent = symbols[level]
        button.style.setProperty('--hotel-favourite-color', packageFavouriteLevels[level].color)
        button.title = packageFavouriteLevels[level].label
        button.setAttribute('aria-label', packageFavouriteLevels[level].label + ' · ' + hotel.name)
        button.setAttribute('aria-pressed', String(hotel.favouriteLevel == level))
        button.addEventListener('click', function changeFavourite(event) {
            event.stopPropagation()
            change(hotel.favouriteLevel == level ? 0 : level)
        })
        controls.append(button)
    })
    L.DomEvent.disableClickPropagation(controls)
    return controls
}

function mapPropertyLabel(hotel: MapProperty) {
    const parts = [hotel.name]
    if (hotel.priceLabel) parts.push(hotel.priceLabel + ' за группу')
    const quoted = hotel.trend?.filter(day => day.status == 'quoted' && day.total != null) ?? []
    const amounts = quoted.map(day => day.total as number)
    if (amounts.length) {
        const low = Math.min(...amounts)
        const high = Math.max(...amounts)
        let range = trendMoney.format(low / 100)
        if (high != low) range += ' — ' + trendMoney.format(high / 100)
        parts.push('Дневные минимумы в бюджете ' + range)
    }
    if (hotel.favouriteLevel) parts.push(packageFavouriteLevels[hotel.favouriteLevel].label)
    return parts.join('. ')
}

function photoCard(hotel: MapProperty, photoHost: HTMLElement, open: () => void,
    favourite?: (level: tPackageFavouriteLevel) => void, matrix?: () => void) {
    const card = document.createElement('article')
    card.className = 'map-hotel-card'
    card.dataset.favouriteLevel = String(hotel.favouriteLevel ?? 0)
    card.style.setProperty('--hotel-favourite-color', packageFavouriteLevels[hotel.favouriteLevel ?? 0].color)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'map-hotel-card__open'
    button.setAttribute('aria-label', 'Открыть ' + mapPropertyLabel(hotel))
    const body = document.createElement('div')
    body.className = 'map-hotel-card__body'
    const name = document.createElement('strong')
    name.className = 'map-hotel-card__name'
    name.textContent = hotel.name
    body.append(name)
    if (hotel.trend?.length) {
        const graph = priceTrend(hotel.trend)
        graph.classList.add('map-hotel-card__trend')
        body.append(graph)
    } else {
        const pending = document.createElement('span')
        pending.className = 'map-hotel-card__trend is-empty'
        pending.textContent = 'Даты уточняются'
        body.append(pending)
    }
    const amount = document.createElement('b')
    amount.className = 'map-hotel-card__price'
    amount.textContent = hotel.priceLabel ?? 'Открыть отель'
    body.append(amount)
    button.append(body)
    button.addEventListener('click', function openHotel(event) {
        event.stopPropagation()
        open()
    })
    L.DomEvent.disableClickPropagation(button)
    card.append(photoHost, button)
    const controls = document.createElement('div')
    controls.className = 'map-hotel-card__actions'
    if (favourite) controls.append(favouriteControls(hotel, favourite))
    if (matrix) {
        const action = document.createElement('button')
        action.type = 'button'
        action.className = 'map-hotel-card__matrix'
        action.textContent = 'Матрица'
        action.setAttribute('aria-label', 'Матрица цен · ' + hotel.name)
        let touch: {id: number, x: number, y: number, moved: boolean} | null = null
        let handledTouchAt = -Infinity
        action.addEventListener('pointerdown', function startMatrixTouch(event) {
            if (event.pointerType != 'touch' || !event.isPrimary || event.button != 0) return
            touch = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false}
            action.setPointerCapture(event.pointerId)
        })
        action.addEventListener('pointermove', function moveMatrixTouch(event) {
            if (!touch || touch.id != event.pointerId) return
            if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) touch.moved = true
        })
        action.addEventListener('pointerup', function finishMatrixTouch(event) {
            if (!touch || touch.id != event.pointerId) return
            const moved = touch.moved || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10
            touch = null
            handledTouchAt = performance.now()
            event.preventDefault()
            event.stopPropagation()
            if (!moved) matrix()
        })
        action.addEventListener('pointercancel', function cancelMatrixTouch() {
            touch = null
            handledTouchAt = performance.now()
        })
        action.addEventListener('click', function openMatrix(event: MouseEvent) {
            event.stopPropagation()
            const touchClick = event instanceof PointerEvent ? event.pointerType == 'touch' : event.detail > 0
            if (touchClick && performance.now() - handledTouchAt < 700) {
                event.preventDefault()
                return
            }
            matrix()
        })
        controls.append(action)
    }
    card.append(controls)
    L.DomEvent.disableClickPropagation(card)
    card.addEventListener('pointerdown', event => event.stopPropagation())
    card.addEventListener('keydown', function keepCardControl(event) {
        event.stopPropagation()
    })
    return card
}

function addProperty(group: L.LayerGroup, hotel: MapProperty, index: number, select: () => void,
    photoHost?: HTMLElement, favourite?: (level: tPackageFavouriteLevel) => void, compact = false, matrix?: () => void) {
    if (photoHost) {
        const card = photoCard(hotel, photoHost, select, favourite, matrix)
        const icon = L.divIcon({className: 'directory-map-pin is-rich-card', html: card,
            iconSize: [190, 244], iconAnchor: [95, 122]})
        const marker = L.marker([hotel.latitude, hotel.longitude], {
            icon, keyboard: true, autoPanOnFocus: false, bubblingMouseEvents: false,
        }).on('click', select).addTo(group)
        accessibleMarker(marker, mapPropertyLabel(hotel), 1, [hotel.id], select)
        marker.getElement()?.setAttribute('role', 'group')
        marker.getElement()?.removeAttribute('tabindex')
        return marker
    }
    const label = document.createElement('span')
    label.className = 'directory-map-number' + (hotel.priceLabel ? ' package-map-price' : '')
    label.dataset.favouriteLevel = String(hotel.favouriteLevel ?? 0)
    label.style.setProperty('--hotel-favourite-color', packageFavouriteLevels[hotel.favouriteLevel ?? 0].color)
    const trend = hotel.trend ?? []
    const multipleDays = Boolean(hotel.priceLabel && trend.length > 1)
    let width = hotel.priceLabel ? 128 : 40
    let height = hotel.priceLabel ? 52 : 40
    if (compact && hotel.priceLabel) {
        width = 112
        height = 44
    }
    if (hotel.priceLabel) {
        const name = document.createElement('span')
        name.className = 'directory-pin-name'
        name.textContent = hotel.name
        const amount = document.createElement('strong')
        amount.textContent = hotel.priceLabel
        if (!compact) label.append(name)
        if (multipleDays) {
            const totals = trend.filter(day => day.status == 'quoted').map(day => day.total)
            const quoted = totals.filter((value): value is number => value != null)
            label.classList.add('has-trend')
            label.append(priceTrend(trend))
            if (quoted.length) {
                const low = Math.min(...quoted)
                const high = Math.max(...quoted)
                label.title = 'Дневные минимумы в бюджете · ' + trendMoney.format(low / 100)
                if (high != low) label.title += ' – ' + trendMoney.format(high / 100)
            }
            height = 84
            if (compact) height = 56
        }
        label.append(amount)
    } else label.textContent = String(index + 1)
    const icon = L.divIcon({className: 'directory-map-pin', html: label, iconSize: [width, height], iconAnchor: [width / 2, height / 2]})
    const marker = L.marker([hotel.latitude, hotel.longitude], {
        icon, title: hotel.name, keyboard: true, autoPanOnFocus: false, bubblingMouseEvents: false,
    })
        .on('click', select).addTo(group)
    const name = document.createElement('span')
    name.textContent = hotel.tooltip ?? hotel.name
    marker.bindTooltip(name, {className: 'directory-map-tooltip', direction: 'top', offset: [0, -12]})
    accessibleMarker(marker, name.textContent, 1, [hotel.id], select)
    return marker
}

const clusterMoney = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0})

function clusterPopup(map: L.Map, hotels: readonly MapProperty[], select: (id: string) => void) {
    const content = document.createElement('div')
    content.className = 'directory-cluster-list'
    const heading = document.createElement('strong')
    heading.textContent = 'Отели в этой точке · ' + hotels.length
    content.append(heading)
    hotels.forEach(hotel => {
        const button = document.createElement('button')
        button.type = 'button'
        const name = document.createElement('span')
        name.textContent = hotel.name
        const price = document.createElement('b')
        price.textContent = hotel.priceLabel ?? 'Открыть'
        button.append(name, price)
        button.addEventListener('click', function selectHotel() {
            map.closePopup()
            select(hotel.id)
        })
        content.append(button)
    })
    L.DomEvent.disableClickPropagation(content)
    L.DomEvent.disableScrollPropagation(content)
    return content
}

function addCluster(map: L.Map, group: L.LayerGroup, hotels: readonly MapProperty[], center: L.LatLng,
    select: (id: string) => void, zoomed: () => void) {
    const label = document.createElement('span')
    label.className = 'directory-map-cluster'
    const count = document.createElement('span')
    count.textContent = hotels.length + ' отелей'
    const price = document.createElement('strong')
    const amounts = hotels.map(hotel => hotel.priceTotal).filter((value): value is number => value != null)
    price.textContent = amounts.length ? 'от ' + clusterMoney.format(Math.min(...amounts) / 100) : 'Приблизить'
    label.append(count, price)
    const favourites = hotels.filter(hotel => (hotel.favouriteLevel ?? 0) > 0)
    if (favourites.length) {
        const level = Math.max(...favourites.map(hotel => hotel.favouriteLevel ?? 0)) as tPackageFavouriteLevel
        label.dataset.favouriteLevel = String(level)
        label.style.setProperty('--hotel-favourite-color', packageFavouriteLevels[level].color)
        const badge = document.createElement('span')
        badge.className = 'directory-cluster-favourites'
        badge.textContent = '♥ ' + favourites.length
        badge.title = 'Отмеченных отелей в группе · ' + favourites.length
        label.append(badge)
    }
    const icon = L.divIcon({className: 'directory-map-pin is-cluster', html: label, iconSize: [120, 48], iconAnchor: [60, 24]})
    const marker = L.marker(center, {icon, keyboard: true, autoPanOnFocus: false, bubblingMouseEvents: false}).addTo(group)
    function expand() {
        const bounds = L.latLngBounds(hotels.map(hotel => L.latLng(hotel.latitude, hotel.longitude)))
        const zoom = Math.min(map.getMaxZoom(), map.getBoundsZoom(bounds, false, L.point(80, 100)))
        if (zoom > map.getZoom() + 0.25) {
            map.fitBounds(bounds, {maxZoom: zoom, padding: [55, 65], animate: false})
            zoomed()
            return
        }
        const popup = L.popup({maxWidth: 330, maxHeight: 300, className: 'directory-cluster-popup', autoPan: false})
            .setLatLng(center).setContent(clusterPopup(map, hotels, select)).openOn(map)
        popup.getElement()?.querySelector<HTMLButtonElement>('.directory-cluster-list button')?.focus()
    }
    marker.on('click', expand)
    accessibleMarker(marker, hotels.length + ' отелей, ' + price.textContent + '. Нажмите, чтобы раскрыть', hotels.length,
        hotels.map(hotel => hotel.id), expand)
    return marker
}

// Keep a selected hotel readable without moving its geographical marker.
function protectSelectedLabel(map: L.Map, group: L.LayerGroup, markers: readonly L.Marker[]) {
    const size = map.getSize()
    if (size.x < 220 || size.y < 190) return
    const visible = markers.filter(marker => map.getBounds().contains(marker.getLatLng()))
    const labels = visible.flatMap(marker => {
        const card = marker.getElement()?.firstElementChild
        if (!(card instanceof HTMLElement)) return []
        const anchor = map.latLngToContainerPoint(marker.getLatLng())
        const width = card.offsetWidth
        const height = card.offsetHeight
        return [{marker, card, anchor, box: {x: anchor.x - width / 2, y: anchor.y - height / 2, width, height}}]
    })
    const selected = labels.find(layer => layer.marker.getElement()?.classList.contains('is-selected'))
    if (!selected) return
    function bounded(box: CardBox): CardBox {
        return {...box, x: Math.min(size.x - box.width - 6, Math.max(6, box.x)),
            y: Math.min(size.y - box.height - 24, Math.max(56, box.y))}
    }
    function position(layer: (typeof labels)[number], box: CardBox) {
        const dx = box.x - layer.box.x
        const dy = box.y - layer.box.y
        if (dx == 0 && dy == 0) return
        layer.card.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'
        const endpoint = L.point(Math.max(box.x, Math.min(layer.anchor.x, box.x + box.width)),
            Math.max(box.y, Math.min(layer.anchor.y, box.y + box.height)))
        L.polyline([layer.marker.getLatLng(), map.containerPointToLatLng(endpoint)], {
            color: '#446958', weight: 1.4, interactive: false,
        }).addTo(group)
        L.circleMarker(layer.marker.getLatLng(), {radius: 3, color: '#fff', fillColor: '#245a4a',
            weight: 1, fillOpacity: 1, interactive: false}).addTo(group)
    }
    const protectedBox = bounded(selected.box)
    position(selected, protectedBox)
    const others = labels.filter(layer => layer != selected)
    const occupied = [protectedBox, ...others.filter(layer => overlap(layer.box, protectedBox) == 0).map(layer => layer.box)]
    others.filter(layer => overlap(layer.box, protectedBox) > 0).forEach(layer => {
        const {width, height} = layer.box
        const xs = [protectedBox.x - width - 10, protectedBox.x + protectedBox.width + 10]
        const sides = xs.flatMap(x => [0, -height * 0.55, height * 0.55].map(shift => bounded({...layer.box, x, y: layer.box.y + shift})))
        const ys = [protectedBox.y - height - 10, protectedBox.y + protectedBox.height + 10]
        const options = [...sides, ...ys.map(y => bounded({...layer.box, y}))]
        const score = (box: CardBox) => occupied.reduce((total, other) => total + overlap(box, other), overlap(box, protectedBox) * 100)
        const chosen = options.reduce((best, box) => score(box) < score(best) ? box : best)
        position(layer, chosen)
        occupied.push(chosen)
    })
}

function fitDirectoryHotels(map: L.Map, destination: SupplyDestination, hotels: readonly MapProperty[], immersive: boolean) {
    if (!immersive || !hotels.length) {
        fitHotelPoints(map, destination, hotels)
        return
    }
    const narrow = map.getSize().x < 700
    const positions = hotels.map(hotel => L.latLng(hotel.latitude, hotel.longitude))
    map.fitBounds(L.latLngBounds(positions), {
        maxZoom: 14, animate: false,
        paddingTopLeft: narrow ? [20, 145] : [335, 100],
        paddingBottomRight: narrow ? [20, 30] : [40, 30],
    })
}

function mapSearchBounds(area: L.LatLngBounds): tMapBounds | null {
    const south = Math.max(-85, area.getSouth())
    const north = Math.min(85, area.getNorth())
    if (south >= north) return null
    const west = L.Util.wrapNum(area.getWest(), [-180, 180], true)
    const east = L.Util.wrapNum(area.getEast(), [-180, 180], true)
    const wholeWorld = area.getEast() - area.getWest() >= 360 || west >= east
    return wholeWorld ? [-180, south, 180, north] : [west, south, east, north]
}

export function DirectoryMap({destination, hotels, selectedId, onSelect, onSearchArea, world = false, bounds,
    onShowAll, fitAllKey, detailedByDefault = false, loading = false, immersive = false,
    onOpen, onMatrix, onFavourite, camera, onCamera}: DirectoryMapProps) {
    const host = useRef<HTMLDivElement>(null)
    const mapRef = useRef<L.Map | null>(null)
    const markers = useRef(new Map<string, L.Marker>())
    const propertyLayer = useRef<L.LayerGroup | null>(null)
    const actions = useRef({select: onSelect, open: onOpen, matrix: onMatrix, favourite: onFavourite, camera: onCamera})
    const photoHosts = useRef(new Map<string, HTMLElement>())
    const selectedPhotos = useRef(new Map<string, string>())
    const [photoCards, setPhotoCards] = useState<MapPhotoMount[]>([])
    const cancelViewport = useRef<() => void>(() => {})
    const [detailed, setDetailed] = useState(world || detailedByDefault)
    const [tileError, setTileError] = useState(false)
    const [limited, setLimited] = useState(false)
    const [visible, setVisible] = useState(0)
    const fitted = useRef(false)
    const fittedRequest = useRef(fitAllKey)
    const previousSelection = useRef<string | null>(null)
    const rememberCamera = useEffectEvent((map: L.Map) => {
        const center = map.wrapLatLng(map.getCenter())
        actions.current.camera?.({latitude: center.lat, longitude: center.lng, zoom: map.getZoom()})
    })
    const fitVisibleHotels = useEffectEvent((map: L.Map) => {
        const positioned = bounds || fitted.current
        const empty = loading || !hotels.length || !map.getSize().x
        if (positioned || empty) return
        fitDirectoryHotels(map, destination, hotels, immersive)
        fitted.current = true
        rememberCamera(map)
    })
    const searchVisibleArea = useEffectEvent((map: L.Map) => {
        const area = mapSearchBounds(map.getBounds())
        if (area) onSearchArea(area)
    })
    function activateHotel(id: string) {
        actions.current.select(id)
        if (immersive) actions.current.open?.(id)
    }
    const renderProperties = useEffectEvent((map: L.Map) => {
        const group = propertyLayer.current
        if (!group || !Number.isFinite(map.getZoom())) return
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const focusedPin = active?.closest('.directory-map-pin')
        const focusedHotel = [...markers.current].find(([, marker]) => marker.getElement() == focusedPin)?.[0]
        const focusedLevel = active?.dataset.level
        const focusedOpen = active?.classList.contains('map-hotel-card__open')
        const focusedMatrix = active?.classList.contains('map-hotel-card__matrix')
        group.clearLayers()
        markers.current.clear()
        const projection = hotels.map((hotel, order) => {
            const point = map.project([hotel.latitude, hotel.longitude], map.getZoom())
            return {...hotel, order, x: point.x, y: point.y}
        })
        const hasTrends = hotels.some(hotel => (hotel.trend?.length ?? 0) > 1)
        const photoZoom = immersive && map.getZoom() >= 13.25
        let cell = hasTrends ? {width: 150, height: 100} : {width: 138, height: 62}
        if (immersive) cell = photoZoom ? {width: 210, height: 259} : {width: 144, height: 76}
        const clusters = mapClusters(projection, selectedId, cell.width, cell.height)
        const displayed: L.Marker[] = []
        const nextPhotoCards: MapPhotoMount[] = []
        clusters.forEach(cluster => {
            const members = cluster.members
            if (members.length == 1) {
                const hotel = members[0]
                const active = hotel.id == selectedId
                const inView = map.getBounds().contains([hotel.latitude, hotel.longitude])
                const rich = immersive && (active || (photoZoom && inView))
                let photoHost: HTMLElement | undefined
                if (rich) {
                    photoHost = photoHosts.current.get(hotel.id) ?? document.createElement('div')
                    photoHost.className = 'map-hotel-card__photo-host'
                    nextPhotoCards.push({hotel, host: photoHost})
                }
                const favourite = actions.current.favourite
                const change = favourite ? (level: tPackageFavouriteLevel) => favourite(hotel.id, level) : undefined
                const matrix = actions.current.matrix ? () => actions.current.matrix?.(hotel.id) : undefined
                const marker = addProperty(group, hotel, hotel.order, () => activateHotel(hotel.id), photoHost, change, immersive, matrix)
                marker.getElement()?.classList.toggle('is-selected', active)
                if (!rich) marker.getElement()?.setAttribute('aria-pressed', String(active))
                marker.setZIndexOffset(active ? 2000 : 0)
                markers.current.set(hotel.id, marker)
                displayed.push(marker)
            } else {
                const center = map.unproject(L.point(cluster.x, cluster.y), map.getZoom())
                const marker = addCluster(map, group, members, center, activateHotel, function searchCluster() {
                    cancelViewport.current()
                    searchVisibleArea(map)
                })
                displayed.push(marker)
            }
        })
        photoHosts.current = new Map(nextPhotoCards.map(entry => [entry.hotel.id, entry.host]))
        setPhotoCards(nextPhotoCards)
        protectSelectedLabel(map, group, displayed)
        if (focusedHotel && !document.querySelector('dialog[open]')) {
            const element = markers.current.get(focusedHotel)?.getElement()
            let control: HTMLElement | null | undefined = element
            if (active?.isConnected) control = active
            else if (focusedLevel && /^[123]$/.test(focusedLevel)) {
                control = element?.querySelector<HTMLButtonElement>('[data-level="' + focusedLevel + '"]')
            } else if (focusedOpen) control = element?.querySelector<HTMLButtonElement>('.map-hotel-card__open')
            else if (focusedMatrix) control = element?.querySelector<HTMLButtonElement>('.map-hotel-card__matrix')
            control?.focus({preventScroll: true})
        }
        const area = map.getBounds()
        const count = hotels.reduce((total, hotel) => total + Number(area.contains([hotel.latitude, hotel.longitude])), 0)
        setVisible(previous => previous == count ? previous : count)
        host.current?.setAttribute('data-map-groups', String(clusters.length))
    })
    useEffect(() => {
        actions.current = {select: onSelect, open: onOpen, matrix: onMatrix, favourite: onFavourite, camera: onCamera}
    }, [onSelect, onOpen, onMatrix, onFavourite, onCamera])

    useEffect(() => {
        if (!host.current) return
        const map = L.map(host.current, {
            minZoom: world || immersive ? 2 : 8, maxZoom: 18, zoomSnap: .25, zoomControl: false,
            scrollWheelZoom: immersive, touchZoom: true, doubleClickZoom: true, keyboard: true,
        })
        mapRef.current = map
        propertyLayer.current = L.layerGroup().addTo(map)
        map.createPane('atlas').style.zIndex = '170'
        map.createPane('atlasPlaces').style.zIndex = '180'
        map.attributionControl.setPrefix(false)
        if (!world && !immersive) map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>')
        if (!immersive) {
            L.control.zoom({position: 'bottomleft', zoomInTitle: 'Увеличить', zoomOutTitle: 'Уменьшить'}).addTo(map)
            L.control.scale({imperial: false, position: 'bottomright'}).addTo(map)
        }
        let userMove = false
        let pending: ReturnType<typeof setTimeout> | undefined
        cancelViewport.current = function cancelSearch() {
            clearTimeout(pending)
            userMove = false
        }
        function intent(event: Event) {
            if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-', '='].includes(event.key)) return
            if (event instanceof WheelEvent && !map.scrollWheelZoom.enabled()) return
            const target = event.target instanceof Element ? event.target : null
            if (target?.closest('.leaflet-popup, .leaflet-disabled')) return
            if (!(event instanceof WheelEvent) && target?.closest('.leaflet-marker-icon')) return
            clearTimeout(pending)
            userMove = true
        }
        function moved() {
            renderProperties(map)
            if (userMove || fitted.current) rememberCamera(map)
            if (!userMove) return
            userMove = false
            clearTimeout(pending)
            pending = setTimeout(() => searchVisibleArea(map), 400)
        }
        function backgroundClick() { userMove = false }
        const canvas = host.current
        canvas.addEventListener('pointerdown', intent, true)
        canvas.addEventListener('wheel', intent, {capture: true, passive: true})
        canvas.addEventListener('keydown', intent, true)
        map.on('moveend', moved).on('click', backgroundClick)
        const observer = new ResizeObserver(() => {
            map.invalidateSize({pan: false})
            fitVisibleHotels(map)
            renderProperties(map)
        })
        observer.observe(host.current)
        return () => {
            clearTimeout(pending)
            map.off('moveend', moved).off('click', backgroundClick)
            canvas.removeEventListener('pointerdown', intent, true)
            canvas.removeEventListener('wheel', intent, true)
            canvas.removeEventListener('keydown', intent, true)
            observer.disconnect()
            map.remove()
            mapRef.current = null
            propertyLayer.current = null
            cancelViewport.current = () => {}
            markers.current.clear()
        }
    }, [])

    const {id, name, latitude, longitude} = destination
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        fitted.current = false
        previousSelection.current = null
        setLimited(false)
        if (camera) {
            map.setView([camera.latitude, camera.longitude], camera.zoom, {animate: false})
            fitted.current = true
        }
        const zoom = world ? 9 : 12
        const initialized = Number.isFinite(map.getZoom())
        const matchesCenter = initialized && map.getCenter().distanceTo([latitude, longitude]) < 10
        if (!camera && (!world || !matchesCenter)) {
            map.setView([latitude, longitude], world && latitude == 0 && longitude == 0 ? 2 : zoom, {animate: false})
        }
        const base = world ? L.layerGroup().addTo(map) : addBase(map, id, () => setLimited(true))
        return () => { base.remove() }
    }, [id, latitude, longitude])

    useEffect(() => {
        const map = mapRef.current
        if (!map || !camera) return
        const closeCenter = map.getCenter().distanceTo([camera.latitude, camera.longitude]) < 0.2
        if (!closeCenter || Math.abs(map.getZoom() - camera.zoom) > 0.001) {
            cancelViewport.current()
            map.setView([camera.latitude, camera.longitude], camera.zoom, {animate: false})
        }
        fitted.current = true
    }, [camera?.latitude, camera?.longitude, camera?.zoom, id])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        if (camera) {
            fitted.current = true
            return
        }
        if (!bounds) {
            fitted.current = false
            return
        }
        const [west, south, east, north] = bounds
        const area = L.latLngBounds([south, west], [north, east])
        if (!map.getBounds().equals(area, 0.0001)) map.fitBounds(area, {animate: false})
        fitted.current = true
    }, [bounds, id, camera?.latitude, camera?.longitude, camera?.zoom])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        setTileError(false)
        if (!detailed) return
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 18, keepBuffer: 0, referrerPolicy: 'strict-origin-when-cross-origin',
        })
        const reset = () => setTileError(false)
        const missing = () => setTileError(true)
        tiles.on('loading', reset).on('tileerror', missing).addTo(map)
        return () => {
            tiles.off('loading', reset).off('tileerror', missing)
            tiles.remove()
        }
    }, [detailed])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        map.closePopup()
        fitVisibleHotels(map)
        if (!loading && !bounds && fittedRequest.current != fitAllKey) {
            fitDirectoryHotels(map, destination, hotels, immersive)
            fitted.current = true
            fittedRequest.current = fitAllKey
        }
        renderProperties(map)
        const selected = selectedId && markers.current.get(selectedId)
        if (!immersive && selected && selectedId != previousSelection.current) {
            if (!map.getBounds().pad(-0.08).contains(selected.getLatLng())) map.panTo(selected.getLatLng(), {animate: false})
        }
        previousSelection.current = selectedId
    }, [hotels, id, latitude, longitude, selectedId, loading, bounds, fitAllKey])

    function searchArea() {
        cancelViewport.current()
        const bounds = mapRef.current?.getBounds()
        const area = bounds && mapSearchBounds(bounds)
        if (area) onSearchArea(area)
    }

    function showAll() {
        cancelViewport.current()
        if (onShowAll) {
            onShowAll()
            return
        }
        const map = mapRef.current
        if (map) fitDirectoryHotels(map, destination, hotels, immersive)
    }

    return <section className={'hotel-map directory-map' + (immersive ? ' directory-map--immersive' : '')}
        aria-label={'Карта объектов · ' + name} aria-busy={loading}>
        <div className="hotel-map__canvas" ref={host} aria-label="Карта, стрелки для перемещения"
            data-map-total={hotels.length} data-map-visible={visible}/>
        {photoCards.map(({hotel, host}) => createPortal(<MapPhoto hotelId={hotel.id} name={hotel.name}
            photo={hotel.photo} photos={hotel.photos} propertyUrl={hotel.propertyUrl} selectedUrl={selectedPhotos.current.get(hotel.id)}
            onPhoto={url => selectedPhotos.current.set(hotel.id, url)} onOpen={() => activateHotel(hotel.id)}/>, host, hotel.id))}
        {!immersive && <output className="directory-map__count" aria-live="polite">В области <strong>{visible}</strong> из {hotels.length}</output>}
        {!immersive && <div className="hotel-map__tools">
            <button type="button" onClick={searchArea} aria-label="Обновить цены в этой области">Обновить</button>
            <button type="button" title="Уличная карта OpenStreetMap" aria-label="Уличная карта OpenStreetMap" aria-pressed={detailed}
                onClick={() => setDetailed(value => !value)}><Icon name="map"/></button>
            <button type="button" title="Показать объекты выдачи" aria-label="Показать объекты выдачи"
                onClick={showAll}><Icon name="pin"/></button>
        </div>}
        {loading && <small className="hotel-map__notice directory-map__loading" role="status">Обновляем цены…</small>}
        {detailed && tileError && <small className="hotel-map__notice" role="status">Уличная карта частично недоступна</small>}
        {limited && !detailed && <small className="hotel-map__notice">Показаны координаты. Для улиц включите подробную карту.</small>}
    </section>
}
