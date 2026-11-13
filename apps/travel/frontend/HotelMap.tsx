import {useEffect, useRef, useState} from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './map.css'

export interface MapHotel {
  id: string
  name: string
  latitude: number
  longitude: number
  total: number
}

interface HotelMapProps {
  hotels: MapHotel[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const priceFormat = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB', minimumFractionDigits: 0})
const district: L.LatLngBoundsExpression = [[27.08, 33.79], [27.25, 33.88]]

// Natural Earth 1:10m / QGIS world_map, clipped around the Hurghada district.
// This low-resolution coastline stays visible until detailed map tiles load.
const coast: L.LatLngTuple[] = [
  [27.60, 33.4], [27.60, 33.55], [27.5715, 33.5647], [27.5368, 33.5579],
  [27.4958, 33.633], [27.3419, 33.6917], [27.2426, 33.8384], [27.1805, 33.8247],
  [27.1208, 33.8368], [27.0587, 33.9014], [27.0142, 33.9009], [26.931, 33.9517],
  [26.8966, 33.9961], [26.8379, 33.9961], [26.8498, 33.9596], [26.831, 33.9483],
  [26.80, 33.94], [26.80, 33.4],
]

function showHotels(map: L.Map, hotels: MapHotel[]) {
  if (hotels.length === 0) {
    map.fitBounds(district, {padding: [35, 40], animate: false})
    return
  }
  const bounds = L.latLngBounds(hotels.map(({latitude, longitude}) => L.latLng(latitude, longitude)))
  map.fitBounds(bounds, {padding: [58, 48], maxZoom: 13, animate: false})
}

function addPlace(map: L.Map, position: L.LatLngTuple, name: string, className: string) {
  const label = document.createElement('span')
  label.textContent = name
  L.marker(position, {
    pane: 'coastLabels', interactive: false, keyboard: false,
    icon: L.divIcon({html: label, className: 'hotel-map__place ' + className, iconSize: [0, 0]}),
  }).addTo(map)
}

export function HotelMap({hotels, selectedId, onSelect}: HotelMapProps) {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<L.Map | null>(null)
  const markers = useRef(new Map<string, L.Marker>())
  const onSelectRef = useRef(onSelect)
  const resultRef = useRef(hotels)
  const initialFit = useRef(false)
  const [detailed, setDetailed] = useState(false)
  const [missingTiles, setMissingTiles] = useState(false)

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { resultRef.current = hotels }, [hotels])

  useEffect(() => {
    const host = container.current
    if (!host) return
    const map = L.map(host, {
      minZoom: 10, maxZoom: 17, zoomControl: false, scrollWheelZoom: false,
      maxBounds: [[27.015, 33.70], [27.32, 34.04]], maxBoundsViscosity: 1,
    })
    instance.current = map
    map.createPane('coast').style.zIndex = '170'
    map.createPane('coastLabels').style.zIndex = '180'
    L.polygon(coast, {
      pane: 'coast', interactive: false, color: '#a6b9a1', weight: 1,
      fillColor: '#e9e8d8', fillOpacity: 1,
    }).addTo(map)
    addPlace(map, [27.231, 33.812], 'Хургада', 'hotel-map__city')
    addPlace(map, [27.161, 33.922], 'Красное море', 'hotel-map__sea')
    map.attributionControl.setPrefix(false)
    map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>')
    L.control.zoom({position: 'bottomleft', zoomInTitle: 'Увеличить', zoomOutTitle: 'Уменьшить'}).addTo(map)
    L.control.scale({imperial: false, position: 'bottomright'}).addTo(map)
    showHotels(map, resultRef.current)

    const observer = new ResizeObserver(() => map.invalidateSize({pan: false}))
    observer.observe(host)
    return () => {
      observer.disconnect()
      map.remove()
      instance.current = null
      markers.current.clear()
      initialFit.current = false
    }
  }, [])

  useEffect(() => {
    const map = instance.current
    setMissingTiles(false)
    if (!map || !detailed) return
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 17, keepBuffer: 0, referrerPolicy: 'strict-origin-when-cross-origin',
    })
    const loading = () => setMissingTiles(false)
    const missing = () => setMissingTiles(true)
    tiles.on('loading', loading).on('tileerror', missing)
    tiles.addTo(map)
    return () => {
      tiles.off('loading', loading).off('tileerror', missing)
      tiles.remove()
    }
  }, [detailed])

  useEffect(() => {
    const map = instance.current
    if (!map) return
    const group = L.layerGroup().addTo(map)
    const current = markers.current
    for (const hotel of hotels) {
      const amount = document.createElement('span')
      amount.className = 'hotel-map__amount'
      amount.textContent = priceFormat.format(hotel.total / 100)
      const label = hotel.name + ', ' + amount.textContent
      const marker = L.marker([hotel.latitude, hotel.longitude], {
        icon: L.divIcon({className: 'hotel-map__marker', html: amount, iconSize: [0, 0]}),
        title: label, alt: label, keyboard: true, riseOnHover: true,
      }).on('click', () => onSelectRef.current(hotel.id)).addTo(group)
      const node = marker.getElement()
      node?.setAttribute('aria-label', label)
      node?.addEventListener('keydown', event => {
        if (event.key === ' ') {
          event.preventDefault()
          onSelectRef.current(hotel.id)
        }
      })
      current.set(hotel.id, marker)
    }
    if (hotels.length && !initialFit.current) {
      showHotels(map, hotels)
      initialFit.current = true
    }
    return () => { current.clear(); group.remove() }
  }, [hotels])

  useEffect(() => {
    const map = instance.current
    for (const [id, marker] of markers.current) {
      const active = id === selectedId
      marker.setZIndexOffset(active ? 1000 : 0)
      marker.getElement()?.classList.toggle('is-selected', active)
      marker.getElement()?.setAttribute('aria-pressed', String(active))
      if (active && map && !map.getBounds().pad(-0.1).contains(marker.getLatLng())) {
        map.panTo(marker.getLatLng(), {animate: false})
      }
    }
  }, [selectedId, hotels])

  return <section className="hotel-map" aria-label="Отели на карте Хургады">
    <div className="hotel-map__canvas" ref={container} aria-label="Карта, стрелки для перемещения" />
    <div className="hotel-map__tools">
      <button type="button" aria-pressed={detailed} onClick={() => setDetailed(value => !value)}>
        Подробная карта
      </button>
      <button type="button" onClick={() => instance.current && showHotels(instance.current, hotels)}
        title="Показать все найденные отели" aria-label="Показать все найденные отели">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/><circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
    {detailed && missingTiles && <small className="hotel-map__notice" role="status">
      Часть карты показана схематично
    </small>}
    {hotels.length === 0 && <p className="hotel-map__empty" role="status">В выбранном диапазоне цен отелей нет.</p>}
  </section>
}
