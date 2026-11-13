import {useEffect, useRef, useState} from 'react'
import * as L from 'leaflet'
import type {GeoJsonObject} from 'geojson'
import {destinations} from '../demo/catalog.ts'
import type {SupplyDestination, SupplyHotel} from '../src/supply-contract.ts'
import {drawAtlas, fitHotelPoints} from './HotelMap.tsx'
import {Icon} from './Icons.tsx'

export type tMapBounds = readonly [west: number, south: number, east: number, north: number]

interface DirectoryMapProps {
    destination: SupplyDestination
    hotels: readonly SupplyHotel[]
    selectedId: string | null
    onSelect: (id: string) => void
    onSearchArea: (bounds: tMapBounds) => void
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

function addProperty(group: L.LayerGroup, hotel: SupplyHotel, index: number, select: () => void) {
    const label = document.createElement('span')
    label.className = 'directory-map-number'
    label.textContent = String(index + 1)
    const icon = L.divIcon({className: 'directory-map-pin', html: label, iconSize: [30, 30], iconAnchor: [15, 15]})
    const marker = L.marker([hotel.latitude, hotel.longitude], {icon, title: hotel.name, keyboard: true, autoPanOnFocus: false})
        .on('click', select).addTo(group)
    const name = document.createElement('span')
    name.textContent = hotel.name
    marker.bindTooltip(name, {className: 'directory-map-tooltip', direction: 'top', offset: [0, -12]})
    const node = marker.getElement()
    node?.setAttribute('aria-label', hotel.name)
    node?.addEventListener('keydown', function selectWithSpace(event) {
        if (event.key != ' ') return
        event.preventDefault()
        select()
    })
    return marker
}

export function DirectoryMap({destination, hotels, selectedId, onSelect, onSearchArea}: DirectoryMapProps) {
    const host = useRef<HTMLDivElement>(null)
    const mapRef = useRef<L.Map | null>(null)
    const markers = useRef(new Map<string, L.Marker>())
    const select = useRef(onSelect)
    const [detailed, setDetailed] = useState(false)
    const [tileError, setTileError] = useState(false)
    const [limited, setLimited] = useState(false)
    const fitted = useRef(false)
    useEffect(() => { select.current = onSelect }, [onSelect])

    useEffect(() => {
        if (!host.current) return
        const map = L.map(host.current, {minZoom: 8, maxZoom: 18, zoomSnap: .25, zoomControl: false, scrollWheelZoom: false})
        mapRef.current = map
        map.createPane('atlas').style.zIndex = '170'
        map.createPane('atlasPlaces').style.zIndex = '180'
        map.attributionControl.setPrefix(false)
        map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>')
        L.control.zoom({position: 'bottomleft', zoomInTitle: 'Увеличить', zoomOutTitle: 'Уменьшить'}).addTo(map)
        L.control.scale({imperial: false, position: 'bottomright'}).addTo(map)
        const observer = new ResizeObserver(() => map.invalidateSize({pan: false}))
        observer.observe(host.current)
        return () => {
            observer.disconnect()
            map.remove()
            mapRef.current = null
            markers.current.clear()
        }
    }, [])

    const {id, name, latitude, longitude} = destination
    useEffect(() => {
        const map = mapRef.current
        if (!map) return
        fitted.current = false
        setLimited(false)
        map.setView([latitude, longitude], 12, {animate: false})
        const base = addBase(map, id, () => setLimited(true))
        return () => { base.remove() }
    }, [id, latitude, longitude])

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
        if (!fitted.current && hotels.length) {
            fitHotelPoints(map, {latitude, longitude}, hotels)
            fitted.current = true
        }
        const group = L.layerGroup().addTo(map)
        const index = markers.current
        hotels.forEach((hotel, n) => {
            const marker = addProperty(group, hotel, n, () => select.current(hotel.id))
            index.set(hotel.id, marker)
        })
        return () => {
            group.remove()
            index.clear()
        }
    }, [hotels, id, latitude, longitude])

    useEffect(() => {
        const map = mapRef.current
        for (const [markerId, marker] of markers.current) {
            const active = markerId == selectedId
            marker.getElement()?.classList.toggle('is-selected', active)
            marker.getElement()?.setAttribute('aria-pressed', String(active))
            marker.setZIndexOffset(active ? 1000 : 0)
            if (active) {
                if (map && !map.getBounds().pad(-0.08).contains(marker.getLatLng())) map.panTo(marker.getLatLng(), {animate: false})
                marker.openTooltip()
            } else marker.closeTooltip()
        }
    }, [selectedId, hotels])

    function searchArea() {
        const bounds = mapRef.current?.getBounds()
        if (bounds) onSearchArea([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    }

    return <section className="hotel-map directory-map" aria-label={'Карта объектов · ' + name}>
        <div className="hotel-map__canvas" ref={host} aria-label="Карта, стрелки для перемещения"/>
        <div className="hotel-map__tools">
            <button type="button" onClick={searchArea}>Искать в этой области</button>
            <button type="button" title="Уличная карта OpenStreetMap" aria-label="Уличная карта OpenStreetMap" aria-pressed={detailed}
                onClick={() => setDetailed(value => !value)}><Icon name="map"/></button>
            <button type="button" title="Показать объекты выдачи" aria-label="Показать объекты выдачи"
                onClick={() => mapRef.current && fitHotelPoints(mapRef.current, destination, hotels)}><Icon name="pin"/></button>
        </div>
        {detailed && tileError && <small className="hotel-map__notice" role="status">Уличная карта частично недоступна</small>}
        {limited && !detailed && <small className="hotel-map__notice">Показаны координаты. Для улиц включите подробную карту.</small>}
    </section>
}
