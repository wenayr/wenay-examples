import React, {useRef, useState, useEffect} from 'react'
import type {BookingWorkspace} from '../backend/domain'
import type {Booking} from '../backend/model'
import {when, statuses, deposits, type Commands, type Organization} from './contracts'

const waitStates: Record<string, string> = {
    waiting: 'Ждём свободное место',
    offered: 'Время предложено — подтвердите удержанную запись выше',
    accepted: 'Предложение принято',
    cancelled: 'Ожидание отменено',
    expired: 'Срок предложения истёк'
}

const noticeStates: Record<string, string> = {
    pending: 'Запланировано',
    delivered: 'Доставлено локально',
    cancelled: 'Отменено'
}

type ReservationsProps = {
    value: BookingWorkspace,
    org: Organization,
    commands: Commands,
    busy: boolean,
    move: (id: string) => void
}

export function Reservations({value, org, commands, busy, move}: ReservationsProps) {
    const [all, setAll] = useState(false)

    const mine = value.bookings.filter(function visible(item) {
        if (item.orgId != org.id) return false
        return all || ['held', 'confirmed'].includes(item.status)
    })
    const bookings = mine.sort((a, b) => a.start - b.start)
    const waits = value.waitlist.filter(item => item.orgId == org.id)
    const notices = value.notices.filter(item => item.orgId == org.id)

    // Часовой пояс показываем по ресурсу услуги: у каждой встречи он свой.
    function serviceZone(serviceId: string) {
        const service = value.services.find(item => item.id == serviceId)
        return value.resources.find(item => item.id == service?.resourceId)?.zone ?? 'UTC'
    }
    function bookingZone(bookingId: string) {
        const booking = value.bookings.find(item => item.id == bookingId)
        return value.resources.find(item => item.id == booking?.resourceId)?.zone ?? 'UTC'
    }

    const waitList = waits.map(item => (
        <article className="wait-card" key={item.id}>
            <div>
                <strong>{value.services.find(service => service.id == item.serviceId)?.name}</strong>
                <p>{when(item.start, serviceZone(item.serviceId))}</p>
                <small>{waitStates[item.status]}</small>
            </div>
            {['waiting', 'offered'].includes(item.status) && (
                <button
                    disabled={busy}
                    onClick={() => void commands.run('waitCancel', {
                        orgId: org.id,
                        id: item.id,
                        key: 'cancel-wait-' + item.id
                    })}
                >
                    Перестать ждать
                </button>
            )}
        </article>
    ))

    const noticeList = notices.slice().reverse().map(item => (
        <article className="notice-card" key={item.id}>
            <strong>{item.body}</strong>
            <p>{when(item.dueAt, bookingZone(item.bookingId))} · {noticeStates[item.status]}</p>
        </article>
    ))

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">ВСТРЕЧИ, КОТОРЫЕ ВАЖНЫ</p>
                <h1>{org.role == 'customer' ? 'Ваши планы на день' : 'Расписание команды'}</h1>
                <p>Подтверждайте, переносите и освобождайте время, когда планы меняются.</p>
            </div>
            <label className="inline">
                <input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)}/>
                Показать историю
            </label>
        </div>
        <div className="reservation-list">
            {bookings.map(booking => (
                <Reservation
                    key={booking.id}
                    booking={booking}
                    value={value}
                    commands={commands}
                    busy={busy}
                    move={move}
                />
            ))}
            {!bookings.length && <div className="empty">
                <span>◒</span>
                <h2>День пока свободен</h2>
                <p>Выберите удобное время в календаре.</p>
            </div>}
        </div>
        <section className="secondary-section">
            <h2>Лист ожидания</h2>
            {waits.length ? waitList : <p className="muted">Вы пока не ожидаете свободного времени.</p>}
        </section>
        <section className="secondary-section">
            <h2>Тестовая почта</h2>
            <p className="muted">
                Напоминания остаются внутри приложения. Настоящие письма не отправляются.
            </p>
            {notices.length
                ? noticeList
                : <p className="muted">Напоминания появятся после подтверждения записи.</p>}
        </section>
    </>
}

type ReservationProps = {
    booking: Booking,
    value: BookingWorkspace,
    commands: Commands,
    busy: boolean,
    move: (id: string) => void
}

function Reservation({booking, value, commands, busy, move}: ReservationProps) {
    const service = value.services.find(item => item.id == booking.serviceId)
    const resource = value.resources.find(item => item.id == booking.resourceId)
    const zone = resource?.zone ?? 'UTC'
    const [now, setNow] = useState(Date.now())
    const [cancel, setCancel] = useState(false)
    const intent = useRef<{signature: string, key: string} | null>(null)

    useEffect(function tick() {
        if (booking.status != 'held') return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [booking.status])

    // Ключ намерения держится, пока запись не изменилась: повтор не создаёт второй команды.
    function key(name: string) {
        const signature = name + ':' + booking.revision
        if (intent.current?.signature != signature) {
            intent.current = {signature, key: crypto.randomUUID()}
        }
        return intent.current.key
    }

    const reference = {orgId: booking.orgId, id: booking.id, revision: booking.revision}
    const remains = Math.max(0, Math.ceil((booking.holdUntil - now) / 1000))
    const day = new Intl.DateTimeFormat('ru', {timeZone: zone, day: 'numeric'}).format(booking.start)
    const month = new Intl.DateTimeFormat('ru', {timeZone: zone, month: 'short'}).format(booking.start)
    const customer = value.people.find(person => person.account == booking.customer)
    const settled = ['none', 'paid'].includes(booking.deposit)
    const live = ['held', 'confirmed'].includes(booking.status)

    const cancelBox = <div className="cancel-confirm">
        <p>Освободить это время? Для новой встречи потребуется отдельная запись.</p>
        <button
            disabled={busy}
            onClick={() => void commands.run('bookingCancel', {...reference, key: key('cancel')})}
        >
            Да, отменить встречу
        </button>
        <button onClick={() => setCancel(false)}>Сохранить запись</button>
    </div>

    const payment = <details className="payment-test">
        <summary>Проверить предоплату без настоящих денег</summary>
        <p>Это локальная имитация результата. Банковские данные не нужны, оплата не производится.</p>
        <button
            disabled={busy}
            onClick={() => void commands.run('depositSimulate', {
                orgId: booking.orgId,
                id: booking.id,
                eventId: key('paid'),
                outcome: 'paid'
            })}
        >
            Имитировать успешную оплату
        </button>
        <button
            disabled={busy}
            onClick={() => void commands.run('depositSimulate', {
                orgId: booking.orgId,
                id: booking.id,
                eventId: key('failed'),
                outcome: 'failed'
            })}
        >
            Имитировать отказ
        </button>
    </details>

    return <article className={'reservation-card ' + booking.status}>
        <div className="reservation-date">
            <strong>{day}</strong>
            <span>{month}</span>
        </div>
        <div className="reservation-content">
            <header>
                <span className={'booking-status ' + booking.status}>{statuses[booking.status]}</span>
                <small>{booking.partySize} участн.</small>
            </header>
            <h2>{service?.name ?? 'Встреча'}</h2>
            <p>{when(booking.start, zone)} · {resource?.name}</p>
            <p className="muted">{customer?.name ?? booking.customer}</p>
            {booking.note && <p>{booking.note}</p>}
            {booking.status == 'held' && (
                <p className="hold-clock" role="status">
                    На подтверждение осталось {Math.floor(remains / 60)}:
                    {String(remains % 60).padStart(2, '0')}
                </p>
            )}
            <span className="deposit-state">
                {deposits[booking.deposit]}
                {booking.depositUnits ? ' · ' + booking.depositUnits + ' тестовых ед.' : ''}
            </span>
            <div className="reservation-actions">
                {booking.status == 'held' && (
                    <button
                        className="primary"
                        disabled={busy || remains <= 0 || !settled}
                        onClick={() => void commands.run('bookingConfirm', {...reference, key: key('confirm')})}
                    >
                        Подтвердить запись
                    </button>
                )}
                {booking.status == 'confirmed' && (
                    <button disabled={busy} onClick={() => move(booking.id)}>Перенести</button>
                )}
                {live && (
                    <button disabled={busy} onClick={() => setCancel(!cancel)}>Отменить встречу</button>
                )}
            </div>
            {cancel && cancelBox}
            {live && <label className="inline">
                <input
                    type="checkbox"
                    checked={booking.reminder}
                    disabled={busy}
                    onChange={event => void commands.run('reminderSet', {
                        ...reference,
                        key: key('reminder-' + event.target.checked),
                        enabled: event.target.checked
                    })}
                />
                Локальное напоминание
            </label>}
            {booking.depositUnits > 0 && payment}
        </div>
    </article>
}
