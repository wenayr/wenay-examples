import {useEffect, useState, type FormEvent} from 'react'
import {agencyDestinationNames, type AgencyLeadInput} from '../../src/agency-contract.ts'
import {Icon} from '../Icons.tsx'
import {useAgency} from './AgencyProvider.tsx'

function initialRequest(): AgencyLeadInput {
    const query = new URLSearchParams(window.location.hash.split('?')[1])
    const hotelId = query.get('hotelId')?.slice(0, 160)
    const hotelName = query.get('hotelName')?.slice(0, 200)
    return {name: '', contact: '', message: hotelName ? 'Интересует ' + hotelName + '. ' : '', hotelId, hotelName}
}

export function AgencyStorefrontPage() {
    const {agency, slug, loading, error, saving, control} = useAgency()
    const [draft, setDraft] = useState(initialRequest)
    const [reference, setReference] = useState('')
    const hash = window.location.hash
    useEffect(() => {
        if (!loading && agency && hash.startsWith('#inquiry')) document.getElementById('inquiry')?.scrollIntoView({block: 'start'})
    }, [loading, agency, hash])
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const result = await control.addStorefrontLead(draft)
        if (result) {
            setReference(result.reference)
            setDraft({name: '', contact: '', message: ''})
        }
    }
    if (loading) return <main className="travel-home agency-workspace"><div className="aw-loading" role="status">
        <Icon name="compass" size={28}/><h1>Открываем агентство…</h1></div></main>
    if (!agency) return <main className="travel-home agency-workspace"><section className="aw-access"><Icon name="compass" size={34}/>
        <h1>Не удалось открыть агентство</h1><p>{error || 'Проверьте адрес витрины.'}</p>
        <button className="aw-primary" onClick={() => {void control.load()}}>Повторить</button></section></main>
    const searchReady = Boolean(agency.sources.length && agency.destinations.length)
    return <main className="travel-home agency-workspace aw-storefront"><section className="aw-storefront-hero">
        <div><span className="aw-eyebrow">Путешествия с вашим агентством</span><h1>{agency.name}</h1>
            <p>{agency.tagline || 'Найдём путешествие, которое подходит именно вам.'}</p><div className="aw-launch-actions">
                {searchReady && <a className="aw-primary" href="#packages"><Icon name="map" size={18}/>Выбрать на карте</a>}
                <a className="aw-secondary" href="#inquiry">Попросить подобрать <Icon name="arrow" size={16}/></a></div>
            <div className="aw-overview-regions">{agency.destinations.map(id => <a key={id} href={'#packages/' + encodeURIComponent(id)}>
                {agencyDestinationNames[id as keyof typeof agencyDestinationNames] ?? id}<Icon name="arrow" size={12}/></a>)}</div>
        </div><div className="aw-storefront-illustration" aria-hidden="true"><Icon name="compass" size={115}/><span>Ваш следующий маршрут</span>
            <div><span>Таллин</span><Icon name="plane" size={27}/><span>Впечатления</span></div></div></section>
        <div className="aw-storefront-benefits"><div><Icon name="map" size={24}/><strong>Сначала — место</strong>
            <p>Отели на карте, фотографии и расположение.</p></div><div><Icon name="matrix" size={24}/><strong>Потом — лучшие даты</strong>
            <p>График и матрица помогают сравнить варианты.</p></div><div><Icon name="chat" size={24}/><strong>Дальше — разговор</strong>
            <p>Агентство уточнит условия и поможет с выбором.</p></div></div>
        <div className="aw-storefront-bottom"><section className="aw-storefront-inquiry" id="inquiry">
            <span className="aw-eyebrow">Расскажите о вашей поездке</span>
            <h2>Подберём вместе</h2><p>Оставьте пожелания. Агентство получит запрос в своём кабинете и свяжется с вами.</p>
            {error && <p className="aw-error" role="alert">{error}</p>}
            {reference ? <div className="aw-storefront-accepted" role="status"><Icon name="flag" size={26}/><h3>Запрос передан агентству</h3>
                <p>Номер: <strong>{reference}</strong>. Сохраните его, чтобы уточнить запрос.</p>
                <button type="button" className="aw-secondary" onClick={() => setReference('')}>Отправить ещё один запрос</button></div>
                : <form className="aw-lead-form" onSubmit={submit}><div className="aw-form-grid"><label>Ваше имя
                    <input required autoComplete="name" maxLength={100} value={draft.name} placeholder="Как к вам обращаться"
                        onChange={event => setDraft({...draft, name: event.target.value})}/></label><label>Почта или телефон
                    <input required maxLength={160} value={draft.contact} placeholder="Куда ответить"
                        onChange={event => setDraft({...draft, contact: event.target.value})}/></label></div>
                    <label>Куда хочется отправиться?<textarea required maxLength={2000} rows={4} value={draft.message}
                        placeholder="Направление, даты, число путешественников и бюджет"
                        onChange={event => setDraft({...draft, message: event.target.value})}/></label>
                    <div className="aw-form-footer"><span>Ваши данные получит это агентство для ответа на запрос.
                        Отправка не создаёт бронирование.</span><button className="aw-primary" disabled={saving}>
                        {saving ? 'Передаём запрос…' : 'Отправить запрос'}<Icon name="arrow" size={16}/></button></div></form>}
        </section><aside className="aw-storefront-contact"><span className="aw-eyebrow">На связи</span><h2>{agency.name}</h2>
            {agency.contact.email && <a href={'mailto:' + agency.contact.email}><Icon name="chat" size={17}/>{agency.contact.email}</a>}
            {agency.contact.phone && <a href={'tel:' + agency.contact.phone.replace(/[^+\d]/g, '')}><Icon name="people" size={17}/>{agency.contact.phone}</a>}
            {agency.contact.website && <a href={agency.contact.website} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={17}/>Сайт агентства</a>}
            {!agency.contact.email && !agency.contact.phone && <p>Оставьте запрос в форме — агентство получит ваш контакт.</p>}
            <small>Цены, доступность, договор и порядок оплаты подтверждаются агентством перед оформлением.</small>
            <div className="aw-storefront-access"><Icon name="people" size={14}/><span>Доступ ограничен текущими правами сайта.</span></div>
            <a className="aw-platform-link" href="/#agency">Создать своё агентство в Wenay <Icon name="arrow" size={13}/></a>
            <span className="aw-storefront-slug">Агентство / {slug}</span>
        </aside></div>
    </main>
}
