export interface MapCardOffset {x: number, y: number}
export interface MapCardBox extends MapCardOffset {width: number, height: number}

function between(value: number, low: number, high: number) {
    return Math.max(low, Math.min(high, value))
}

export function clampMapCardOffset(deps: {
    box: MapCardBox
    viewport: {width: number, height: number}
    offset: MapCardOffset
}) {
    const {box, viewport, offset} = deps
    const top = viewport.width <= 720 ? 110 : 70
    const right = Math.max(8, viewport.width - box.width - 8)
    const bottom = Math.max(top, viewport.height - box.height - 16)
    return {
        x: between(box.x + offset.x, 8, right) - box.x,
        y: between(box.y + offset.y, top, bottom) - box.y,
    }
}

export function mapCardEdgePoint(deps: {anchor: MapCardOffset, box: MapCardBox}) {
    const {anchor, box} = deps
    const right = box.x + box.width
    const bottom = box.y + box.height
    const x = between(anchor.x, box.x, right)
    const y = between(anchor.y, box.y, bottom)
    const outside = x != anchor.x || y != anchor.y
    if (outside) return {x, y}
    const edges = [
        {x, y: box.y, distance: anchor.y - box.y},
        {x, y: bottom, distance: bottom - anchor.y},
        {x: box.x, y, distance: anchor.x - box.x},
        {x: right, y, distance: right - anchor.x},
    ]
    const nearest = edges.reduce((best, edge) => edge.distance < best.distance ? edge : best)
    return {x: nearest.x, y: nearest.y}
}
