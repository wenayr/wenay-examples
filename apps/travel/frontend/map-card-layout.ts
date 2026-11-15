import * as L from 'leaflet'
import {clampMapCardOffset, mapCardEdgePoint, type MapCardOffset} from './map-card-geometry.ts'
import {acceptsMapCardDrag, acceptsMapPhotoSwipe, movedMapCard, type tMapCardDragSurface} from './map-card-gestures.ts'

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
        id: number, x: number, y: number, initial: MapCardOffset, moved: boolean, restoreDragging: boolean,
        capture: HTMLElement, active: boolean, movable: boolean,
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
        if (cancelled && !destroyed && active.movable) apply(active.initial)
        if (active.capture.hasPointerCapture(active.id)) active.capture.releasePointerCapture(active.id)
        if (active.restoreDragging) map.dragging.enable()
        handle.classList.remove('is-dragging')
        card.classList.remove('is-dragging')
        if (!destroyed && active.movable) deps.onOffset({...offset})
        deps.onDragging(false)
    }

    function activateDrag() {
        if (!gesture || gesture.active) return
        gesture.active = true
        gesture.restoreDragging = map.dragging.enabled()
        map.dragging.disable()
        handle.classList.add('is-dragging')
        card.classList.add('is-dragging')
    }

    function startGesture(event: PointerEvent) {
        const blocked = destroyed || gesture != null
        const target = event.target instanceof Element ? event.target : null
        const fromHandle = target != null && handle.contains(target)
        const photo = target?.closest<HTMLElement>('[data-photo-interaction="drag"] .map-hotel-card__photo-open')
        const capture = fromHandle ? handle : photo
        const surface: tMapCardDragSurface = fromHandle ? 'handle' : 'photo'
        const movable = acceptsMapCardDrag(event, surface)
        const swipingPhoto = surface == 'photo' && acceptsMapPhotoSwipe(event)
        const accepted = movable || swipingPhoto
        if (blocked || !capture || !accepted) return
        if (movable) {
            event.preventDefault()
            event.stopPropagation()
        }
        gesture = {
            id: event.pointerId, x: event.clientX, y: event.clientY, initial: {...offset},
            moved: false, restoreDragging: false, capture, active: false, movable,
        }
        capture.setPointerCapture(event.pointerId)
        // Price updates must not detach a photo during a mouse candidate or a captured touch swipe.
        deps.onDragging(true)
        if (fromHandle) {
            handle.focus({preventScroll: true})
            activateDrag()
        }
    }

    function moveDrag(event: PointerEvent) {
        if (!gesture || gesture.id != event.pointerId) return
        if (!gesture.movable) return
        event.preventDefault()
        event.stopPropagation()
        const dx = event.clientX - gesture.x
        const dy = event.clientY - gesture.y
        if (movedMapCard(gesture, {x: event.clientX, y: event.clientY})) gesture.moved = true
        if (gesture.moved) {
            activateDrag()
            apply({x: gesture.initial.x + dx, y: gesture.initial.y + dy})
        }
    }

    function endDrag(event: PointerEvent) {
        if (!gesture || gesture.id != event.pointerId) return
        moveDrag(event)
        finish(false)
    }

    function cancelDrag() {
        finish(true)
    }

    function cancelPointer(event: PointerEvent) {
        if (gesture?.id == event.pointerId) cancelDrag()
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
        card.removeEventListener('pointerdown', startGesture)
        card.removeEventListener('pointermove', moveDrag)
        card.removeEventListener('pointerup', endDrag)
        card.removeEventListener('pointercancel', cancelPointer)
        card.removeEventListener('lostpointercapture', cancelPointer)
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
    card.addEventListener('pointerdown', startGesture)
    card.addEventListener('pointermove', moveDrag)
    card.addEventListener('pointerup', endDrag)
    card.addEventListener('pointercancel', cancelPointer)
    card.addEventListener('lostpointercapture', cancelPointer)
    handle.addEventListener('keydown', moveWithKeyboard)
    window.addEventListener('blur', cancelDrag)
    document.addEventListener('visibilitychange', hidden)
    apply(deps.offset ?? offset)

    return {destroy, update, getOffset: () => ({...offset})}
}

export type MapCardLayout = ReturnType<typeof createMapCardLayout>
