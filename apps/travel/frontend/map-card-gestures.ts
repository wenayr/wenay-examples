export type tMapCardDragSurface = 'handle' | 'photo'

export interface MapCardPointer {
    pointerType: string
    isPrimary: boolean
    button: number
}

export interface MapCardPoint {
    x: number
    y: number
}

export function acceptsMapCardDrag(pointer: MapCardPointer, surface: tMapCardDragSurface) {
    if (!pointer.isPrimary || pointer.button != 0) return false
    return surface == 'handle' || pointer.pointerType == 'mouse'
}

export function acceptsMapPhotoSwipe(pointer: MapCardPointer) {
    return pointer.pointerType == 'touch' && pointer.isPrimary && pointer.button == 0
}

export function movedMapCard(start: MapCardPoint, current: MapCardPoint) {
    return Math.hypot(current.x - start.x, current.y - start.y) >= 4
}

export function photoSwipeDirection(start: MapCardPoint, current: MapCardPoint) {
    const horizontal = current.x - start.x
    const vertical = current.y - start.y
    if (Math.abs(horizontal) < 32 || Math.abs(horizontal) <= Math.abs(vertical) * 1.2) return null
    return horizontal < 0 ? 1 : -1
}
