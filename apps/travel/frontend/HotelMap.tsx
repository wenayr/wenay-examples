import {useEffect, useRef, useState} from 'react'
import * as L from 'leaflet'
import type {DestinationId} from '../demo/catalog.ts'
import 'leaflet/dist/leaflet.css'
import './map.css'

export interface MapHotel {
    id: string
    name: string
    latitude: number
    longitude: number
    outline: readonly (readonly [number, number])[]
    prices: readonly (number | null)[]
    minTotal: number
    maxTotal: number
}

interface Destination {
    id: DestinationId
    name: string
    latitude: number
    longitude: number
}

interface HotelMapProps {
    hotels: readonly MapHotel[]
    dates: readonly string[]
    destination: Destination
    selectedId: string | null
    onSelect: (id: string) => void
}

// == География и формат цены ==

const euros = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2})
const money = (cents: number) => euros.format(cents / 100) + ' €'
const svgNS = 'http://www.w3.org/2000/svg'

// Natural Earth 1:10m land v4.1.0, distributed by world-atlas 2.0.2.
// Local WGS84 extracts keep the atlas usable when the optional tile service is offline.
const shores = {
    hurghada: [
        [
            [27.66, 33.24], [27.66, 33.5047], [27.6459, 33.4965], [27.6358, 33.5181], [27.6155, 33.5361],
            [27.5716, 33.5649], [27.5564, 33.5577], [27.5362, 33.5577], [27.5261, 33.5757], [27.5075, 33.6189],
            [27.4957, 33.6333], [27.4872, 33.6369], [27.4653, 33.6369], [27.4551, 33.6405], [27.4298, 33.6657],
            [27.4197, 33.6729], [27.3555, 33.6837], [27.342, 33.6909], [27.3133, 33.7233], [27.2897, 33.7629],
            [27.2728, 33.8061], [27.2593, 33.8241], [27.2424, 33.8385], [27.2322, 33.8421], [27.1934, 33.8385],
            [27.185, 33.8277], [27.1799, 33.8241], [27.1748, 33.8241], [27.1664, 33.8313], [27.1377, 33.8313],
            [27.1208, 33.8385], [27.1073, 33.8457], [27.0955, 33.8673], [27.0583, 33.8997], [27.0414, 33.9069],
            [27.0431, 33.8925], [27.0279, 33.8925], [27.0144, 33.8997], [26.9891, 33.9213], [26.9317, 33.9501],
            [26.9215, 33.9645], [26.908, 33.9897], [26.8962, 33.9969], [26.8641, 34.0041], [26.8489, 34.0041],
            [26.8371, 33.9969], [26.8371, 33.9789], [26.8506, 33.9609], [26.8304, 33.9465], [26.7831, 33.9465],
            [26.7696, 33.9501], [26.75, 33.9501], [26.75, 33.24],
        ],
        [
            [27.66, 33.5575], [27.6595, 33.5577], [27.6595, 33.5505], [27.66, 33.5503],
        ],
        [
            [27.66, 33.5863], [27.6595, 33.5865], [27.6527, 33.5937], [27.6459, 33.5937], [27.6544, 33.5829],
            [27.66, 33.5777],
        ],
        [
            [26.75, 33.9745], [26.7898, 33.9537], [26.7898, 33.9753], [26.751, 33.9969], [26.75, 33.9973],
        ],
        [
            [27.5024, 34.0293], [27.4855, 34.0365], [27.467, 34.0401], [27.4551, 34.0509], [27.4484, 34.0509],
            [27.4518, 34.0293], [27.4754, 34.0077], [27.4822, 33.9861], [27.4872, 33.9753], [27.4973, 33.9681],
            [27.5041, 33.9573], [27.494, 33.9321], [27.5007, 33.9249], [27.5125, 33.9177], [27.5244, 33.9141],
            [27.5294, 33.9177], [27.5345, 33.9249], [27.5362, 33.9321], [27.5345, 33.9645], [27.5142, 33.9933],
        ],
    ],
    phuket: [
        [
            [8.32, 98.4336], [8.3168, 98.4268], [8.3067, 98.4232], [8.2948, 98.452], [8.278, 98.4556],
            [8.2577, 98.4556], [8.2425, 98.4628], [8.2155, 98.4628], [8.175, 98.4448], [8.1479, 98.4232],
            [8.1648, 98.4124], [8.1648, 98.4052], [8.1547, 98.4052], [8.1361, 98.3908], [8.1513, 98.3764],
            [8.1851, 98.3584], [8.1952, 98.3296], [8.202, 98.3296], [8.2104, 98.3224], [8.2155, 98.2936],
            [8.2206, 98.2864], [8.2256, 98.2828], [8.2408, 98.2792], [8.283, 98.2792], [8.2982, 98.272],
            [8.3134, 98.2612], [8.32, 98.2599],
        ],
        [
            [8.32, 98.86], [8.0085, 98.86], [8.0078, 98.8588], [8.0027, 98.8444], [8.0061, 98.83],
            [8.0145, 98.8228], [8.0365, 98.8192], [8.0449, 98.812], [8.0517, 98.8012], [8.0483, 98.794],
            [8.0399, 98.7904], [8.023, 98.776], [8.023, 98.7688], [8.0382, 98.7688], [8.0466, 98.7652],
            [8.0601, 98.7508], [8.0686, 98.7472], [8.0872, 98.7436], [8.1361, 98.7472], [8.1496, 98.7436],
            [8.1817, 98.7472], [8.1986, 98.7472], [8.2155, 98.7436], [8.2543, 98.7256], [8.2256, 98.7112],
            [8.2256, 98.7076], [8.2982, 98.704], [8.3084, 98.6968], [8.3033, 98.6788], [8.2847, 98.65],
            [8.2881, 98.6392], [8.2881, 98.632], [8.2813, 98.632], [8.2813, 98.6248], [8.2932, 98.6212],
            [8.32, 98.623],
        ],
        [
            [7.9166, 98.4304], [7.9014, 98.4412], [7.8862, 98.4412], [7.8744, 98.4304], [7.8643, 98.398],
            [7.8508, 98.3944], [7.8153, 98.398], [7.8322, 98.362], [7.8322, 98.344], [7.8119, 98.3368],
            [7.7866, 98.3332], [7.7714, 98.3224], [7.768, 98.308], [7.7781, 98.2936], [7.7917, 98.2864],
            [7.8558, 98.2828], [7.8643, 98.2792], [7.871, 98.272], [7.8795, 98.2684], [7.8896, 98.2684],
            [7.8963, 98.2792], [7.9031, 98.2864], [7.9166, 98.2828], [7.9217, 98.2756], [7.9284, 98.254],
            [7.9386, 98.2576], [7.9538, 98.2756], [7.974, 98.2648], [7.9842, 98.2684], [7.9943, 98.2792],
            [8.0027, 98.2828], [8.0331, 98.2756], [8.0753, 98.2756], [8.1091, 98.29], [8.1513, 98.29],
            [8.1918, 98.2828], [8.1902, 98.29], [8.1851, 98.2972], [8.1885, 98.3044], [8.1851, 98.3116],
            [8.1783, 98.3224], [8.1699, 98.3296], [8.1564, 98.3368], [8.1091, 98.344], [8.1091, 98.3512],
            [8.1192, 98.3584], [8.1108, 98.3728], [8.0821, 98.4052], [8.0939, 98.4124], [8.099, 98.4232],
            [8.0956, 98.4304], [8.0821, 98.4376], [8.0652, 98.4376], [8.0196, 98.416], [8.001, 98.4196],
            [7.9926, 98.4196], [7.9808, 98.4016], [7.9723, 98.398], [7.9554, 98.398], [7.9352, 98.4016],
            [7.9183, 98.4088], [7.9031, 98.4196],
        ],
        [
            [8.1024, 98.6212], [8.0905, 98.6212], [8.1057, 98.578], [8.1192, 98.5708], [8.1243, 98.5744],
            [8.1311, 98.596], [8.1463, 98.5924], [8.1615, 98.6032], [8.1766, 98.6176], [8.1918, 98.6248],
            [8.1902, 98.632], [8.1851, 98.6356], [8.18, 98.6356], [8.1716, 98.6392],
        ],
        [
            [8.0787, 98.5852], [8.0635, 98.6032], [8.0348, 98.6104], [7.9267, 98.6104], [7.9031, 98.6032],
            [7.9048, 98.5888], [7.92, 98.578], [7.9386, 98.5708], [7.9639, 98.5672], [7.9774, 98.5636],
            [7.9858, 98.5636], [7.9926, 98.5672], [7.996, 98.5816], [8.0145, 98.5816], [8.0314, 98.5744],
            [8.0348, 98.5672], [8.0365, 98.5564], [8.072, 98.5384], [8.0888, 98.5312], [8.1074, 98.5276],
            [8.1243, 98.5276], [8.1057, 98.542],
        ],
    ],
    paphos: [
        [
            [35.18, 32.732], [35.1787, 32.7441], [35.1702, 32.7765], [35.1567, 32.8017], [35.1483, 32.8269],
            [35.1567, 32.8665], [35.1753, 32.8917], [35.18, 32.8957], [35.18, 33.08], [34.6912, 33.08],
            [34.6873, 33.0717], [34.6519, 33.0249], [34.635, 33.0141], [34.6248, 33.0105], [34.5978, 33.0105],
            [34.5742, 33.0285], [34.5691, 33.0285], [34.5691, 32.9421], [34.5944, 32.9457], [34.64, 32.9169],
            [34.6569, 32.9133], [34.6687, 32.8557], [34.6704, 32.8341], [34.6687, 32.8125], [34.6502, 32.7477],
            [34.6451, 32.7081], [34.6519, 32.6649], [34.667, 32.6253], [34.6924, 32.5749], [34.6991, 32.5569],
            [34.7042, 32.5353], [34.7076, 32.4921], [34.7126, 32.4741], [34.7211, 32.4597], [34.7532, 32.4129],
            [34.7819, 32.4057], [34.7869, 32.4021], [34.7971, 32.4021], [34.8494, 32.3805], [34.868, 32.3481],
            [34.8764, 32.3373], [34.8984, 32.3229], [34.9119, 32.3229], [34.9237, 32.3301], [34.9507, 32.3121],
            [34.9609, 32.3085], [34.9828, 32.3085], [35.0014, 32.3049], [35.0318, 32.2833], [35.047, 32.2761],
            [35.0723, 32.2725], [35.0909, 32.2761], [35.0976, 32.2869], [35.0858, 32.3085], [35.0588, 32.3373],
            [35.0487, 32.3517], [35.0419, 32.3733], [35.0436, 32.4129], [35.0588, 32.4489], [35.0824, 32.4813],
            [35.1095, 32.5029], [35.1399, 32.5173], [35.1567, 32.5281], [35.1669, 32.5425], [35.1787, 32.5533],
            [35.177, 32.5605], [35.1719, 32.5677], [35.1702, 32.5749], [35.1719, 32.5857], [35.18, 32.6051],
        ],
    ]
} satisfies Record<DestinationId, L.LatLngTuple[][]>

type tAtlasKey = keyof typeof shores
// Natural Earth 1:10m roads (v5) and urban areas, clipped to each resort.
const settlements = {
    hurghada: {roads: [
        [
            [27.31, 33.713], [27.298, 33.7286], [27.2773, 33.7616], [27.2526, 33.8235], [27.2278, 33.8317],
            [27.2113, 33.8235], [27.1742, 33.8194], [27.1247, 33.8276], [27.0917, 33.84], [27.034, 33.84],
            [27.02, 33.8417],
        ]
    ], urban: [
        [
            [27.1379, 33.8325], [27.1208, 33.8368], [27.107, 33.8472], [27.0952, 33.866], [27.0811, 33.8828],
            [27.0803, 33.8652], [27.092, 33.8296], [27.1072, 33.8024], [27.1133, 33.7985], [27.1443, 33.7923],
            [27.1554, 33.7923], [27.1554, 33.7811], [27.166, 33.7829], [27.1806, 33.7913], [27.1887, 33.7923],
            [27.211, 33.7811], [27.2332, 33.7811], [27.2649, 33.7587], [27.278, 33.7581], [27.2897, 33.7649],
            [27.2721, 33.8056], [27.2597, 33.8254], [27.2426, 33.8384], [27.2321, 33.8405], [27.1942, 33.8384],
            [27.1805, 33.8247], [27.1746, 33.8254], [27.1659, 33.8303],
        ]
    ]},
    phuket: {roads: [
        [
            [8.01, 98.341], [7.9915, 98.3542], [7.975, 98.3748], [7.9379, 98.3913], [7.9214, 98.3913],
            [7.9049, 98.3872], [7.8884, 98.3954], [7.8802, 98.3954],
        ]
    ], urban: [
        [
            [7.8711, 98.42], [7.8646, 98.3997], [7.8505, 98.3954], [7.815, 98.3981], [7.8324, 98.3623],
            [7.8327, 98.3522], [7.854, 98.362], [7.8685, 98.366], [7.8836, 98.3609], [7.9103, 98.344],
            [7.9288, 98.3437], [7.9316, 98.3684], [7.9285, 98.4045], [7.9177, 98.4089], [7.9038, 98.4186],
            [7.9052, 98.42],
        ]
    ]},
    paphos: {roads: [
        [
            [34.8185, 32.4622], [34.8422, 32.4719], [34.8666, 32.4762], [34.88, 32.4759],
        ],
        [
            [34.88, 32.4931], [34.8745, 32.483],
        ],
        [
            [34.88, 32.4812], [34.8745, 32.483],
        ],
        [
            [34.8745, 32.483], [34.8539, 32.4789], [34.8127, 32.4542], [34.7755, 32.4212],
        ],
        [
            [34.7755, 32.4212], [34.759, 32.4129],
        ],
        [
            [34.7388, 32.53], [34.7384, 32.5284], [34.7302, 32.516],
        ],
        [
            [34.7755, 32.4212], [34.7673, 32.4542], [34.7425, 32.483], [34.7302, 32.516],
        ],
        [
            [34.7302, 32.516], [34.7255, 32.53],
        ]
    ], urban: [
        [
            [34.7664, 32.4394], [34.7712, 32.4248], [34.782, 32.4162], [34.8001, 32.4148], [34.8004, 32.4344],
            [34.7956, 32.4491], [34.7847, 32.4578], [34.7667, 32.4592],
        ]
    ]}
} satisfies Record<tAtlasKey, {roads: L.LatLngTuple[][], urban: L.LatLngTuple[][]}>

type Place = [latitude: number, longitude: number, text: string, kind: 'town' | 'water' | 'island' | 'airport']
const places = {
    hurghada: [
        [27.2522, 33.8141, 'Хургада', 'town'], [27.128, 33.922, 'Красное море', 'water'],
        [27.227, 33.952, 'Гифтун', 'island'],
        [27.1783, 33.7995, 'Аэропорт HRG', 'airport'],
    ],
    phuket: [
        [7.88, 98.391, 'Пхукет', 'town'], [7.858, 98.23, 'Андаманское море', 'water'],
        [7.82, 98.305, 'Ката', 'town'], [7.896, 98.296, 'Патонг', 'town'],
    ],
    paphos: [
        [34.779, 32.427, 'Пафос', 'town'], [34.751, 32.333, 'Средиземное море', 'water'],
        [34.857, 32.37, 'Корал-Бей', 'town'], [34.719, 32.484, 'Аэропорт PFO', 'airport'],
    ],
} satisfies Record<tAtlasKey, Place[]>

export function drawAtlas(map: L.Map, key: tAtlasKey) {
    const group = L.layerGroup().addTo(map)
    for (const land of shores[key]) {
        L.polygon(land, {pane: 'atlas', interactive: false, className: 'atlas-land', smoothFactor: 0.4,
            color: '#8ea992', weight: 1.1, fillColor: '#e8e8d5', fillOpacity: 1}).addTo(group)
    }
    const {urban, roads} = settlements[key]
    for (const area of urban) {
        L.polygon(area, {pane: 'atlas', interactive: false, stroke: false,
            fillColor: '#d7cfb7', fillOpacity: 0.65}).addTo(group)
    }
    for (const road of roads) {
        L.polyline(road, {pane: 'atlas', interactive: false, color: '#c2ac87', weight: 3.3}).addTo(group)
        L.polyline(road, {pane: 'atlas', interactive: false, color: '#fff7dc', weight: 1.7}).addTo(group)
    }
    for (const [latitude, longitude, name, kind] of places[key]) {
        const text = document.createElement('span')
        text.textContent = name
        L.marker([latitude, longitude], {
            pane: 'atlasPlaces', interactive: false, keyboard: false,
            icon: L.divIcon({html: text, className: 'hotel-map__place place-' + kind, iconSize: [0, 0]}),
        }).addTo(group)
    }
    return group
}

export function fitHotelPoints(
    map: L.Map, destination: Pick<Destination, 'latitude' | 'longitude'>,
    hotels: readonly Pick<MapHotel, 'latitude' | 'longitude'>[],
) {
    if (!hotels.length) {
        map.setView([destination.latitude, destination.longitude], 12, {animate: false})
        return
    }
    const positions = hotels.map(hotel => L.latLng(hotel.latitude, hotel.longitude))
    map.fitBounds(L.latLngBounds(positions), {
        maxZoom: 14, paddingTopLeft: [74, 45], paddingBottomRight: [74, 46], animate: false,
    })
}

// == Метка отеля и ряды цен ==

function priceGraph(hotel: MapHotel, dates: readonly string[]) {
    const graph = document.createElementNS(svgNS, 'svg')
    graph.setAttribute('viewBox', '0 0 100 14')
    graph.setAttribute('aria-hidden', 'true')
    graph.setAttribute('class', 'atlas-spark')
    const values = hotel.prices.filter((value): value is number => value != null)
    if (!values.length) return graph
    const low = Math.min(...values)
    const high = Math.max(...values)
    const path = document.createElementNS(svgNS, 'path')
    graph.append(path)
    let connected = false
    let stroke = ''
    hotel.prices.forEach((value, index) => {
        if (value == null) {
            connected = false
            return
        }
        const x = dates.length > 1 ? 2 + 96 * index / (dates.length - 1) : 50
        const y = high == low ? 7 : 12 - 10 * (value - low) / (high - low)
        stroke += (connected ? ' L ' : ' M ') + x.toFixed(2) + ' ' + y.toFixed(2)
        connected = true
        const dot = document.createElementNS(svgNS, 'circle')
        dot.setAttribute('cx', String(x))
        dot.setAttribute('cy', String(y))
        dot.setAttribute('r', '1.6')
        const title = document.createElementNS(svgNS, 'title')
        title.textContent = dates[index] + ' · ' + money(value)
        dot.append(title)
        graph.append(dot)
    })
    path.setAttribute('d', stroke)
    return graph
}

interface HotelLayer {
    hotel: MapHotel
    marker: L.Marker
    outline: L.Polygon
    dot: L.CircleMarker
    leader: L.Polyline
    card: HTMLDivElement
}

function addHotel(map: L.Map, group: L.LayerGroup, hotel: MapHotel, dates: readonly string[], select: () => void): HotelLayer {
    const center = L.latLng(hotel.latitude, hotel.longitude)
    const outline = L.polygon(hotel.outline.map(([lat, lng]) => L.latLng(lat, lng)), {
        className: 'atlas-territory', smoothFactor: 0, fillOpacity: 0.38, color: '#4a705c', weight: 1.6,
        bubblingMouseEvents: false,
    }).on('click', select).addTo(group)
    const leader = L.polyline([], {color: '#667d6b', weight: 1.2, interactive: false}).addTo(group)
    const dot = L.circleMarker(center, {radius: 3.5, color: '#fffef5', fillColor: '#33604e',
        weight: 1.5, fillOpacity: 1, interactive: false}).addTo(group)
    const card = document.createElement('div')
    card.className = 'atlas-pin'
    const name = document.createElement('strong')
    name.textContent = hotel.name
    const range = document.createElement('span')
    range.className = 'atlas-pin__rate'
    const singlePrice = dates.length == 1 || hotel.minTotal == hotel.maxTotal
    range.textContent = singlePrice ? money(hotel.minTotal)
        : euros.format(hotel.minTotal / 100) + '–' + money(hotel.maxTotal)
    card.append(name, range, priceGraph(hotel, dates))
    const title = hotel.name + ', ' + range.textContent + ' за всю группу'
    const marker = L.marker(center, {title, alt: title, keyboard: true, autoPanOnFocus: false,
        icon: L.divIcon({className: 'hotel-map__marker', html: card, iconSize: [0, 0]})}).addTo(group)
    marker.on('click', select)
    const node = marker.getElement()
    node?.setAttribute('aria-label', title)
    node?.addEventListener('keydown', event => {
        if (event.key == ' ') {
            event.preventDefault()
            select()
        }
    })
    return {hotel, outline, marker, leader, dot, card}
}

interface CardBox {
    x: number
    y: number
    width: number
    height: number
}

function overlap(a: CardBox, b: CardBox) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
}

// Price labels can move around a crowded area. The leader always ends at the
// real coordinate, so selecting a card or its territory refers to the same hotel.
function arrangeLabels(map: L.Map, layers: HotelLayer[]) {
    const size = map.getSize()
    const occupied: CardBox[] = []
    if (size.x < 220 || size.y < 190) return
    const onScreen = layers.filter(layer => map.getBounds().contains(layer.marker.getLatLng()))
    onScreen.sort((a, b) => b.hotel.latitude - a.hotel.latitude)
    for (const [index, layer] of onScreen.entries()) {
        const anchor = map.latLngToContainerPoint(layer.marker.getLatLng())
        const width = layer.card.offsetWidth || 121
        const height = layer.card.offsetHeight || 60
        const offsets = index % 2 == 0 ? [9, -width - 9] : [-width - 9, 9]
        const options: CardBox[] = []
        for (const x of offsets) {
            for (const shift of [0, -height * 0.55, height * 0.55, -height, height]) {
                options.push({
                    x: Math.min(size.x - width - 5, Math.max(5, anchor.x + x)),
                    y: Math.min(size.y - height - 24, Math.max(43, anchor.y - height / 2 + shift)),
                    width, height,
                })
            }
        }
        const score = (box: CardBox) => occupied.reduce((sum, other) => sum + overlap(box, other), 0)
        let box = options[0]
        for (const option of options) if (score(option) < score(box)) box = option
        occupied.push(box)
        layer.card.style.transform = 'translate(' + (box.x - anchor.x) + 'px,' + (box.y - anchor.y) + 'px)'
        const endpoint = L.point(Math.max(box.x, Math.min(anchor.x, box.x + width)),
            Math.max(box.y, Math.min(anchor.y, box.y + height)))
        layer.leader.setLatLngs([layer.marker.getLatLng(), map.containerPointToLatLng(endpoint)])
    }
}

// == Жизненный цикл карты ==

export function HotelMap({hotels, dates, destination, selectedId, onSelect}: HotelMapProps) {
    const host = useRef<HTMLDivElement>(null)
    const instance = useRef<L.Map | null>(null)
    const layers = useRef<HotelLayer[]>([])
    const selectRef = useRef(onSelect)
    const fitKey = useRef('')
    const [detailed, setDetailed] = useState(false)
    const [tileError, setTileError] = useState(false)
    useEffect(() => { selectRef.current = onSelect }, [onSelect])

    useEffect(() => {
        if (!host.current) return
        const map = L.map(host.current, {minZoom: 10, maxZoom: 18, zoomSnap: 0.25, zoomDelta: 1,
            zoomControl: false, scrollWheelZoom: false, maxBoundsViscosity: 1})
        instance.current = map
        map.createPane('atlas').style.zIndex = '170'
        map.createPane('atlasPlaces').style.zIndex = '180'
        map.attributionControl.setPrefix(false)
        map.attributionControl.addAttribution('<a href="https://www.naturalearthdata.com/">Natural Earth</a>')
        L.control.zoom({position: 'bottomleft', zoomInTitle: 'Увеличить', zoomOutTitle: 'Уменьшить'}).addTo(map)
        L.control.scale({imperial: false, position: 'bottomright', maxWidth: 65}).addTo(map)
        const arrange = () => arrangeLabels(map, layers.current)
        map.on('moveend zoomend resize', arrange)
        const observer = new ResizeObserver(() => map.invalidateSize({pan: false}))
        observer.observe(host.current)
        return () => {
            observer.disconnect()
            map.off('moveend zoomend resize', arrange)
            map.remove()
            layers.current = []
            instance.current = null
            fitKey.current = ''
        }
    }, [])

    const {id, name, latitude, longitude} = destination
    useEffect(() => {
        const map = instance.current
        if (!map) return
        const center = L.latLng(latitude, longitude)
        map.setMaxBounds(center.toBounds(51000))
        const atlas = drawAtlas(map, id)
        return () => { atlas.remove() }
    }, [id, name, latitude, longitude])

    useEffect(() => {
        const map = instance.current
        if (!map) return
        setTileError(false)
        if (!detailed) return
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 18, keepBuffer: 0, referrerPolicy: 'strict-origin-when-cross-origin',
        })
        const loading = () => setTileError(false)
        const missing = () => setTileError(true)
        tiles.on('loading', loading).on('tileerror', missing).addTo(map)
        return () => {
            tiles.off('loading', loading).off('tileerror', missing)
            tiles.remove()
        }
    }, [detailed])

    useEffect(() => {
        const map = instance.current
        if (!map) return
        const key = id + '/' + hotels.map(hotel => hotel.id).sort().join('/')
        if (key != fitKey.current) {
            fitKey.current = key
            fitHotelPoints(map, {latitude, longitude}, hotels)
        }
        const group = L.layerGroup().addTo(map)
        const created = hotels.map(hotel => addHotel(map, group, hotel, dates, () => selectRef.current(hotel.id)))
        layers.current = created
        arrangeLabels(map, created)
        return () => {
            layers.current = []
            group.remove()
        }
    }, [hotels, dates, id, name, latitude, longitude])

    useEffect(() => {
        const map = instance.current
        for (const layer of layers.current) {
            const active = layer.hotel.id == selectedId
            layer.marker.setZIndexOffset(active ? 1000 : 0)
            layer.marker.getElement()?.classList.toggle('is-selected', active)
            layer.marker.getElement()?.setAttribute('aria-pressed', String(active))
            const territory = active ? {fillColor: '#ca8843', color: '#a46529'} : {fillColor: '#79a285', color: '#4a705c'}
            layer.outline.setStyle(territory)
            layer.dot.setStyle({fillColor: active ? '#945121' : '#33604e'})
            if (active && map && !map.getBounds().pad(-0.1).contains(layer.marker.getLatLng())) {
                map.panTo(layer.marker.getLatLng(), {animate: false})
            }
        }
    }, [selectedId, hotels, dates])

    return <section className="hotel-map" aria-label={'Карта отелей · ' + name}>
        <div className="hotel-map__canvas" ref={host} aria-label="Карта, стрелки для перемещения" />
        <div className="hotel-map__tools">
            <button type="button" aria-label="Подробная карта" aria-pressed={detailed} onClick={() => setDetailed(value => !value)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m1.5 5 6.5-3.4L14.5 5 8 8.4zM1.5 8.1 8 11.5l6.5-3.4M1.5 11.3l6.5 3.4 6.5-3.4"/></svg>
                Подробная карта
            </button>
            <button type="button" title="Показать все отели" aria-label="Показать все отели"
                onClick={() => instance.current && fitHotelPoints(instance.current, destination, hotels)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m4 0h4v-4"/><circle cx="8" cy="8" r="2"/></svg>
            </button>
        </div>
        <span className="hotel-map__north" title="Север" aria-hidden="true">
            <b>С</b>
            <svg viewBox="0 0 18 24">
                <path d="m9 1 7 20-7-5z" fill="#284e43"/>
                <path d="M9 1 2 21l7-5z" fill="#a7b9a5"/>
            </svg>
        </span>
        {detailed && tileError && <small className="hotel-map__notice" role="status">Часть карты показана схематично</small>}
        {!hotels.length && <p className="hotel-map__empty" role="status">В выбранном диапазоне отелей нет.</p>}
        <span className="hotel-map__legend">Условные территории отелей</span>
    </section>
}
