import React, {useEffect, useRef, useState} from 'react'
import {useDraggableApi, type Position} from 'wenay-react2/react'
import type {WorkTask} from './model'
import {canPlan, type ScheduleDayProps} from './schedule-contracts'
import {timeLabel as clock} from './schedule-math'
import './schedule-day.css'

function interval(task: WorkTask) {
    const schedule = task.schedule!
    return clock(schedule.startMinute) + '–' + clock(schedule.startMinute + schedule.durationMinutes)
}

function layout(tasks: WorkTask[]) {
    const ends: number[] = []
    const sorted = [...tasks].sort((a, b) => a.schedule!.startMinute - b.schedule!.startMinute || a.id.localeCompare(b.id))
    const cards = sorted.map(function place(task) {
        const start = task.schedule!.startMinute
        const end = start + task.schedule!.durationMinutes
        let lane = ends.findIndex(value => value <= start)
        if (lane < 0) lane = ends.length
        ends[lane] = end
        const overlap = tasks.some(other => other.id != task.id && other.schedule!.startMinute < end
            && other.schedule!.startMinute + other.schedule!.durationMinutes > start)
        return {task, lane, overlap}
    })
    return {cards, height: Math.max(1, ends.length) * 64 + 12}
}

export function ScheduleDay(props: ScheduleDayProps) {
    const board = useRef<HTMLDivElement>(null)
    const scale = props.pixelsPerHour / 60
    const width = (props.to - props.from) * scale
    const ticks: number[] = []
    for (let minute = Math.ceil(props.from / 60) * 60; minute <= props.to; minute += 60) ticks.push(minute)
    const tasks = props.tasks.filter(task => task.schedule?.date == props.date)
    return <div className="schedule-day" ref={board}>
        <p className="schedule-day-help">Перенос: ручка, пробел → стрелки → Enter. Escape отменяет. Shift — четыре шага.</p>
        <div className="schedule-day-scroll">
            <div className="schedule-day-axis" style={{width: `calc(${width}px + var(--day-person-width, 180px))`}}>
                <span className="schedule-day-person">Сотрудник</span>
                <div className="schedule-day-hours" style={{width}}>
                    {ticks.map(minute => <span key={minute} style={{left: (minute - props.from) * scale}}>{clock(minute)}</span>)}
                </div>
            </div>
            {props.value.people.map(function personRow(person) {
                const assigned = tasks.filter(task => task.assignee == person.account)
                const visible = assigned.filter(task => task.schedule!.startMinute < props.to
                    && task.schedule!.startMinute + task.schedule!.durationMinutes > props.from)
                const outside = assigned.filter(task => !visible.includes(task))
                const placed = layout(visible)
                return <section className="schedule-day-row" key={person.account} data-schedule-person={person.account}>
                    <header className="schedule-day-person">
                        <strong>{person.name}</strong><small>{assigned.length} задач</small>
                        {placed.cards.some(card => card.overlap) && <span className="schedule-day-warning">Есть пересечения</span>}
                    </header>
                    <div className="schedule-day-track" style={{width, height: placed.height}}>
                        {ticks.map(minute => <i key={minute} style={{left: (minute - props.from) * scale}}/>)}
                        {placed.cards.map(card => <ScheduleCard key={card.task.id} {...props} {...card} board={board}/>)}
                        {!visible.length && <span className="schedule-day-empty">Нет задач в показанном времени</span>}
                        {outside.length > 0 && <div className="schedule-day-outside">
                            {outside.map(task => <button key={task.id}
                                onClick={() => props.plan(task)}>
                                Вне шкалы: {interval(task)} · {task.title}
                            </button>)}
                        </div>}
                    </div>
                </section>
            })}
        </div>
    </div>
}

type CardProps = ScheduleDayProps & {
    task: WorkTask,
    lane: number,
    overlap: boolean,
    board: React.RefObject<HTMLDivElement | null>
}

type Preview = {start: number, assignee: string, y: number}
type Capture = {
    revision: number, scope: string, start: number, duration: number, assignee: string,
    scrollLeft: number, source: {top: number, bottom: number}
}

function ScheduleCard(props: CardProps) {
    const {task, board, value, date, generation, busy, ready} = props
    const schedule = task.schedule!
    const scale = props.pixelsPerHour / 60
    const scope = JSON.stringify([value.me, value.manage, value.people.map(person => person.account),
        date, generation, props.from, props.to, props.step, props.pixelsPerHour])
    const [preview, setPreview] = useState<Preview | null>(null)
    const [waiting, setWaiting] = useState(false)
    const [notice, setNotice] = useState('')
    const capture = useRef<Capture | null>(null)
    const latest = useRef({task, scope, busy, ready})
    latest.current = {task, scope, busy, ready}
    const mounted = useRef(true)
    const target = useRef<Preview | null>(null)
    const canDrag = canPlan(value, task) && (value.manage || task.assignee == value.me)
    const permitted = canDrag && ready && !busy && !waiting

    function rows() {
        return [...(board.current?.querySelectorAll<HTMLElement>('[data-schedule-person]') ?? [])]
    }
    function scrollLeft() {
        return board.current?.querySelector<HTMLElement>('.schedule-day-scroll')?.scrollLeft ?? 0
    }
    function sourceRect(saved: Capture) {
        const source = rows().find(item => item.dataset.schedulePerson == saved.assignee)
        return source?.getBoundingClientRect() ?? saved.source
    }
    function start() {
        const row = rows().find(item => item.dataset.schedulePerson == task.assignee)
        if (!row || !permitted) return
        const rect = row.getBoundingClientRect()
        capture.current = {revision: task.revision, scope, start: schedule.startMinute,
            duration: schedule.durationMinutes, assignee: task.assignee, scrollLeft: scrollLeft(),
            source: {top: rect.top, bottom: rect.bottom}}
        target.current = null
        setNotice('Выберите время и сотрудника')
    }
    function move(position: Position) {
        const saved = capture.current
        if (!saved) return
        const scrollDelta = scrollLeft() - saved.scrollLeft
        const snapped = Math.round((saved.start + (position.x + scrollDelta) / scale) / props.step) * props.step
        const start = Math.max(0, Math.min(1440 - saved.duration, snapped))
        drag.setPosition({x: (start - saved.start) * scale - scrollDelta, y: position.y})
        const source = sourceRect(saved)
        const center = (source.top + source.bottom) / 2
        const row = rows().find(function hit(item) {
            const rect = item.getBoundingClientRect()
            return center + position.y >= rect.top && center + position.y < rect.bottom
        })
        const assignee = value.manage && row ? row.dataset.schedulePerson! : saved.assignee
        const chosen = rows().find(item => item.dataset.schedulePerson == assignee)
        const next = {start, assignee, y: chosen ? chosen.getBoundingClientRect().top - source.top : 0}
        target.current = next
        setPreview(next)
        const person = value.people.find(item => item.account == assignee)
        setNotice((person?.name ?? assignee) + ', ' + clock(start) + '–' + clock(start + saved.duration))
    }
    function cancel() {
        capture.current = null
        target.current = null
        setPreview(null)
        setNotice('Перенос отменён')
    }
    async function commit() {
        const saved = capture.current
        const next = target.current
        capture.current = null
        target.current = null
        setPreview(null)
        if (!saved || !next) return
        const current = latest.current
        const valid = current.scope == saved.scope && current.task.revision == saved.revision && current.ready && !current.busy
        if (!valid || !canPlan(value, current.task)) return
        if (next.start == saved.start && next.assignee == saved.assignee) return
        setWaiting(true)
        setNotice('Сохраняем время задачи…')
        try {
            const ok = await props.run('workScheduleTask', {id: task.id, revision: saved.revision,
                assignee: next.assignee, date, startMinute: next.start, durationMinutes: saved.duration})
            if (mounted.current && latest.current.scope == saved.scope) setNotice(ok ? 'Время задачи сохранено' : 'Перенос не сохранён')
        } catch {
            if (mounted.current && latest.current.scope == saved.scope) setNotice('Перенос не сохранён')
        } finally {
            if (mounted.current) setWaiting(false)
        }
    }
    function finish() {void commit()}
    const drag = useDraggableApi({enabled: permitted, holdMs: 0, keyboard: {step: 15 * scale, multiplier: 4},
        onDragStart: start, onMove: move, onDragEnd: finish, onDragCancel: cancel})

    function keyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
        const vertical = event.key == 'ArrowUp' || event.key == 'ArrowDown'
        if (drag.inputMode != 'keyboard' || !vertical) {
            drag.handleProps.onKeyDown?.(event)
            return
        }
        event.preventDefault()
        const saved = capture.current
        if (!saved) return
        if (!value.manage) {
            setNotice('Сменить сотрудника может менеджер. Стрелки влево и вправо меняют время.')
            return
        }
        const available = rows()
        const account = target.current?.assignee ?? saved.assignee
        const index = available.findIndex(row => row.dataset.schedulePerson == account)
        const direction = event.key == 'ArrowDown' ? 1 : -1
        const multiplier = event.shiftKey ? 4 : 1
        const delta = direction * multiplier
        const row = available[Math.max(0, Math.min(available.length - 1, index + delta))]
        if (!row) return
        const rect = row.getBoundingClientRect()
        const source = sourceRect(saved)
        const center = (source.top + source.bottom) / 2
        const position = {x: drag.getPosition().x, y: (rect.top + rect.bottom) / 2 - center}
        drag.setPosition(position)
        move(position)
    }
    useEffect(function cancelStale() {
        const saved = capture.current
        const changed = saved?.scope != scope || saved?.revision != task.revision
        if (saved && (!permitted || changed)) drag.cancelDrag()
    }, [permitted, scope, task.revision, drag])
    useEffect(function visibility() {
        mounted.current = true
        function hidden() {if (document.hidden) drag.cancelDrag()}
        document.addEventListener('visibilitychange', hidden)
        return function close() {
            mounted.current = false
            document.removeEventListener('visibilitychange', hidden)
        }
    }, [drag])

    const shownStart = preview?.start ?? schedule.startMinute
    const shownEnd = shownStart + schedule.durationMinutes
    const left = (Math.max(props.from, shownStart) - props.from) * scale
    const width = Math.max(0, Math.min(props.to, shownEnd) - Math.max(props.from, shownStart)) * scale
    const clipped = shownStart < props.from || shownEnd > props.to
    const classes = [
        'schedule-day-card', task.status,
        props.overlap ? 'overlap' : '',
        preview ? 'preview' : ''
    ].join(' ')
    return <article className={classes} style={{left, width, top: props.lane * 64 + 6, transform: `translateY(${preview?.y ?? 0}px)`}}
        title={task.title + ' · ' + clock(shownStart) + '–' + clock(shownEnd)} aria-busy={waiting} data-schedule-task={task.id}>
        <button {...drag.handleProps} disabled={!permitted} onKeyDown={keyboard}
            className="schedule-day-handle" aria-label={'Перенести ' + task.title}>⠿</button>
        <div className="schedule-day-card-copy">
            <button className="schedule-day-title" onClick={() => props.plan(task)}>{task.title}</button>
            <small>{clock(shownStart)}–{clock(shownEnd)}{clipped ? ' · за шкалой' : ''}</small>
            {props.overlap && <span className="schedule-day-warning">Пересечение задач</span>}
            <button className="schedule-day-plan" onClick={() => props.plan(task)}>{canPlan(value, task) ? 'Настроить' : 'Посмотреть'}</button>
        </div>
        <span className="schedule-day-live" role="status" aria-live="polite">{notice}</span>
    </article>
}
