import {useState, type FormEvent} from 'react'
import {agencyLeadStatuses, type AgencyLead, type AgencyLeadInput, type tAgencyLeadStatus} from '../../src/agency-contract.ts'
import {Icon} from '../Icons.tsx'
import {useAgency} from './AgencyProvider.tsx'

const blankLead: AgencyLeadInput = {name: '', contact: '', message: ''}
function leadDate(value: string) {
    return new Intl.DateTimeFormat('ru', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(new Date(value))
}

function downloadLeads(leads: AgencyLead[], format: 'json' | 'csv') {
    function csvCell(value: string) {
        const safe = /^[=+\-@]/.test(value) ? "'" + value : value
        return '"' + safe.replaceAll('"', '""') + '"'
    }
    let content = JSON.stringify(leads, null, 2)
    let type = 'application/json;charset=utf-8'
    if (format == 'csv') {
        const columns = ['Номер', 'Дата', 'Имя', 'Контакт', 'Пожелания', 'Отель', 'Статус']
        const rows = leads.map(lead => [
            lead.id, lead.createdAt, lead.name, lead.contact, lead.message, lead.hotelName ?? '', agencyLeadStatuses[lead.status],
        ].map(csvCell).join(','))
        content = '\uFEFF' + columns.map(csvCell).join(',') + '\r\n' + rows.join('\r\n')
        type = 'text/csv;charset=utf-8'
    }
    const url = URL.createObjectURL(new Blob([content], {type}))
    const link = document.createElement('a')
    link.href = url
    link.download = 'agency-leads-' + new Date().toISOString().slice(0, 10) + '.' + format
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AgencyLeads() {
    const {leads, saving, control} = useAgency()
    const [status, setStatus] = useState<tAgencyLeadStatus | 'all'>('all')
    const [phrase, setPhrase] = useState('')
    const [creating, setCreating] = useState(false)
    const [draft, setDraft] = useState(blankLead)
    const [created, setCreated] = useState(false)
    const term = phrase.toLocaleLowerCase('ru').trim()
    const visible = leads.filter(lead => {
        if (status != 'all' && lead.status != status) return false
        return [lead.name, lead.contact, lead.message, lead.hotelName ?? ''].join(' ').toLocaleLowerCase('ru').includes(term)
    })
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const result = await control.addLead(draft)
        if (!result) return
        setDraft(blankLead)
        setCreating(false)
        setCreated(true)
    }
    function toggleForm() {
        setCreating(!creating)
        setCreated(false)
    }
    return <section className="aw-leads" aria-labelledby="aw-leads-title"><header className="aw-panel-heading"><div>
        <span className="aw-eyebrow">От первого запроса до поездки</span><h2 id="aw-leads-title">Клиентские заявки <b>{leads.length}</b></h2>
        <p>Контакт, пожелания и следующий шаг — в одном месте.</p></div>
        <button className="aw-primary" type="button" onClick={toggleForm}>
            <Icon name={creating ? 'close' : 'people'} size={17}/>
            {creating ? 'Закрыть форму' : 'Добавить заявку'}</button></header>
        {created && <p className="aw-success" role="status">Заявка сохранена. Найдём путешествие, которое подойдёт клиенту.</p>}
        {creating && <form className="aw-lead-form" onSubmit={submit}><h3>Новая заявка</h3><div className="aw-form-grid">
            <label>Имя клиента<input required maxLength={100} value={draft.name} autoComplete="off" placeholder="Как обращаться к клиенту"
                onChange={event => setDraft({...draft, name: event.target.value})}/></label>
            <label>Почта или телефон<input required maxLength={160} value={draft.contact} autoComplete="off" placeholder="Контакт для ответа"
                onChange={event => setDraft({...draft, contact: event.target.value})}/></label></div>
            <label>Пожелания<textarea required maxLength={2000} rows={3} value={draft.message}
                placeholder="Куда, когда, на сколько дней, бюджет и важные детали"
                onChange={event => setDraft({...draft, message: event.target.value})}/></label>
            <div className="aw-form-footer"><span>Сохраняется в кабинете. Отправки поставщику и бронирования нет.</span>
                <button className="aw-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить заявку'}</button></div></form>}
        <div className="aw-lead-filters"><label className="aw-search"><Icon name="search" size={18}/><input type="search" value={phrase}
            placeholder="Имя, контакт или пожелания" aria-label="Поиск по заявкам" onChange={event => setPhrase(event.target.value)}/></label>
            <select value={status} aria-label="Статус заявки" onChange={event => setStatus(event.target.value as typeof status)}>
                <option value="all">Все статусы</option>{Object.entries(agencyLeadStatuses).map(([id, label]) =>
                    <option key={id} value={id}>{label}</option>)}</select>
            <details className="aw-export"><summary>Экспорт</summary><div><button type="button" disabled={!leads.length}
                onClick={() => downloadLeads(leads, 'csv')}>Скачать CSV</button><button type="button" disabled={!leads.length}
                    onClick={() => downloadLeads(leads, 'json')}>Скачать JSON</button></div></details></div>
        {!visible.length && <div className="aw-empty"><span><Icon name="people" size={30}/></span>
            <h3>{leads.length ? 'Заявки не найдены' : 'Первая поездка начинается с разговора'}</h3>
            <p>{leads.length ? 'Попробуйте другой запрос или статус.' : 'Добавьте запрос клиента. Здесь останутся его пожелания и история работы.'}</p>
            {!leads.length && <button className="aw-secondary" type="button" onClick={() => setCreating(true)}>Добавить первую заявку</button>}</div>}
        <div className="aw-lead-list">{visible.map(lead => <article className="aw-lead" key={lead.id}><div className="aw-lead-avatar">
            {lead.name.slice(0, 1).toLocaleUpperCase('ru')}</div><div className="aw-lead-content"><header><h3>{lead.name}</h3>
                <time dateTime={lead.createdAt}>{leadDate(lead.createdAt)}</time></header><p className="aw-lead-contact">{lead.contact}</p>
            <p className="aw-lead-message">{lead.message}</p>{lead.hotelName && <p className="aw-lead-hotel"><Icon name="pin" size={14}/>{lead.hotelName}</p>}
            </div><label className="aw-lead-status"><span>Следующий шаг</span><select value={lead.status} disabled={saving}
                aria-label={'Статус заявки: ' + lead.name} onChange={event => {
                    void control.updateLead(lead, event.target.value as tAgencyLeadStatus)
                }}>{Object.entries(agencyLeadStatuses).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></article>)}</div>
    </section>
}
