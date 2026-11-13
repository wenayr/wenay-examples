import React, {useEffect, useRef, useState} from 'react'
import {Temporal} from '@js-temporal/polyfill'
import type {BookingWorkspace} from '../backend/domain'
import type {CalendarRemote} from './calendar'
import {when, type Commands, type Organization} from './contracts'
import {ScheduleCard} from './schedule-card'
import {dateLabel, intervalLanes, positionInDay, scheduleDay, validScheduleDate} from './schedule-math'
import './schedule.css'

export type ScheduleAvailability = Awaited<ReturnType<CalendarRemote['control']['read']>>
export type ScheduleProposal = {id: string, revision: number, serviceId: string, start: number}

type ScheduleProps = {
    value: BookingWorkspace, org: Organization, commands: Commands, remote: CalendarRemote | null | undefined,
    busy: boolean, from: string, days: number, setFrom: (date: string) => void, setDays: (days: number) => void,
    zone: string
}

export function BookingSchedule(props: ScheduleProps) {
    const {value, org, remote, commands, busy, from, days, zone, setFrom, setDays} = props
    const [selected, setSelected] = useState('')
    const [draft, setDraft] = useState<{scope: string, value: ScheduleProposal} | null>(null)
    const [scale, setScale] = useState(1)
    const [shownZone, setShownZone] = useState(zone)
    const [chosenResource, setChosenResource] = useState('')
    const [notice, setNotice] = useState('')
    const [waiting, setWaiting] = useState(false)
    const [refresh, setRefresh] = useState(0)
    const [loaded, setLoaded] = useState<{scope: string, remote: CalendarRemote, values: ScheduleAvailability[]} | null>(null)
    const surface = useRef<HTMLDivElement>(null)
    const inspector = useRef<HTMLElement>(null)
    const selectionTrigger = useRef<HTMLElement | null>(null)
    const previousScale = useRef(scale)
    const intent = useRef<{signature: string, key: string} | null>(null)
    const staff = org.role != 'customer'
    const resources = value.resources.filter(item => item.orgId == org.id)
    const zones = [...new Set(resources.map(item => item.zone))]
    const activeZone = zones.includes(shownZone) ? shownZone : zone
    const zonedResources = resources.filter(item => item.zone == activeZone)
    const activeResource = zonedResources.some(item => item.id == chosenResource) ? chosenResource : ''
    const shownResources = zonedResources.filter(item => !activeResource || item.id == activeResource)
    const visible = value.bookings.filter(function visibleBooking(item) {
        const permitted = staff || item.customer == value.account.account
        return item.orgId == org.id && permitted && ['held', 'confirmed'].includes(item.status)
    })
    const booking = visible.find(item => item.id == selected)
    const selectedService = value.services.find(item => item.id == booking?.serviceId)
    const services = value.services.filter(function compatible(item) {
        if (!booking || !item.active || item.orgId != org.id) return false
        const promised = item.duration == (booking.end - booking.start) / 60000 && item.depositUnits == booking.depositUnits
        if (!promised) return false
        return staff || item.id == booking.serviceId
    })
    const signature = JSON.stringify(visible.map(item => [item.id, item.revision]))
    const catalog = JSON.stringify([resources, services])
    const scope = JSON.stringify([
        org.id, org.role, value.account.account, from, days, activeZone, activeResource, selected, booking?.revision, signature, catalog, refresh
    ])
    const proposal = draft?.scope == scope ? draft.value : null
    const latest = useRef({scope, remote})
    latest.current = {scope, remote}
    const availability = loaded?.scope == scope && loaded.remote == remote ? loaded.values : null
    const timeline = Array.from({length: days}, (_value, index) => scheduleDay(
        Temporal.PlainDate.from(from).add({days: index}).toString(), activeZone
    ))

    useEffect(function readMoveSlots() {
        let active = true
        if (!remote || !booking || booking.status != 'confirmed') {
            setNotice('')
            return
        }
        setNotice('Проверяем свободные интервалы для переноса…')
        const captured = scope
        void Promise.all(services.map(item => remote.control.read({
            orgId: org.id, serviceId: item.id, from, days, partySize: booking.partySize, bookingId: booking.id
        }))).then(function ready(values) {
            if (!active || latest.current.scope != captured || latest.current.remote != remote) return
            setLoaded({scope: captured, remote, values})
            setNotice('Свободные интервалы отмечены. Перетащите ручку или выберите время ниже.')
        }, function failed(error) {
            if (!active || latest.current.scope != captured) return
            setNotice(error instanceof Error ? error.message : 'Не удалось проверить время')
        })
        return () => {active = false}
    }, [scope, remote])

    useEffect(function invalidateProposal() {setProposal(null)}, [scope, remote])
    useEffect(function followServiceZone() {setShownZone(zone)}, [zone])
    useEffect(function resetResourceFilter() {setChosenResource('')}, [activeZone])
    useEffect(function revealSelectedMeeting() {
        if (!booking || !inspector.current) return
        inspector.current.scrollIntoView({block: 'nearest', inline: 'nearest'})
        inspector.current.focus({preventScroll: true})
    }, [booking?.id])
    useEffect(function scrollToDaytime() {
        const viewport = surface.current
        if (!viewport) return
        const first = timeline[0]
        const booked = visible.filter(item => item.start >= first.start && item.start < first.end).sort((a, b) => a.start - b.start)[0]
        let minute = 9 * 60
        const civil = Temporal.PlainDate.from(from)
        const windows = shownResources.flatMap(function working(resource) {
            const exception = resource.exceptions.find(item => item.date == from)
            return exception?.windows ?? resource.weekly.filter(item => item.day == civil.dayOfWeek)
        })
        const earliest = windows.map(item => Temporal.PlainTime.from(item.start)).sort(Temporal.PlainTime.compare)[0]
        if (earliest) {
            const at = civil.toPlainDateTime(earliest).toZonedDateTime(activeZone).epochMilliseconds
            minute = (at - first.start) / 60000
        }
        if (booked) minute = Math.max(0, (booked.start - first.start) / 60000 - 45)
        viewport.scrollTop = minute * scale
    }, [from, days, activeZone])
    useEffect(function keepTimeOnZoom() {
        if (surface.current) surface.current.scrollTop = surface.current.scrollTop / previousScale.current * scale
        previousScale.current = scale
    }, [scale])

    function select(id: string) {
        if (id && document.activeElement instanceof HTMLElement) selectionTrigger.current = document.activeElement
        if (!id && selectionTrigger.current?.isConnected) selectionTrigger.current.focus({preventScroll: true})
        setSelected(id)
        setProposal(null)
        intent.current = null
    }
    function setProposal(value: ScheduleProposal | null) {setDraft(value ? {scope, value} : null)}
    function propose(next: ScheduleProposal) {
        setProposal(next)
        setNotice('Предпросмотр переноса. Запись сохранится после подтверждения.')
    }
    function shift(direction: number) {
        setFrom(Temporal.PlainDate.from(from).add({days: direction * days}).toString())
    }
    async function save() {
        if (!proposal || !booking || !availability) return
        const matches = booking.revision == proposal.revision && proposal.id == booking.id
        const target = availability.find(item => item.serviceId == proposal.serviceId)
        if (!matches || !target?.slots.some(item => item.start == proposal.start)) {
            setNotice('План изменился. Выберите актуальное свободное время.')
            setProposal(null)
            return
        }
        const captured = scope
        const input = {orgId: org.id, ...proposal}
        const requestSignature = JSON.stringify(input)
        if (intent.current?.signature != requestSignature) intent.current = {signature: requestSignature, key: crypto.randomUUID()}
        setWaiting(true)
        const key = intent.current.key
        try {
            const ok = await commands.run('bookingReschedule', {...input, key})
            if (latest.current.scope != captured) return
            setNotice(ok ? 'Встреча перенесена' : 'Перенос не сохранён. Текущая запись сохранена.')
            if (ok) {
                setProposal(null)
                intent.current = null
            } else {
                // Клиент не видит чужие брони: серверный отказ требует перечитать доступность.
                setProposal(null)
                setRefresh(value => value + 1)
            }
        } finally {
            setWaiting(false)
        }
    }
    const targetResource = resources.find(item => item.id == availability?.find(item => item.serviceId == proposal?.serviceId)?.resourceId)
    const chosenAvailability = availability?.find(item => item.serviceId == (proposal?.serviceId ?? booking?.serviceId))
    const proposedService = value.services.find(item => item.id == proposal?.serviceId) ?? selectedService
    const canMove = !!booking && booking.status == 'confirmed' && booking.start > Date.now()
    const disabled = busy || waiting || !remote
    const columns = timeline.flatMap(day => shownResources.map(resource => ({day, resource})))
    const singleResourceWeek = days == 7 && shownResources.length == 1
    const minimumWidth = singleResourceWeek ? 160 : 270

    return <section className="booking-schedule" aria-label="Графическое расписание встреч">
        <header className="booking-schedule-heading">
            <div><small>ВРЕМЯ В ОДНОМ ВЗГЛЯДЕ</small><h2>{staff ? 'План студии' : 'Ваши встречи'}</h2></div>
            <span>{visible.length} активных встреч · {activeZone}</span>
        </header>
        <div className="booking-schedule-toolbar">
            <div className="booking-schedule-mode">
                <button aria-pressed={days == 1} onClick={() => setDays(1)}>День</button>
                <button aria-pressed={days == 7} onClick={() => setDays(7)}>Неделя</button>
            </div>
            <button aria-label="Предыдущий период расписания" onClick={() => shift(-1)}>‹</button>
            <label>Начало периода<input type="date" value={from} onChange={function date(event) {
                if (validScheduleDate(event.target.value)) setFrom(event.target.value)
            }}/></label>
            <button aria-label="Следующий период расписания" onClick={() => shift(1)}>›</button>
            <button onClick={function today() {setFrom(Temporal.Now.zonedDateTimeISO(activeZone).toPlainDate().toString())}}>Сегодня</button>
            <label>Часовой пояс<select value={activeZone} onChange={event => setShownZone(event.target.value)}>
                {zones.map(item => <option key={item}>{item}</option>)}
            </select></label>
            <label>Ресурс<select value={activeResource} onChange={event => setChosenResource(event.target.value)}>
                <option value="">Все ресурсы</option>
                {zonedResources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Масштаб<select value={scale} onChange={event => setScale(Number(event.target.value))}>
                <option value={1}>Обычно</option><option value={1.5}>Крупно</option>
            </select></label>
        </div>
        <p className="booking-schedule-help">
            {staff ? 'Ресурсы и реальные интервалы встреч.' : 'Здесь только ваши встречи; доступное время проверяется отдельно.'}
            {' '}Выберите подтверждённую встречу и ручку ⠿. Пробел начинает перенос, ↑↓ меняют время.
            {staff && ' ←→ выбирают соседний совместимый ресурс.'} Escape отменяет, Enter готовит предпросмотр.
        </p>
        <div className={'booking-schedule-layout' + (booking ? ' inspecting' : '')}>
            <div className="booking-schedule-scroll" ref={surface} tabIndex={0} aria-label="Расписание по ресурсам и дням">
                <div className={'booking-schedule-grid' + (singleResourceWeek ? ' week-single' : '')}
                    style={{gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(${minimumWidth}px, 1fr))`}}>
                    {columns.map(({day, resource}) => <header className="booking-schedule-day" key={day.date + ':' + resource.id}>
                        <button onClick={function openDay() {
                            setFrom(day.date)
                            setDays(1)
                        }}>{dateLabel(day.date)} ↗</button>
                        <strong>{resource.name}</strong>
                        <small>UTC{day.offset}{day.offset != day.endOffset ? ' → UTC' + day.endOffset : ''} · {day.minutes / 60} ч</small>
                    </header>)}
                    {columns.map(function cell({day, resource}) {
                            const lanes = intervalLanes(visible.filter(item => item.resourceId == resource.id), day)
                            const targetSlots = availability?.filter(item => item.resourceId == resource.id).flatMap(item => item.slots) ?? []
                            const starts = [...new Set(targetSlots.filter(item => item.start >= day.start && item.start < day.end).map(item => item.start))]
                            const projected = proposal && targetResource?.id == resource.id && proposal.start >= day.start && proposal.start < day.end
                            return <div className={'booking-schedule-cell' + (projected ? ' proposed' : '')}
                                key={day.date + ':' + resource.id} style={{height: day.minutes * scale}}
                                data-booking-resource={resource.id} data-booking-day={day.date}>
                                {day.ticks.map(tick => <div className="booking-schedule-tick" key={tick.at}
                                    style={{top: positionInDay(tick.at, day) + '%'}}>
                                    <span>{tick.label}{day.minutes != 1440 && <small>{tick.offset}</small>}</span>
                                </div>)}
                                {starts.map(at => (
                                    <span className="booking-schedule-slot" key={at}
                                        style={{top: positionInDay(at, day) + '%'}} aria-hidden="true"/>
                                ))}
                                {!lanes.placed.length && <span className="booking-schedule-empty">{staff ? 'Нет встреч' : 'Нет ваших встреч'}</span>}
                                {lanes.placed.map(({booking: item, lane}) => <ScheduleCard key={item.id} booking={item}
                                    value={value} day={day} lane={lane} selected={item.id == selected} select={select}
                                    scope={scope + ':' + scale} surface={surface} availability={availability} propose={propose} proposal={proposal}
                                    disabled={disabled} zone={activeZone} lanes={lanes.count} scale={scale}/>)}
                                {projected && booking && <div className="booking-schedule-projected" style={{
                                    top: positionInDay(proposal.start, day) + '%', height: (booking.end - booking.start) / 60000 * scale
                                }}><strong>Новое время</strong><span>{when(proposal.start, activeZone)}</span></div>}
                            </div>
                    })}
                </div>
                {!shownResources.length && <p className="empty">В этом часовом поясе нет ресурсов.</p>}
            </div>
            {booking && <aside className="booking-schedule-inspector" ref={inspector} tabIndex={-1} aria-label="План встречи">
                <header><small>ВСТРЕЧА</small><button aria-label="Закрыть встречу" onClick={() => select('')}>×</button></header>
                <h3>{selectedService?.name ?? 'Встреча'}</h3>
                <p>{when(booking.start, resources.find(item => item.id == booking.resourceId)?.zone ?? activeZone)}</p>
                <p>Сохранённые условия: {(booking.end - booking.start) / 60000} мин · {booking.depositUnits} ед. предоплаты.</p>
                <small>{value.people.find(item => item.account == booking.customer)?.name ?? 'Ваш клиент'} · {booking.partySize} участн.</small>
                {!canMove && <p>Перенос доступен для будущей подтверждённой встречи.</p>}
                {canMove && !services.length && <p>Условия услуги изменились. Нет активной услуги с прежней длительностью и предоплатой.</p>}
                {canMove && <>
                    <label>Услуга и ресурс<select value={proposal?.serviceId ?? booking.serviceId} disabled={disabled || !availability || !services.length}
                        onChange={function target(event) {
                            const next = availability?.find(item => item.serviceId == event.target.value)?.slots[0]
                            if (next) propose({id: booking.id, revision: booking.revision, serviceId: event.target.value, start: next.start})
                        }}>
                        {services.map(item => <option key={item.id} value={item.id}>
                            {item.name} · {resources.find(resource => resource.id == item.resourceId)?.name}
                        </option>)}
                    </select></label>
                    <label>Свободное время<select value={proposal?.start ?? ''} disabled={disabled || !availability}
                        onChange={function time(event) {
                            if (event.target.value) propose({id: booking.id, revision: booking.revision,
                                serviceId: proposedService?.id ?? booking.serviceId, start: Number(event.target.value)})
                        }}>
                        <option value="">Выберите интервал</option>
                        {chosenAvailability?.slots.map(item => <option key={item.start} value={item.start}>
                            {when(item.start, chosenAvailability.zone)}
                        </option>)}
                    </select></label>
                    {proposal && <div className="booking-schedule-proposal">
                        <small>ПРЕДПРОСМОТР</small><strong>{when(proposal.start, targetResource?.zone ?? activeZone)}</strong>
                        <p>{targetResource?.name} · {proposedService?.name}</p>
                        <button className="primary" disabled={disabled} onClick={() => void save()}>Подтвердить перенос</button>
                        <button disabled={disabled} onClick={() => setProposal(null)}>Отменить предпросмотр</button>
                    </div>}
                    {availability && !chosenAvailability?.slots.length && <p>В этом периоде нет свободных интервалов.</p>}
                </>}
            </aside>}
        </div>
        <p className="booking-schedule-notice" role="status">{notice}</p>
    </section>
}
