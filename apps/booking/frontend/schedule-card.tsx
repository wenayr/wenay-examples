import React, {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Temporal} from '@js-temporal/polyfill'
import {useDraggableApi, type Position} from 'wenay-react2/react'
import type {Booking} from '../backend/model'
import type {BookingWorkspace} from '../backend/domain'
import {clock, statuses, when} from './contracts'
import {positionInDay, scheduleDay, type ScheduleDay} from './schedule-math'
import type {ScheduleAvailability, ScheduleProposal} from './schedule'

type CardProps = {
    booking: Booking, value: BookingWorkspace, day: ScheduleDay, lane: number, selected: boolean,
    select: (id: string) => void, scope: string, surface: React.RefObject<HTMLDivElement | null>,
    availability: ScheduleAvailability[] | null, propose: (next: ScheduleProposal) => void,
    proposal: ScheduleProposal | null, disabled: boolean, zone: string, lanes: number, scale: number
}

type Capture = {
    scope: string, revision: number, rect: DOMRect
}

export function ScheduleCard(props: CardProps) {
    const {booking, value, day, lane, selected, scope, surface, availability, disabled, zone} = props
    const card = useRef<HTMLElement>(null)
    const capture = useRef<Capture | null>(null)
    const next = useRef<ScheduleProposal | null>(null)
    const [preview, setPreview] = useState<ScheduleProposal | null>(null)
    const [notice, setNotice] = useState('')
    const service = value.services.find(item => item.id == booking.serviceId)
    const customer = value.people.find(item => item.account == booking.customer)
    const movable = booking.status == 'confirmed' && booking.start > Date.now()
    const freeSlots = availability?.some(item => item.slots.length > 0)
    const permitted = selected && !disabled && !!freeSlots && movable
    const latest = useRef({scope, revision: booking.revision, permitted})
    latest.current = {scope, revision: booking.revision, permitted}

    function start() {
        if (!card.current || !surface.current) return
        capture.current = {scope, revision: booking.revision, rect: card.current.getBoundingClientRect()}
        next.current = null
        setNotice('Выберите свободный интервал. Отпустите для предпросмотра.')
    }
    function move(position: Position) {
        const saved = capture.current
        const viewport = surface.current
        if (!saved || !viewport || !availability) return
        const x = saved.rect.left + saved.rect.width / 2 + position.x
        const y = saved.rect.top + saved.rect.height / 2 + position.y
        const bounds = viewport.getBoundingClientRect()
        const outsideX = x < bounds.left || x > bounds.right
        const outsideY = y < bounds.top + 100 || y > bounds.bottom
        if (outsideX || outsideY) {
            next.current = null
            setPreview(null)
            setNotice('Перенесите внутрь видимой шкалы времени.')
            return
        }
        const cells = Array.from(viewport.querySelectorAll<HTMLElement>('[data-booking-resource]'))
        const target = cells.find(function contains(cell) {
            const rect = cell.getBoundingClientRect()
            const horizontal = x >= rect.left && x <= rect.right
            const vertical = y >= rect.top && y <= rect.bottom
            return horizontal && vertical
        })
        const resourceId = target?.dataset.bookingResource
        const date = target?.dataset.bookingDay
        if (!target || !resourceId || !date) {
            next.current = null
            setPreview(null)
            setNotice('Перенесите внутрь строки ресурса.')
            return
        }
        const targetAvailability = availability.filter(item => item.resourceId == resourceId)
        const preferred = targetAvailability.find(item => item.serviceId == booking.serviceId) ?? targetAvailability[0]
        if (!preferred) {
            next.current = null
            setPreview(null)
            setNotice('Для этого ресурса нет совместимой услуги.')
            return
        }
        const targetDay = scheduleDay(date, preferred.zone)
        const rect = target.getBoundingClientRect()
        const fraction = (y - saved.rect.height / 2 - rect.top) / rect.height
        const raw = targetDay.start + fraction * (targetDay.end - targetDay.start)
        const choices = targetAvailability.flatMap(item => item.slots.map(slot => ({slot, serviceId: item.serviceId})))
        const slots = choices.filter(item => item.slot.start >= targetDay.start && item.slot.start < targetDay.end)
        const nearest = slots.reduce<typeof slots[number] | null>(function closer(result, candidate) {
            const distance = Math.abs(candidate.slot.start - raw)
            const previous = result ? Math.abs(result.slot.start - raw) : Infinity
            if (distance < previous) return candidate
            if (distance == previous && candidate.serviceId == booking.serviceId) return candidate
            return result
        }, null)
        const closeEnough = nearest && Math.abs(nearest.slot.start - raw) <= 15 * 60000
        if (!nearest || !closeEnough) {
            next.current = null
            setPreview(null)
            setNotice('Здесь нет свободного слота. Свободные начала отмечены зелёным.')
            return
        }
        const proposal = {id: booking.id, revision: saved.revision, serviceId: nearest.serviceId, start: nearest.slot.start}
        next.current = proposal
        setPreview(proposal)
        setNotice('Предпросмотр: ' + when(nearest.slot.start, preferred.zone))
    }
    function cancel() {
        capture.current = null
        next.current = null
        setPreview(null)
        setNotice('Перенос отменён')
    }
    function finish() {
        const saved = capture.current
        const proposal = next.current
        capture.current = null
        next.current = null
        setPreview(null)
        if (!saved || !proposal) return
        const current = latest.current
        const valid = current.permitted && current.scope == saved.scope && current.revision == saved.revision
        if (!valid) return
        if (proposal.start == booking.start && proposal.serviceId == booking.serviceId) return
        props.propose(proposal)
    }
    const drag = useDraggableApi({enabled: permitted, holdMs: 0, keyboard: {step: 15 * props.scale, multiplier: 4},
        onDragStart: start, onMove: move, onDragEnd: finish, onDragCancel: cancel})

    function keyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
        const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
        if (drag.inputMode != 'keyboard' || !arrows) {
            drag.handleProps.onKeyDown?.(event)
            return
        }
        event.preventDefault()
        const saved = capture.current
        const currentService = next.current?.serviceId ?? booking.serviceId
        const matchingService = availability?.find(item => item.serviceId == currentService)
        const matchingResource = availability?.find(item => item.resourceId == booking.resourceId)
        const source = matchingService ?? matchingResource ?? availability?.[0]
        if (!saved || !source) return
        const horizontal = event.key == 'ArrowLeft' || event.key == 'ArrowRight'
        if (horizontal) {
            const cells = Array.from(surface.current?.querySelectorAll<HTMLElement>('[data-booking-resource]') ?? [])
            const resources = [...new Set(cells.map(item => item.dataset.bookingResource))]
            const index = resources.indexOf(source.resourceId)
            const direction = event.key == 'ArrowRight' ? 1 : -1
            const distance = event.shiftKey ? 4 : 1
            const resourceId = resources[Math.max(0, Math.min(resources.length - 1, index + direction * distance))]
            if (!resourceId || resourceId == source.resourceId) {
                setNotice('Дальше нет видимого ресурса. Выбор ресурса также доступен в панели встречи.')
                return
            }
            const currentStart = next.current?.start ?? booking.start
            const currentDate = Temporal.Instant.fromEpochMilliseconds(currentStart).toZonedDateTimeISO(source.zone).toPlainDate().toString()
            const candidates = availability?.filter(item => item.resourceId == resourceId) ?? []
            const allSlots = candidates.flatMap(item => item.slots.map(slot => ({slot, serviceId: item.serviceId})))
            const slots = allSlots.filter(item => item.slot.local.slice(0, 10) == currentDate)
            const closest = slots.sort((a, b) => Math.abs(a.slot.start - currentStart) - Math.abs(b.slot.start - currentStart))[0]
            if (!closest || Math.abs(closest.slot.start - currentStart) > 15 * 60000) {
                setNotice('На соседнем ресурсе нет совместимого свободного интервала рядом с выбранным временем.')
                return
            }
            const proposal = {id: booking.id, revision: saved.revision, serviceId: closest.serviceId, start: closest.slot.start}
            next.current = proposal
            setPreview(proposal)
            setNotice('Предпросмотр ресурса: ' + when(closest.slot.start, source.zone))
            return
        }
        const direction = event.key == 'ArrowLeft' || event.key == 'ArrowUp' ? -1 : 1
        const currentStart = next.current?.start ?? booking.start
        const choices = source.slots.slice().sort((a, b) => a.start - b.start)
        const candidates = choices.filter(item => direction > 0 ? item.start > currentStart : item.start < currentStart)
        const distance = event.shiftKey ? 4 : 1
        let slot = candidates.at(-distance) ?? candidates[0]
        if (direction > 0) slot = candidates[Math.min(distance - 1, candidates.length - 1)]
        if (!slot) {
            setNotice('Дальше нет свободных интервалов в этом периоде.')
            return
        }
        const proposal = {id: booking.id, revision: saved.revision, serviceId: source.serviceId, start: slot.start}
        next.current = proposal
        setPreview(proposal)
        setNotice('Предпросмотр: ' + when(slot.start, source.zone))
    }
    useEffect(function staleGesture() {
        const saved = capture.current
        const changed = saved?.scope != scope || saved?.revision != booking.revision
        if (saved && (!permitted || changed)) drag.cancelDrag()
    }, [permitted, scope, booking.revision, drag])
    useEffect(function visibility() {
        function hidden() {if (document.hidden) drag.cancelDrag()}
        document.addEventListener('visibilitychange', hidden)
        return () => document.removeEventListener('visibilitychange', hidden)
    }, [drag])

    const top = positionInDay(Math.max(day.start, booking.start), day)
    const height = (Math.min(day.end, booking.end) - Math.max(day.start, booking.start)) / 60000 * props.scale
    const previewStart = preview?.start ?? booking.start
    const classes = ['booking-schedule-card', booking.status]
    if (height < 54) classes.push('compact')
    if (selected) classes.push('selected')
    if (preview) classes.push('preview')
    const proposed = props.proposal?.id == booking.id
    let ghost = null
    if (preview && surface.current) {
        const target = availability?.find(item => item.serviceId == preview.serviceId)
        const date = Temporal.Instant.fromEpochMilliseconds(preview.start).toZonedDateTimeISO(target?.zone ?? zone).toPlainDate().toString()
        const cells = Array.from(surface.current.querySelectorAll<HTMLElement>('[data-booking-resource]'))
        const cell = cells.find(item => item.dataset.bookingResource == target?.resourceId && item.dataset.bookingDay == date)
        if (cell) {
            const rect = cell.getBoundingClientRect()
            const targetDay = scheduleDay(date, target?.zone ?? zone)
            ghost = <div className="booking-schedule-ghost" style={{
                left: rect.left + 48, width: Math.max(0, rect.width - 54), height: (booking.end - booking.start) / 60000 * props.scale,
                top: rect.top + positionInDay(preview.start, targetDay) / 100 * rect.height
            }}><strong>{service?.name}</strong><span>{when(previewStart, target?.zone ?? zone)}</span></div>
        }
    }
    const left = `calc(46px + (100% - 50px) * ${lane / props.lanes})`
    const width = `calc((100% - 50px) / ${props.lanes} - 4px)`
    return <><article className={classes.join(' ')} ref={card} style={{left, width, top: top + '%', height}}
        title={when(booking.start, zone) + '–' + clock(booking.end, zone) + ' · ' + statuses[booking.status]}>
        <button className="booking-schedule-handle" {...drag.handleProps} onKeyDown={keyboard}
            disabled={!permitted}
            aria-label={'Перенести ' + (service?.name ?? 'встречу')} title={selected ? 'Перетащить время встречи' : 'Сначала выберите встречу'}>⠿</button>
        <button className="booking-schedule-card-copy" onClick={() => props.select(booking.id)} aria-pressed={selected}
            aria-label={(service?.name ?? 'Встреча') + ' · ' + when(booking.start, zone) + ' · ' + statuses[booking.status]}>
            <strong>{service?.name ?? 'Встреча'}</strong>
            <span>{clock(booking.start, zone)}–{clock(booking.end, zone)} · {customer?.name ?? 'Ваша встреча'}</span>
            <small>{booking.partySize} участн. · {statuses[booking.status]}{proposed ? ' · перенос подготовлен' : ''}</small>
        </button>
        <span className="booking-schedule-card-live" role="status">{notice}</span>
    </article>{ghost && createPortal(ghost, document.body)}</>
}
