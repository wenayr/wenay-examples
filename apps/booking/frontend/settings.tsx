import React, {useState} from 'react'
import type {BookingWorkspace} from '../backend/domain'
import type {Resource, Offering} from '../backend/model'
import type {Commands, Organization} from './contracts'

const weekdays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

const defaultWeek = [1, 2, 3, 4, 5].map(day => ({day, start: '09:00', end: '18:00'}))

type SettingsProps = {
    value: BookingWorkspace,
    org: Organization,
    commands: Commands,
    busy: boolean
}

export function Settings({value, org, commands, busy}: SettingsProps) {
    const [resource, setResource] = useState<Resource | null | undefined>()
    const [service, setService] = useState<Offering | null | undefined>()

    // Владелец ведёт все расписания, специалист — только своё.
    const editable = (item: Resource) => org.role == 'owner' || item.staff == value.account.account
    const resources = value.resources.filter(item => item.orgId == org.id)
    const services = value.services.filter(item => item.orgId == org.id)

    function newResource() {
        setResource(null)
        setService(undefined)
    }
    function newService() {
        setService(null)
        setResource(undefined)
    }
    function editResource(item: Resource) {
        setResource({
            ...item,
            weekly: item.weekly.map(window => ({...window})),
            exceptions: item.exceptions.map(entry => ({
                ...entry,
                windows: entry.windows.map(window => ({...window}))
            }))
        })
        setService(undefined)
    }
    function editService(item: Offering) {
        setService({...item})
        setResource(undefined)
    }

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">ДЕНЬ В ВАШЕМ РИТМЕ</p>
                <h1>Услуги и рабочее время</h1>
                <p>Часовой пояс, вместимость и перерывы учитываются при каждой записи.</p>
            </div>
        </div>
        <div className="settings-heading">
            <h2>Специалисты и места встреч</h2>
            <button className="primary" disabled={busy} onClick={newResource}>+ Новое расписание</button>
        </div>
        <div className="settings-grid">
            {resources.map(item => (
                <article key={item.id}>
                    <span className="service-symbol">◒</span>
                    <h3>{item.name}</h3>
                    <p>{item.zone} · мест: {item.capacity}</p>
                    <small>
                        {item.weekly.length} рабочих интервалов · {item.exceptions.length} особых дней
                    </small>
                    <button disabled={busy || !editable(item)} onClick={() => editResource(item)}>
                        Изменить расписание
                    </button>
                </article>
            ))}
        </div>
        {resource !== undefined && <ResourceForm
            key={resource?.id ?? 'new'}
            resource={resource}
            value={value}
            org={org}
            commands={commands}
            busy={busy}
            close={() => setResource(undefined)}
        />}
        <div className="settings-heading">
            <h2>Услуги</h2>
            <button className="primary" disabled={busy || !resources.length} onClick={newService}>
                + Новая услуга
            </button>
        </div>
        <div className="settings-grid">
            {services.map(item => {
                const own = resources.find(value => value.id == item.resourceId)!
                return <article key={item.id}>
                    <span className="service-symbol">◷</span>
                    <h3>{item.name}</h3>
                    <p>{item.duration} мин · до встречи {item.before}, после {item.after} мин</p>
                    <small>
                        {item.active ? 'Доступна для записи' : 'Скрыта'} ·
                        предоплата {item.depositUnits} тестовых ед.
                    </small>
                    <button disabled={busy || !editable(own)} onClick={() => editService(item)}>
                        Изменить услугу
                    </button>
                </article>
            })}
        </div>
        {service !== undefined && <ServiceForm
            key={service?.id ?? 'new'}
            service={service}
            resources={resources.filter(editable)}
            org={org}
            commands={commands}
            busy={busy}
            close={() => setService(undefined)}
        />}
    </>
}

type ResourceFormProps = {
    resource: Resource | null,
    value: BookingWorkspace,
    org: Organization,
    commands: Commands,
    busy: boolean,
    close: () => void
}

function ResourceForm({resource, value, org, commands, busy, close}: ResourceFormProps) {
    const [weekly, setWeekly] = useState<Resource['weekly']>(resource?.weekly ?? defaultWeek)
    const [exceptions, setExceptions] = useState<Resource['exceptions']>(resource?.exceptions ?? [])

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const saved = await commands.run('resourceSave', {
            orgId: org.id,
            id: resource?.id ?? '',
            revision: resource?.revision ?? 0,
            name: String(form.get('name')),
            staff: String(form.get('staff')),
            zone: String(form.get('zone')),
            capacity: Number(form.get('capacity')),
            weekly,
            exceptions
        })
        if (saved) close()
    }

    function changeWindow(index: number, patch: Partial<Resource['weekly'][number]>) {
        setWeekly(weekly.map((item, position) => position == index ? {...item, ...patch} : item))
    }
    function changeException(index: number, patch: Partial<Resource['exceptions'][number]>) {
        setExceptions(exceptions.map((item, position) => position == index ? {...item, ...patch} : item))
    }
    function changeExceptionWindow(index: number, at: number, patch: {start?: string, end?: string}) {
        const entry = exceptions[index]
        const windows = entry.windows.map((value, position) => position == at ? {...value, ...patch} : value)
        changeException(index, {windows})
    }

    const staff = value.people.filter(function assignable(item) {
        if (item.orgId != org.id || item.role == 'customer') return false
        return org.role == 'owner' || item.account == value.account.account
    })

    const week = weekly.map((window, index) => (
        <div className="hours-row" key={index}>
            <select
                aria-label={'День интервала ' + (index + 1)}
                value={window.day}
                onChange={event => changeWindow(index, {day: Number(event.target.value)})}
            >
                {weekdays.map((label, position) => (
                    <option key={position} value={position + 1}>{label}</option>
                ))}
            </select>
            <input
                aria-label={'Начало интервала ' + (index + 1)}
                type="time"
                value={window.start}
                onChange={event => changeWindow(index, {start: event.target.value})}
                required
            />
            <span>—</span>
            <input
                aria-label={'Конец интервала ' + (index + 1)}
                type="time"
                value={window.end}
                onChange={event => changeWindow(index, {end: event.target.value})}
                required
            />
            <button
                type="button"
                aria-label={'Убрать интервал ' + (index + 1)}
                onClick={() => setWeekly(weekly.filter((_, position) => position != index))}
            >
                ×
            </button>
        </div>
    ))

    const special = exceptions.map((entry, index) => (
        <div className="exception" key={index}>
            <div className="hours-row">
                <input
                    aria-label={'Особая дата ' + (index + 1)}
                    type="date"
                    value={entry.date}
                    onChange={event => changeException(index, {date: event.target.value})}
                    required
                />
                <strong>{entry.windows.length ? 'Особые часы' : 'Выходной'}</strong>
                <button
                    type="button"
                    onClick={() => setExceptions(exceptions.filter((_, position) => position != index))}
                >
                    Убрать день
                </button>
            </div>
            {entry.windows.map((window, at) => (
                <div className="hours-row" key={at}>
                    <input
                        type="time"
                        aria-label={'Начало особого интервала ' + (index + 1) + '-' + (at + 1)}
                        value={window.start}
                        onChange={event => changeExceptionWindow(index, at, {start: event.target.value})}
                        required
                    />
                    <span>—</span>
                    <input
                        type="time"
                        aria-label={'Конец особого интервала ' + (index + 1) + '-' + (at + 1)}
                        value={window.end}
                        onChange={event => changeExceptionWindow(index, at, {end: event.target.value})}
                        required
                    />
                    <button
                        type="button"
                        onClick={() => changeException(index, {
                            windows: entry.windows.filter((_, position) => position != at)
                        })}
                    >
                        Убрать часы
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => changeException(index, {
                    windows: [...entry.windows, {start: '10:00', end: '16:00'}]
                })}
            >
                + Часы в этот день
            </button>
        </div>
    ))

    return <form className="settings-form" onSubmit={save}>
        <header>
            <h2>{resource ? 'Настроить рабочее время' : 'Новое расписание'}</h2>
            <button type="button" aria-label="Закрыть форму расписания" onClick={close}>×</button>
        </header>
        <fieldset disabled={busy}>
            <div className="form-row">
                <label>Название
                    <input name="name" defaultValue={resource?.name} required maxLength={120}/>
                </label>
                <label>Специалист
                    <select name="staff" defaultValue={resource?.staff ?? value.account.account}>
                        {staff.map(item => (
                            <option key={item.account} value={item.account}>{item.name}</option>
                        ))}
                    </select>
                </label>
            </div>
            <div className="form-row">
                <label>Часовой пояс
                    <input
                        name="zone"
                        defaultValue={resource?.zone ?? 'Europe/Berlin'}
                        required
                        placeholder="Europe/Berlin"
                    />
                </label>
                <label>Вместимость места
                    <input
                        name="capacity"
                        type="number"
                        min="1"
                        max="100"
                        defaultValue={resource?.capacity ?? 1}
                        required
                    />
                </label>
            </div>
            <h3>Обычная неделя</h3>
            {week}
            <button
                type="button"
                onClick={() => setWeekly([...weekly, {day: 1, start: '09:00', end: '18:00'}])}
            >
                + Рабочий интервал
            </button>
            <h3>Особые дни</h3>
            <p className="muted">
                Без интервалов — выходной.
                Указанные часы заменяют обычное расписание выбранного дня.
            </p>
            {special}
            <button type="button" onClick={() => setExceptions([...exceptions, {date: '', windows: []}])}>
                + Особый день
            </button>
            <div className="actions">
                <button className="primary">Сохранить расписание</button>
                <button type="button" onClick={close}>Отмена</button>
            </div>
        </fieldset>
    </form>
}

type ServiceFormProps = {
    service: Offering | null,
    resources: Resource[],
    org: Organization,
    commands: Commands,
    busy: boolean,
    close: () => void
}

function ServiceForm({service, resources, org, commands, busy, close}: ServiceFormProps) {
    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const saved = await commands.run('serviceSave', {
            orgId: org.id,
            id: service?.id ?? '',
            revision: service?.revision ?? 0,
            resourceId: String(form.get('resourceId')),
            name: String(form.get('name')),
            description: String(form.get('description')),
            duration: Number(form.get('duration')),
            before: Number(form.get('before')),
            after: Number(form.get('after')),
            capacity: Number(form.get('capacity')),
            depositUnits: Number(form.get('depositUnits')),
            active: form.get('active') == 'on'
        })
        if (saved) close()
    }

    const numbers = [
        {name: 'duration', label: 'Длительность, мин', value: service?.duration ?? 45, min: 5},
        {name: 'before', label: 'Подготовка до, мин', value: service?.before ?? 0, min: 0},
        {name: 'after', label: 'Перерыв после, мин', value: service?.after ?? 15, min: 0},
        {name: 'capacity', label: 'Участников в записи', value: service?.capacity ?? 1, min: 1},
        {name: 'depositUnits', label: 'Тестовая предоплата, ед.', value: service?.depositUnits ?? 0, min: 0}
    ]

    return <form className="settings-form" onSubmit={save}>
        <header>
            <h2>{service ? 'Изменить услугу' : 'Новая услуга'}</h2>
            <button type="button" aria-label="Закрыть форму услуги" onClick={close}>×</button>
        </header>
        <fieldset disabled={busy}>
            <label>Название услуги
                <input name="name" defaultValue={service?.name} required maxLength={120}/>
            </label>
            <label>Описание для клиента
                <textarea name="description" defaultValue={service?.description} rows={3} maxLength={1000}/>
            </label>
            <label>Расписание
                <select name="resourceId" defaultValue={service?.resourceId}>
                    {resources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
            </label>
            <div className="form-row">
                {numbers.map(item => (
                    <label key={item.name}>{item.label}
                        <input
                            name={item.name}
                            type="number"
                            min={item.min}
                            defaultValue={item.value}
                            required
                        />
                    </label>
                ))}
            </div>
            <label className="inline">
                <input type="checkbox" name="active" defaultChecked={service?.active ?? true}/>
                Доступна для записи
            </label>
            <p className="muted">
                Предоплата здесь тестовая.
                Деньги не списываются, реальные платёжные данные не требуются.
            </p>
            <div className="actions">
                <button className="primary">Сохранить услугу</button>
                <button type="button" onClick={close}>Отмена</button>
            </div>
        </fieldset>
    </form>
}
