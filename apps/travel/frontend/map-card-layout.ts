import * as L from 'leaflet'
import {clampMapCardOffset, mapCardEdgePoint, type MapCardOffset} from './map-card-geometry.ts'

export {clampMapCardOffset, mapCardEdgePoint} from './map-card-geometry.ts'
export type {MapCardBox, MapCardOffset} from './map-card-geometry.ts'

export function createMapCardLayout(deps: {
    map: L.Map
    group: L.LayerGroup
    marker: L.Marker
    card: HTMLElement
    handle: HTMLButtonElement
    offset?: MapCardOffset
    onOffset: (offset: MapCardOffset) => void
    onDragging: (dragging: boolean) => void
}) {
    const {map, group, marker, card, handle} = deps
    const originalTransform = card.style.transform
    const originalTouchAction = handle.style.touchAction
    let offset: MapCardOffset = {x: 0, y: 0}
    let destroyed = false
    let gesture: {
        id: number, x: number, y: number, initial: MapCardOffset, moved: boolean, restoreDragging: boolean
    } | null = null
    const leader = L.polyline([], {
        color: '#446958', weight: 1.5, opacity: 0.85, interactive: false, className: 'map-hotel-card__leader',
    }).addTo(group)
    const anchor = L.circleMarker(marker.getLatLng(), {
        radius: 3.5, color: '#fff', fillColor: '#245a4a', weight: 1.5, fillOpacity: 1,
        interactive: false, className: 'map-hotel-card__anchor',
    }).addTo(group)

    function apply(next: MapCardOffset) {
        if (destroyed) return
        const element = map.getContainer()
        const container = element.getBoundingClientRect()
        const measured = card.getBoundingClientRect()
        const box = {
            x: measured.left - container.left - element.clientLeft - offset.x,
            y: measured.top - container.top - element.clientTop - offset.y,
            width: measured.width,
            height: measured.height,
        }
        const size = map.getSize()
        offset = clampMapCardOffset({box, viewport: {width: size.x, height: size.y}, offset: next})
        card.style.transform = 'translate(' + offset.x + 'px,' + offset.y + 'px)'
        const origin = marker.getLatLng()
        const point = map.latLngToContainerPoint(origin)
        const edge = mapCardEdgePoint({anchor: point, box: {...box, x: box.x + offset.x, y: box.y + offset.y}})
        leader.setLatLngs([origin, map.containerPointToLatLng(L.point(edge.x, edge.y))])
        anchor.setLatLng(origin)
    }

    function finish(cancelled: boolean) {
        const active = gesture
        if (!active) return
        gesture = null
        if (cancelled && !destroyed) apply(active.initial)
        if (handle.hasPointerCapture(active.id)) handle.releasePointerCapture(active.id)
        if (active.restoreDragging) map.dragging.enable()
        handle.classList.remove('is-dragging')
        if (!destroyed) deps.onOffset({...offset})
        deps.onDragging(false)
    }

    function startDrag(event: PointerEvent) {
        const blocked = destroyed || gesture != null
        const accepted = event.isPrimary && event.button == 0
        if (blocked || !accepted) return
        event.preventDefault()
        event.stopPropagation()
        gesture = {
            id: event.pointerId, x: event.clientX, y: event.clientY, initial: {...offset},
            moved: false, restoreDragging: map.dragging.enabled(),
        }
        map.dragging.disable()
        handle.focus({preventScroll: true})
        handle.setPointerCapture(event.pointerId)
        handle.classList.add('is-dragging')
        deps.onDragging(true)
    }

    function moveDrag(event: PointerEvent) {
        if (!gesture || gesture.id != event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        const dx = event.clientX - gesture.x
        const dy = event.clientY - gesture.y
        if (Math.hypot(dx, dy) >= 4) gesture.moved = true
        if (gesture.moved) apply({x: gesture.initial.x + dx, y: gesture.initial.y + dy})
    }

    function endDrag(event: PointerEvent) {
        if (!gesture || gesture.id != event.pointerId) return
        moveDrag(event)
        finish(false)
    }

    function cancelDrag() {
        finish(true)
    }

    function hidden() {
        if (document.hidden) cancelDrag()
    }

    function moveWithKeyboard(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (gesture) {
            if (event.key != 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            cancelDrag()
            return
        }
        const step = event.shiftKey ? 24 : 8
        const directions = {
            ArrowLeft: {x: -step, y: 0}, ArrowRight: {x: step, y: 0},
            ArrowUp: {x: 0, y: -step}, ArrowDown: {x: 0, y: step},
        } as const satisfies Record<string, MapCardOffset>
        if (event.key != 'Home' && !Object.hasOwn(directions, event.key)) return
        event.preventDefault()
        event.stopPropagation()
        if (event.key == 'Home') apply({x: 0, y: 0})
        else {
            const direction = directions[event.key as keyof typeof directions]
            apply({x: offset.x + direction.x, y: offset.y + direction.y})
        }
        deps.onOffset({...offset})
    }

    function update() {
        apply(offset)
    }

    function destroy() {
        if (destroyed) return
        destroyed = true
        handle.removeEventListener('pointerdown', startDrag)
        handle.removeEventListener('pointermove', moveDrag)
        handle.removeEventListener('pointerup', endDrag)
        handle.removeEventListener('pointercancel', cancelDrag)
        handle.removeEventListener('lostpointercapture', cancelDrag)
        handle.removeEventListener('keydown', moveWithKeyboard)
        window.removeEventListener('blur', cancelDrag)
        document.removeEventListener('visibilitychange', hidden)
        group.removeLayer(leader)
        group.removeLayer(anchor)
        card.style.transform = originalTransform
        handle.style.touchAction = originalTouchAction
        finish(true)
    }

    handle.style.touchAction = 'none'
    handle.addEventListener('pointerdown', startDrag)
    handle.addEventListener('pointermove', moveDrag)
    handle.addEventListener('pointerup', endDrag)
    handle.addEventListener('pointercancel', cancelDrag)
    handle.addEventListener('lostpointercapture', cancelDrag)
    handle.addEventListener('keydown', moveWithKeyboard)
    window.addEventListener('blur', cancelDrag)
    document.addEventListener('visibilitychange', hidden)
    apply(deps.offset ?? offset)

    return {destroy, update, getOffset: () => ({...offset})}
}

export type MapCardLayout = ReturnType<typeof createMapCardLayout>
