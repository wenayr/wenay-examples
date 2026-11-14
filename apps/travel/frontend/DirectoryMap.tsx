import {useEffect, useEffectEvent, useRef, useState} from 'react'
import * as L from 'leaflet'
import type {GeoJsonObject} from 'geojson'
import {destinations} from '../demo/catalog.ts'
import type {SupplyDestination, SupplyHotel} from '../src/supply-contract.ts'
import type {PackageTrendPoint} from '../src/package-trends-contract.ts'
import {drawAtlas, fitHotelPoints, overlap, type CardBox} from './HotelMap.tsx'
import {Icon} from './Icons.tsx'
import {mapClusters} from './map-clusters.ts'

export type tMapBounds = readonly [west: number, south: number, east: number, north: number]

type MapProperty = Pick<SupplyHotel, 'id' | 'name' | 'latitude' | 'longitude'> & {
    priceLabel?: string
    priceTotal?: number
    tooltip?: string
    trend?: readonly PackageTrendPoint[]
}
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
        if (event.key != ' ') return
        event.preventDefault()
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
        dot.setAttribute('r', '2')
        dot.append(title)
        graph.append(dot)
    })
    path.setAttribute('d', shape)
    graph.prepend(path)
    return graph
}

function addProperty(group: L.LayerGroup, hotel: MapProperty, index: number, select: () => void) {
    const label = document.createElement('span')
    label.className = 'directory-map-number' + (hotel.priceLabel ? ' package-map-price' : '')
    const trend = hotel.trend ?? []
    const multipleDays = Boolean(hotel.priceLabel && trend.length > 1)
    const width = hotel.priceLabel ? 128 : 40
    let height = hotel.priceLabel ? 52 : 40
    if (hotel.priceLabel) {
        const name = document.createElement('span')
        name.className = 'directory-pin-name'
        name.textContent = hotel.name
        const amount = document.createElement('strong')
        amount.textContent = hotel.priceLabel
        label.append(name, amount)
        if (multipleDays) {
            const totals = trend.filter(day => day.status == 'quoted').map(day => day.total)
            const quoted = totals.filter((value): value is number => value != null)
            label.classList.add('has-trend')
            label.append(priceTrend(trend))
            if (quoted.length) {
                const range = document.createElement('span')
                range.className = 'directory-pin-range'
                const low = Math.min(...quoted)
                const high = Math.max(...quoted)
                range.textContent = trendMoney.format(low / 100)
                if (high != low) range.textContent += ' – ' + trendMoney.format(high / 100)
                range.title = 'Дневные минимумы в бюджете'
                label.append(range)
            }
            height = 84
        }
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

export function DirectoryMap({destination, hotels, selectedId, onSelect, onSearchArea, world = false, bounds,
    onShowAll, fitAllKey, detailedByDefault = false, loading = false}: DirectoryMapProps) {
    const host = useRef<HTMLDivElement>(null)
    const mapRef = useRef<L.Map | null>(null)
    const markers = useRef(new Map<string, L.Marker>())
    const propertyLayer = useRef<L.LayerGroup | null>(null)
    const select = useRef(onSelect)
    const cancelViewport = useRef<() => void>(() => {})
    const [detailed, setDetailed] = useState(world || detailedByDefault)
    const [tileError, setTileError] = useState(false)
    const [limited, setLimited] = useState(false)
    const [visible, setVisible] = useState(0)
    const fitted = useRef(false)
    const fittedRequest = useRef(fitAllKey)
    const previousSelection = useRef<string | null>(null)
    const fitVisibleHotels = useEffectEvent((map: L.Map) => {
        const positioned = bounds || fitted.current
        const empty = loading || !hotels.length || !map.getSize().x
        if (positioned || empty) return
        fitHotelPoints(map, destination, hotels)
        fitted.current = true
    })
    const searchVisibleArea = useEffectEvent((map: L.Map) => {
        const area = map.getBounds()
        onSearchArea([area.getWest(), area.getSouth(), area.getEast(), area.getNorth()])
    })
    const renderProperties = useEffectEvent((map: L.Map) => {
        const group = propertyLayer.current
        if (!group || !Number.isFinite(map.getZoom())) return
        group.clearLayers()
        markers.current.clear()
        const projection = hotels.map((hotel, order) => {
            const point = map.project([hotel.latitude, hotel.longitude], map.getZoom())
            return {...hotel, order, x: point.x, y: point.y}
        })
        const hasTrends = hotels.some(hotel => (hotel.trend?.length ?? 0) > 1)
        const cell = hasTrends ? {width: 150, height: 100} : {width: 138, height: 62}
        const clusters = mapClusters(projection, selectedId, cell.width, cell.height)
        const displayed: L.Marker[] = []
        clusters.forEach(cluster => {
            const members = cluster.members
            if (members.length == 1) {
                const hotel = members[0]
                const marker = addProperty(group, hotel, hotel.order, () => select.current(hotel.id))
                const active = hotel.id == selectedId
                marker.getElement()?.classList.toggle('is-selected', active)
                marker.getElement()?.setAttribute('aria-pressed', String(active))
                marker.setZIndexOffset(active ? 2000 : 0)
                markers.current.set(hotel.id, marker)
                displayed.push(marker)
            } else {
                const center = map.unproject(L.point(cluster.x, cluster.y), map.getZoom())
                const marker = addCluster(map, group, members, center, id => select.current(id), function searchCluster() {
                    cancelViewport.current()
                    searchVisibleArea(map)
                })
                displayed.push(marker)
            }
        })
        protectSelectedLabel(map, group, displayed)
        const area = map.getBounds()
        const count = hotels.reduce((total, hotel) => total + Number(area.contains([hotel.latitude, hotel.longitude])), 0)
        setVisible(previous => previous == count ? previous : count)
        host.current?.setAttribute('data-map-groups', String(clusters.length))
    })
    useEffect(() => { select.current = onSelect }, [onSelect])

    useEffect(() => {
        if (!host.current) return
        const map = L.map(host.current, {minZoom: world ? 2 : 8, maxZoom: 18, zoomSnap: .25, zoomControl: false, scrollWheelZoom: false})
        mapRef.current = map
        propertyLayer.current = L.layerGroup().addTo(map)
        map.createPane('atlas').style.zIndex = '170'
        map.createPane('atlasPlaces').style.zIndex = '180'
        map.attributionControl.setPrefix(false)
        if (!world) map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>')
        L.control.zoom({position: 'bottomleft', zoomInTitle: 'Увеличить', zoomOutTitle: 'Уменьшить'}).addTo(map)
        L.control.scale({imperial: false, position: 'bottomright'}).addTo(map)
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
            if (target?.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-disabled')) return
            clearTimeout(pending)
            userMove = true
        }
        function moved() {
            renderProperties(map)
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
        const zoom = world ? 9 : 12
        const initialized = Number.isFinite(map.getZoom())
        const matchesCenter = initialized && map.getCenter().distanceTo([latitude, longitude]) < 10
        if (!world || !matchesCenter) {
            map.setView([latitude, longitude], world && latitude == 0 && longitude == 0 ? 2 : zoom, {animate: false})
        }
        const base = world ? L.layerGroup().addTo(map) : addBase(map, id, () => setLimited(true))
        return () => { base.remove() }
    }, [id, latitude, longitude])

    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        if (!bounds) {
            fitted.current = false
            return
        }
        const [west, south, east, north] = bounds
        const area = L.latLngBounds([south, west], [north, east])
        if (!map.getBounds().equals(area, 0.0001)) map.fitBounds(area, {animate: false})
        fitted.current = true
    }, [bounds, id])

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
            fitHotelPoints(map, destination, hotels)
            fitted.current = true
            fittedRequest.current = fitAllKey
        }
        renderProperties(map)
        const selected = selectedId && markers.current.get(selectedId)
        if (selected && selectedId != previousSelection.current) {
            if (!map.getBounds().pad(-0.08).contains(selected.getLatLng())) map.panTo(selected.getLatLng(), {animate: false})
        }
        previousSelection.current = selectedId
    }, [hotels, id, latitude, longitude, selectedId, loading, bounds, fitAllKey])

    function searchArea() {
        cancelViewport.current()
        const bounds = mapRef.current?.getBounds()
        if (bounds) onSearchArea([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    }

    function showAll() {
        cancelViewport.current()
        if (onShowAll) {
            onShowAll()
            return
        }
        const map = mapRef.current
        if (map) fitHotelPoints(map, destination, hotels)
    }

    return <section className="hotel-map directory-map" aria-label={'Карта объектов · ' + name} aria-busy={loading}>
        <div className="hotel-map__canvas" ref={host} aria-label="Карта, стрелки для перемещения"
            data-map-total={hotels.length} data-map-visible={visible}/>
        <output className="directory-map__count" aria-live="polite">В области <strong>{visible}</strong> из {hotels.length}</output>
        <div className="hotel-map__tools">
            <button type="button" onClick={searchArea} aria-label="Обновить цены в этой области">Обновить</button>
            <button type="button" title="Уличная карта OpenStreetMap" aria-label="Уличная карта OpenStreetMap" aria-pressed={detailed}
                onClick={() => setDetailed(value => !value)}><Icon name="map"/></button>
            <button type="button" title="Показать объекты выдачи" aria-label="Показать объекты выдачи"
                onClick={showAll}><Icon name="pin"/></button>
        </div>
        {loading && <small className="hotel-map__notice directory-map__loading" role="status">Обновляем цены…</small>}
        {detailed && tileError && <small className="hotel-map__notice" role="status">Уличная карта частично недоступна</small>}
        {limited && !detailed && <small className="hotel-map__notice">Показаны координаты. Для улиц включите подробную карту.</small>}
    </section>
}
