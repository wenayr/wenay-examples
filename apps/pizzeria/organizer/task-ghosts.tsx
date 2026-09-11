import React, {useLayoutEffect, useState, type RefObject} from 'react'
import {createPortal} from 'react-dom'
import type {BoardParticipant} from './collaboration-model'
import type {WorkView} from './model'
import {personColor} from './collaboration'

// Portals preserve useReorderBoard's one DOM child per registered item contract.
export function TaskGhosts({participants, root, value}: {participants: BoardParticipant[], root: RefObject<HTMLDivElement | null>, value: WorkView}) {
    const [boxes, setBoxes] = useState<{person: BoardParticipant, left: number, top: number, width: number, markerLeft: number, markerTop: number, markerWidth: number}[]>([])
    useLayoutEffect(function measure() {
        const board = root.current
        if (!board) return
        function update() {
            const cards = [...board!.querySelectorAll<HTMLElement>('[data-work-task]')]
            const lanes = [...board!.querySelectorAll<HTMLElement>('[data-work-column]')]
            const bounds = board!.getBoundingClientRect()
            setBoxes(participants.flatMap(person => {
                const drag = person.drag
                if (drag?.kind != 'task' || value.tasks[drag.id]?.revision != drag.revision) return []
                const source = cards.find(card => card.dataset.workTask == drag.id)?.getBoundingClientRect()
                const lane = lanes.find(lane => lane.dataset.workColumn == drag.col)
                if (!source || !lane) return []
                const target = lane.getBoundingClientRect()
                const anchor = cards.find(card => card.dataset.workTask == drag.before)?.getBoundingClientRect()
                const last = [...lane.children].filter(child => (child as HTMLElement).dataset.workTask != drag.id).at(-1)?.getBoundingClientRect()
                const left = Math.max(bounds.left, Math.min(bounds.right - source.width, source.left + drag.x * source.width))
                const top = Math.max(Math.max(0, bounds.top), Math.min(Math.min(window.innerHeight, bounds.bottom) - 80, source.top + drag.y * source.height))
                const markerTop = Math.max(target.top, Math.min(target.bottom - 4, anchor?.top ?? last?.bottom ?? target.top + 10))
                if (target.right < bounds.left || target.left > bounds.right || bounds.bottom < 0 || bounds.top > window.innerHeight) return []
                return [{person, left, top, width: Math.min(source.width, 290), markerLeft: Math.max(bounds.left, target.left), markerTop, markerWidth: Math.min(target.width, bounds.width)}]
            }))
        }
        update()
        board.addEventListener('scroll', update, true)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        const observer = new ResizeObserver(update)
        observer.observe(board)
        return function stop() {board.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); observer.disconnect()}
    }, [participants, root, value])
    return createPortal(<div className="work-foreign-layer" aria-label="Предварительные перемещения">{boxes.map(box => <React.Fragment key={box.person.id}>
        <div className="work-foreign-card" style={{left: box.left, top: box.top, width: box.width, borderColor: personColor(box.person.id)}}><small>{box.person.name} перемещает</small><strong>{value.tasks[box.person.drag!.id]?.title}</strong><span>Предварительное положение</span></div>
        <div className="work-foreign-slot" style={{left: box.markerLeft, top: box.markerTop, width: box.markerWidth, background: personColor(box.person.id)}}/>
    </React.Fragment>)}</div>, document.body)
}
