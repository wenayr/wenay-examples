import React, {useEffect, useRef, useState} from 'react'
import {canPlan, type ScheduleProps} from './schedule-contracts'
import {ScheduleWeek} from './schedule-week'
import {ScheduleDay} from './schedule-day'
import {dayLabel, durationLabel, localDate, shiftDate, timeLabel, validScheduleDate, weekOf} from './schedule-math'
import type {WorkTask} from './model'
import './schedule.css'

type PlanDraft = {id: string, revision: number, assignee: string, date: string, startMinute: number, durationMinutes: number}

export function Schedule(props: ScheduleProps) {
    const {value, allPeople, tasks, busy, ready, generation, run, edit} = props
    const [date, setDate] = useState(localDate)
    const [mode, setMode] = useState<'week' | 'day'>('week')
    const [from, setFrom] = useState(480)
    const [to, setTo] = useState(1200)
    const [zoom, setZoom] = useState(100)
    const [settings, setSettings] = useState(false)
    const [draft, setDraft] = useState<PlanDraft | null>(null)
    const [notice, setNotice] = useState('')
    const inspectorElement = useRef<HTMLElement>(null)
    const week = weekOf(date)
    const dates = [...new Set(Array.from({length: 7}, (_, index) => shiftDate(week, index)))]
    const current = draft ? value.tasks[draft.id] : null
    const stale = !!current && current.revision != draft?.revision
    const editable = !!current && canPlan(value, current)
    const assignees = allPeople.filter(person => value.manage || person.account == value.me)
    const hasAssignee = assignees.some(person => person.account == draft?.assignee)
    const disabled = busy || !ready || !editable || stale
    const saveDisabled = disabled || !hasAssignee || !draft || !validScheduleDate(draft.date)
    const visibleDates = mode == 'week' ? dates : [date]
    const planned = tasks.filter(task => !!task.schedule && visibleDates.includes(task.schedule.date))
    const minutes = planned.reduce((sum, task) => sum + task.schedule!.durationMinutes, 0)
    const unplaced = tasks.filter(task => {
        if (!task.schedule || task.schedule.date != date) return true
        return !value.people.some(person => person.account == task.assignee)
    })

    useEffect(function scopeChanged() {
        setDraft(null)
        setNotice('')
    }, [value.me, generation])

    useEffect(function showInspector() {
        if (!draft) return
        inspectorElement.current?.scrollIntoView({block: 'nearest', inline: 'nearest'})
        inspectorElement.current?.focus({preventScroll: true})
    }, [draft?.id])

    function plan(task: WorkTask) {
        let assignee = task.assignee || value.me
        if (!value.manage) assignee = value.me
        if (!assignees.some(person => person.account == assignee)) assignee = ''
        setDraft({
            id: task.id, revision: task.revision, assignee,
            date: task.schedule?.date ?? date,
            startMinute: task.schedule?.startMinute ?? 540,
            durationMinutes: task.schedule?.durationMinutes ?? 60
        })
        setNotice('')
    }
    async function save(event: React.FormEvent) {
        event.preventDefault()
        if (!draft || saveDisabled) return
        const ok = await run('workScheduleTask', draft)
        if (ok) {
            setDraft(null)
            setNotice('План сохранён и виден команде.')
        }
    }
    async function unschedule() {
        if (!draft || disabled) return
        const ok = await run('workScheduleTask', {...draft, date: ''})
        if (ok) {
            setDraft(null)
            setNotice('Интервал снят. Задача и срок сохранены.')
        }
    }
    function navigate(direction: number) {
        setDate(shiftDate(date, direction * (mode == 'week' ? 7 : 1)))
    }
    function openDay(next: string) {
        if (!validScheduleDate(next)) return
        setDate(next)
        setMode('day')
    }
    function selectDate(next: string) {
        if (validScheduleDate(next)) setDate(next)
    }
    function minuteOf(time: string) {
        const [hours, minutes] = time.split(':').map(Number)
        return hours * 60 + minutes
    }
    const settingsPanel = settings && <fieldset className="plan-settings">
        <legend>Настройка вида</legend>
        <label>Начало шкалы
            <select value={from} onChange={event => setFrom(Number(event.target.value))}>
                {[0, 360, 480, 540, 600].filter(value => value < to).map(value => (
                    <option key={value} value={value}>{timeLabel(value)}</option>
                ))}
            </select>
        </label>
        <label>Конец шкалы
            <select value={to} onChange={event => setTo(Number(event.target.value))}>
                {[960, 1080, 1200, 1320, 1440].filter(value => value > from).map(value => (
                    <option key={value} value={value}>{timeLabel(value)}</option>
                ))}
            </select>
        </label>
        <label>Масштаб дня
            <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>
                <option value={70}>Компактно</option><option value={100}>Обычно</option><option value={150}>Крупно</option>
            </select>
        </label>
        <p>Меняется только представление. Переносы времени выполняются с шагом 15 минут.</p>
    </fieldset>

    const inspector = draft && current && <aside ref={inspectorElement} tabIndex={-1}
        className="plan-inspector" aria-label="Планирование задачи">
        <div className="plan-inspector-title">
            <small>ПЛАН РАБОТЫ</small>
            <button onClick={function close() {setDraft(null)}} aria-label="Закрыть планирование">×</button>
        </div>
        <h3>{current.title}</h3>
        <p>{current.due ? 'Срок задачи: ' + dayLabel(current.due) : 'Срок задачи не задан'}. Интервал не меняет срок.</p>
        {!editable && <p>{current.automatic ? 'Эта задача управляется своим источником.' : 'Завершённая или чужая задача: только просмотр.'}</p>}
        {stale && <p role="alert">Задача изменилась. Откройте актуальный план перед сохранением.
            <button onClick={function refresh() {plan(current)}}>Обновить план</button>
        </p>}
        <form onSubmit={save}>
            <fieldset disabled={disabled}>
                <label>Исполнитель плана
                    <select required value={draft.assignee} onChange={event => setDraft({...draft, assignee: event.target.value})}>
                        <option value="">Выберите сотрудника</option>
                        {assignees.map(person => (
                            <option key={person.account} value={person.account}>{person.name}</option>
                        ))}
                    </select>
                </label>
                <label>Дата работы
                    <input type="date" required value={draft.date}
                        onChange={function planDate(event) {
                            const next = event.target.value
                            if (!next || validScheduleDate(next)) setDraft({...draft, date: next})
                        }}/>
                </label>
                <div className="plan-time-fields">
                    <label>Начало работы
                        <input type="time" required step={900} value={timeLabel(draft.startMinute)}
                            onChange={function start(event) {
                                if (event.target.value) setDraft({...draft, startMinute: minuteOf(event.target.value)})
                            }}/>
                    </label>
                    <label>Длительность, минут
                        <input type="number" required min={15} max={720} step={15} value={draft.durationMinutes}
                            onChange={event => setDraft({...draft, durationMinutes: Number(event.target.value)})}/>
                    </label>
                </div>
                <p>До {timeLabel(draft.startMinute + draft.durationMinutes)} · {durationLabel(draft.durationMinutes)}</p>
                {!hasAssignee && <p>Выберите доступного исполнителя для сохранения плана.</p>}
                <button className="primary" disabled={saveDisabled}>Сохранить план</button>
                {current.schedule && <button type="button" onClick={unschedule}>Снять с графика</button>}
            </fieldset>
        </form>
        <button disabled={busy || !editable} onClick={function openTask() {edit(current)}}>Изменить саму задачу</button>
    </aside>

    const common = {...props, plan}
    const dayBacklog = <aside className="plan-backlog" aria-label="Задачи вне показанного дня">
        <h3>Вне этого дня <span>{unplaced.length}</span></h3>
        <p>Задачи без интервала, на другой дате или без строки исполнителя. Нажмите название, чтобы настроить план.</p>
        <div className="plan-backlog-items" data-empty="Все задачи размещены в этом дне">
            {unplaced.map(task => <article key={task.id} className={'plan-card ' + task.status}>
                <button className="plan-card-title" onClick={() => plan(task)}>{task.title}</button>
                <small>{task.schedule ? dayLabel(task.schedule.date) + ' · ' + timeLabel(task.schedule.startMinute) : 'Без интервала'}</small>
                <small>{allPeople.find(person => person.account == task.assignee)?.name ?? 'Нужно назначить сотрудника'}</small>
                {!canPlan(value, task) && <small>{task.automatic ? 'Следует источнику' : 'Только просмотр'}</small>}
            </article>)}
        </div>
    </aside>
    return <section className="plan" aria-label="График работ">
        <div className="plan-title">
            <div><small>ВРЕМЯ ДЛЯ ГЛАВНОГО</small><h2>План команды</h2>
                <p>Сотрудники, задачи и время — на одной поверхности.</p></div>
            <div className="plan-total"><strong>{durationLabel(minutes)}</strong><span>{planned.length} задач в плане</span></div>
        </div>
        <div className="plan-toolbar">
            <div className="plan-mode">
                <button aria-pressed={mode == 'week'} onClick={() => setMode('week')}>Неделя</button>
                <button aria-pressed={mode == 'day'} onClick={() => setMode('day')}>День</button>
            </div>
            <button aria-label="Предыдущий период" onClick={() => navigate(-1)}>←</button>
            <button onClick={() => setDate(localDate())}>Сегодня</button>
            <button aria-label="Следующий период" onClick={() => navigate(1)}>→</button>
            <label className="plan-date">Дата календаря
                <input type="date" value={date} onChange={event => selectDate(event.target.value)}/>
            </label>
            <strong>{mode == 'week' ? dayLabel(dates[0]) + ' — ' + dayLabel(dates[6]) : dayLabel(date)}</strong>
            <button aria-expanded={settings} onClick={() => setSettings(!settings)}>Настройка вида</button>
        </div>
        {settingsPanel}
        <p className="plan-help">Переносите за ⋮⋮. На ручке: Пробел — взять, стрелки — переместить, Enter — сохранить, Escape — отменить.
            Для точного времени нажмите название задачи. Даты и часы — календарный план команды.</p>
        <div className={'plan-content' + (inspector ? ' with-inspector' : '')}>
            <div className="plan-surface">
                {mode == 'week' ? <ScheduleWeek {...common} dates={dates} openDay={openDay}/>
                    : <div className="plan-week-layout">
                        <ScheduleDay {...common} date={date} from={from} to={to} step={15} pixelsPerHour={zoom}/>
                        {dayBacklog}
                    </div>}
            </div>
            {inspector}
        </div>
        {notice && <p role="status" className="plan-live">{notice}</p>}
    </section>
}
