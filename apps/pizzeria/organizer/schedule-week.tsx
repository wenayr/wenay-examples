import React, {useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useReorderBoard} from 'wenay-react2/react'
import {canPlan, type ScheduleSurfaceProps} from './schedule-contracts'
import {dayLabel, durationLabel, localDate, timeLabel, weekdayLabel} from './schedule-math'
import type {WorkTask} from './model'

type WeekProps = ScheduleSurfaceProps & {dates: string[], openDay: (date: string) => void}

export function ScheduleWeek(props: WeekProps) {
    const {value, tasks, dates, busy, ready, generation, run, plan, openDay} = props
    const surface = useRef<HTMLDivElement>(null)
    const backlog = useRef<HTMLElement>(null)
    const cellElements = useRef(new Map<string, HTMLElement>())
    const grabbed = useRef<{task: WorkTask, scope: string} | null>(null)
    const mounted = useRef(true)
    const [notice, setNotice] = useState('')
    const cells = value.people.flatMap(person => dates.map(date => ({
        key: JSON.stringify([person.account, date]), person, date,
        items: tasks.filter(task => task.assignee == person.account && task.schedule?.date == date).map(task => task.id)
    })))
    const placed = new Set(cells.flatMap(cell => cell.items))
    const unplaced = tasks.filter(task => !placed.has(task.id))
    const destinations = cells.filter(cell => value.manage || cell.person.account == value.me)
    const columns = [{key: 'backlog', items: unplaced.map(task => task.id)}, ...destinations.map(({key, items}) => ({key, items}))]
    const scope = JSON.stringify([tasks.map(task => [task.id, task.revision]), dates,
        value.people.map(person => person.account), value.me, value.manage, generation])
    const latestScope = useRef(scope)
    latestScope.current = scope

    function canDrag(id: string) {
        const available = columns.some(column => column.items.includes(id))
        const enabled = !busy && ready && !!value.tasks[id]
        return available && enabled && canPlan(value, value.tasks[id])
    }

    async function commit(next: typeof columns) {
        const saved = grabbed.current
        if (!saved || saved.scope != scope || !canDrag(saved.task.id)) return
        const task = saved.task
        if (value.tasks[task.id]?.revision != task.revision) return
        const destination = next.find(column => column.items.includes(task.id))
        if (!destination) return
        if (destination?.key == 'backlog' && !placed.has(task.id)) return
        const cell = destinations.find(cell => cell.key == destination.key)
        if (!cell && destination.key != 'backlog') return
        const assignee = cell?.person.account ?? task.assignee
        const date = cell?.date ?? ''
        if (!value.manage && assignee != value.me) {
            setNotice('Другого исполнителя назначает менеджер. Выберите свою строку.')
            return
        }
        if (date == (task.schedule?.date ?? '') && assignee == task.assignee) return
        const ok = await run('workScheduleTask', {
            id: task.id, revision: task.revision, assignee, date,
            startMinute: task.schedule?.startMinute ?? 540,
            durationMinutes: task.schedule?.durationMinutes ?? 60
        })
        if (mounted.current && latestScope.current == saved.scope) {
            setNotice(ok ? 'План обновлён. Время можно уточнить в карточке.' : 'Перенос не сохранён. Показан актуальный план.')
        }
    }
    const board = useReorderBoard({
        columns,
        commit,
        canDrag,
        autoScroll: {edge: 48, maxSpeed: 400, canScroll: element => element == surface.current},
        onDragStart({key}) {
            grabbed.current = {task: {...value.tasks[key]}, scope}
            setNotice('')
        },
        onDragEnd() {grabbed.current = null}
    })
    useEffect(function cancelStaleGesture() {
        if (!grabbed.current) return
        board.cancel()
        grabbed.current = null
        setNotice('Перенос отменён: план, фильтр или соединение изменилось.')
    }, [scope, ready, busy])
    useEffect(function showKeyboardDestination() {
        if (board.inputMode != 'keyboard' || !board.over) return
        const element = board.over.col == 'backlog' ? backlog.current : cellElements.current.get(board.over.col)
        element?.scrollIntoView({block: 'nearest', inline: 'nearest'})
    }, [board.inputMode, board.over?.col])
    useEffect(function visibility() {
        mounted.current = true
        function hidden() {if (document.hidden) board.cancel()}
        document.addEventListener('visibilitychange', hidden)
        return function close() {
            mounted.current = false
            document.removeEventListener('visibilitychange', hidden)
        }
    }, [])

    function card(id: string) {
        const task = value.tasks[id]
        const item = board.item(id)
        const schedule = task.schedule
        const locked = !canPlan(value, task)
        let time = 'Без интервала'
        if (schedule) time = timeLabel(schedule.startMinute) + '–' + timeLabel(schedule.startMinute + schedule.durationMinutes)
        return <article key={id} className={'plan-card ' + task.status + (item.dragging ? ' moving' : '')} style={item.style}>
            <div className="plan-card-top">
                <span>{time}</span>
                <button {...item.handleProps} aria-label={'Переместить задачу ' + task.title} disabled={!canDrag(id)}>
                    ⋮⋮
                </button>
            </div>
            <button className="plan-card-title" onClick={function choose() {plan(task)}}>{task.title}</button>
            {schedule && !placed.has(id) && <small>{dayLabel(schedule.date)} · вне показанной сетки</small>}
            <small>{value.people.find(person => person.account == task.assignee)?.name ?? 'Нужно назначить сотрудника'}</small>
            {locked && <small>{task.automatic ? 'Следует источнику' : 'Только просмотр'}</small>}
        </article>
    }
    function dayLoad(items: string[]) {
        return items.reduce((sum, id) => sum + (value.tasks[id].schedule?.durationMinutes ?? 0), 0)
    }
    function hasOverlap(items: string[]) {
        const intervals = items.map(id => value.tasks[id].schedule!).sort((a, b) => a.startMinute - b.startMinute)
        let end = 0
        for (const interval of intervals) {
            if (interval.startMinute < end) return true
            end = Math.max(end, interval.startMinute + interval.durationMinutes)
        }
        return false
    }
    const over = cells.find(cell => cell.key == board.over?.col)
    let moveText = ''
    if (board.dragKey) moveText = over ? over.person.name + ' · ' + dayLabel(over.date) : 'Убрать интервал из плана'

    return <>
        <div className="plan-week-layout">
            <aside className="plan-backlog" ref={backlog}>
                <h3>Ожидают плана <span>{unplaced.length}</span></h3>
                <p>Без интервала, вне недели или без доступного исполнителя. Перенесите задачу в нужный день.</p>
                <div ref={board.columnRef('backlog')} className="plan-backlog-items" data-empty="Все задачи размещены">
                    {unplaced.map(task => card(task.id))}
                </div>
            </aside>
            <div className="plan-week-scroll" ref={surface} tabIndex={0} aria-label="Неделя по сотрудникам">
                <div className="plan-week-grid">
                    <div className="plan-corner">Команда / день</div>
                    {dates.map(date => <button key={date} className={'plan-day-heading' + (date == localDate() ? ' today' : '')}
                        onClick={function day() {openDay(date)}}>
                        <span>{weekdayLabel(date)}</span><strong>{dayLabel(date)}</strong>
                        <small>Открыть часы →</small>
                    </button>)}
                    {value.people.map(person => <React.Fragment key={person.account}>
                        <div className="plan-person">
                            <span className="plan-avatar">{person.name.slice(0, 1)}</span>
                            <strong>{person.name}</strong>
                            <small>{person.position || 'Сотрудник команды'}</small>
                        </div>
                        {cells.filter(cell => cell.person.account == person.account).map(cell => <section key={cell.key}
                            className={'plan-week-cell' + (board.over?.col == cell.key ? ' target' : '')}
                            ref={function rememberCell(element) {
                                if (element) cellElements.current.set(cell.key, element)
                                else cellElements.current.delete(cell.key)
                            }}
                            aria-label={person.name + ', ' + dayLabel(cell.date)}>
                            <div className="plan-cell-load">
                                <span>{cell.items.length ? durationLabel(dayLoad(cell.items)) : 'Свободно'}</span>
                                {hasOverlap(cell.items) && <span className="plan-overlap">Пересечение</span>}
                            </div>
                            <div ref={board.columnRef(cell.key)} className="plan-cell-items" data-empty="Перенести сюда">
                                {cell.items.map(card)}
                            </div>
                        </section>)}
                    </React.Fragment>)}
                </div>
            </div>
        </div>
        <p className="plan-live" role="status">{moveText || notice}</p>
        {board.overlay && createPortal(<div className="plan-drag-preview" style={board.overlay.style} aria-hidden="true">
            {value.tasks[board.overlay.key]?.title}
        </div>, document.body)}
    </>
}
