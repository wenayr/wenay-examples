import {Icon, iconPaths} from './Icons.tsx'

export const mapCardIcons = {
    interest: 'bookmark',
    like: 'heart',
    priority: 'flag',
    matrix: 'matrix',
    refresh: 'refresh',
    close: 'close',
    move: 'move',
    locate: 'locate',
    settings: 'settings',
    image: 'image',
    source: 'external',
    drag: 'grip',
} as const satisfies Record<string, keyof typeof iconPaths>

export type tMapCardIconName = keyof typeof mapCardIcons

export function createMapCardIcon(name: tMapCardIconName, size = 18) {
    const namespace = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(namespace, 'svg')
    const attributes = {
        width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'aria-hidden': 'true', focusable: 'false', class: 'map-card-icon',
    }
    Object.entries(attributes).forEach(([key, value]) => svg.setAttribute(key, value))
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', iconPaths[mapCardIcons[name]])
    svg.append(path)
    return svg
}

export function MapCardIcon({name, size = 18}: {name: tMapCardIconName, size?: number}) {
    return <Icon name={mapCardIcons[name]} size={size}/>
}
