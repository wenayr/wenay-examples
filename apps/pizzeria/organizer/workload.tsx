import React from 'react'
import type {WorkView} from './model'

const started = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
})

function moment(at: number) {
    return started.format(at)
}

export function WorkloadPanel({value}:{value:Pick<WorkView,'workload'|'people'>}) {
    const load = value.workload
    if (!load) return null
    return <section className="work-load" aria-label="Загрузка кухни">
        <div className="work-heading">
            <div>
                <small>СЕЙЧАС НА КУХНЕ</small>
                <h2>Загрузка поваров</h2>
            </div>
            <p>
                Ожидают повара ·{' '}
                <b>Заказы: {load.queue.orders} · Блюда: {load.queue.dishes}</b>
            </p>
        </div>
        <div className="work-load-metrics">{load.people.map(person=><article key={person.account}>
            <h3>{value.people.find(employee=>employee.account==person.account)?.name ?? person.account}</h3>
            <strong>{person.dishes} <small>Блюд в работе</small></strong>
            <p>{person.orders?`Заказов в приготовлении: ${person.orders}`:'Нет заказов в приготовлении'}</p>
            {person.oldestStartedAt != null && (
                <small>Самый ранний взят {moment(person.oldestStartedAt)}</small>
            )}
        </article>)}</div>
        <small>
            Количество блюд включает повторные позиции.
            Общая очередь ещё не назначена, другие работы сотрудника видны на доске.
        </small>
    </section>
}
