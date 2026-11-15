import {agencyDestinationNames, agencyPriceModes, agencySources, type AgencySettings, type tAgencySource} from '../../src/agency-contract.ts'
import {validReviewProperty} from '../../src/hotel-reviews-contract.ts'
import {Icon} from '../Icons.tsx'
import {useAgency} from './AgencyProvider.tsx'

export const agencyFormSections = {
    brand: {label: 'Ваше агентство', description: 'Имя и стиль, которые увидит путешественник.', icon: 'compass'},
    contact: {label: 'Как с вами связаться', description: 'Укажите рабочие контакты для клиентов.', icon: 'chat'},
    storefront: {label: 'Настройте подбор', description: 'Выберите направления, источник и вид цен.', icon: 'filters'},
} as const satisfies Record<string, {label: string, description: string, icon: 'compass' | 'chat' | 'filters'}>

export type tAgencyFormSection = keyof typeof agencyFormSections

function toggleValue<T extends string>(values: T[], value: T) {
    return values.includes(value) ? values.filter(item => item != value) : [...values, value]
}

export function AgencySettingsFields({value, onChange, section, fixedSlug = false}: {
    value: AgencySettings, onChange: (value: AgencySettings) => void, section: tAgencyFormSection, fixedSlug?: boolean,
}) {
    const {session} = useAgency()
    function field<K extends keyof AgencySettings>(key: K, next: AgencySettings[K]) {
        onChange({...value, [key]: next})
    }
    function contact(key: keyof AgencySettings['contact'], next: string) {
        field('contact', {...value.contact, [key]: next})
    }
    if (section == 'brand') return <div className="aw-fields">
        <label>Название агентства <span>Обязательное поле</span><input autoComplete="organization" value={value.name} required maxLength={80}
            placeholder="Например, Северный берег" onChange={event => field('name', event.target.value)}/></label>
        <label>Короткое имя <span>{fixedSlug ? 'Сохраняется после создания агентства' : 'Латинские буквы, цифры и дефис · от 3 символов'}</span>
            <div className="aw-slug"><span>агентство /</span><input value={value.slug} required minLength={3} maxLength={40}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="nordic-travel" autoCapitalize="none" autoCorrect="off" disabled={fixedSlug}
                onChange={event => field('slug', event.target.value.toLowerCase())}/></div></label>
        <label>О вашем подходе <span>Короткое описание для путешественников</span><textarea value={value.tagline} maxLength={240} rows={3}
            placeholder="Тёплые путешествия, которые начинаются с заботы" onChange={event => field('tagline', event.target.value)}/></label>
        <label>Цвет агентства <span>Применится к навигации, кнопкам и акцентам</span><div className="aw-color">
            <input type="color" value={value.brandColor} aria-label="Цвет агентства" onChange={event => field('brandColor', event.target.value)}/>
            <code>{value.brandColor}</code><div>{['#166b61', '#245ca5', '#754995', '#a74839', '#8a641f'].map(color =>
                <button key={color} type="button" style={{background: color}} aria-label={'Выбрать цвет ' + color}
                    aria-pressed={value.brandColor == color} onClick={() => field('brandColor', color)}/>)}</div></div></label>
    </div>
    if (section == 'contact') return <div className="aw-fields">
        <label>Рабочая почта <span>Только адрес, который вы готовы показывать клиентам</span><input type="email" value={value.contact.email}
            autoComplete="email" maxLength={160} placeholder="hello@your-agency.ee" onChange={event => contact('email', event.target.value)}/></label>
        <label>Телефон <span>В международном формате</span><input type="tel" value={value.contact.phone} maxLength={60} autoComplete="tel"
            placeholder="+372 5555 0000" onChange={event => contact('phone', event.target.value)}/></label>
        <label>Сайт <span>Если у агентства уже есть свой сайт</span><input type="url" value={value.contact.website} maxLength={240}
            autoComplete="url" placeholder="https://your-agency.ee" onChange={event => contact('website', event.target.value)}/></label>
        <p className="aw-hint"><Icon name="people" size={20}/>Кабинет и клиентские заявки доступны владельцу.
            Контактные поля не заполняются данными аккаунта.</p>
    </div>
    return <div className="aw-fields">
        <fieldset className="aw-options"><legend>Направления в подборе</legend><p>Доступные сейчас регионы с реальным поиском поставщика.</p>
            <div className="aw-destinations">{Object.entries(agencyDestinationNames).map(([id, name]) =>
                <label key={id}><input type="checkbox" checked={value.destinations.includes(id)}
                    onChange={() => field('destinations', toggleValue(value.destinations, id))}/>{name}</label>)}</div>
            {!value.destinations.length && <p className="aw-warning">Направления выключены. Подбор туров будет приостановлен.</p>}</fieldset>
        <fieldset className="aw-options"><legend>Источник туров</legend>{Object.entries(agencySources).map(([id, source]) =>
            <label className="aw-source" key={id}><input type="checkbox" checked={value.sources.includes(id as tAgencySource)}
                onChange={() => field('sources', toggleValue(value.sources, id as tAgencySource))}/>
                <span><strong>{source.name}<b>Поиск доступен</b></strong><small>{source.description}</small></span></label>)}
            {!value.sources.length && <p className="aw-warning">Источники выключены. Подбор туров будет приостановлен.</p>}
            <a href="#providers">Другие поставщики и условия подключения <Icon name="arrow" size={14}/></a></fieldset>
        <fieldset className="aw-options"><legend>Цены в маленьких карточках</legend><div className="aw-mode-options">
            {Object.entries(agencyPriceModes).map(([mode, label]) => <label key={mode} className={value.compactPriceMode == mode ? 'is-active' : ''}>
                <input type="radio" name="agency-price-mode" value={mode} checked={value.compactPriceMode == mode}
                    onChange={() => field('compactPriceMode', mode as AgencySettings['compactPriceMode'])}/>
                <Icon name={mode == 'graph' ? 'calendar' : 'matrix'} size={21}/><strong>{label}</strong>
                <small>{mode == 'graph' ? 'Движение цены по датам' : 'Даты и длительность поездки'}</small></label>)}</div></fieldset>
        <label className="aw-switch"><span><strong>Отзывы из источников</strong>
            <small>Показывать доступные отзывы с автором, датой и ссылкой на источник.</small></span>
            <input type="checkbox" checked={value.showReviews} onChange={event => field('showReviews', event.target.checked)}/></label>
        <div className="aw-review-status"><Icon name="chat" size={17}/><div><strong>
            {session.reviewProviderAvailable ? 'Серверный источник отзывов подключён' : 'Для отзывов нужно серверное подключение'}</strong>
            <p>{session.reviewProviderAvailable ? 'Отзывы появятся у сопоставленных отелей, когда источник вернёт их.'
                : 'Ключи Expedia Rapid настраиваются на сервере. Включённый показ сам по себе не создаёт отзывы.'}</p></div></div>
        <details className="aw-review-mapping"><summary>Сопоставление отелей с Expedia <span>{value.reviewProperties?.length ?? 0}</span></summary>
            <p>Сверьте название и адрес у обоих источников. Это сопоставление владельца, а не автоматическое подтверждение личности отеля.</p>
            {(value.reviewProperties ?? []).map((property, index) => <div className="aw-review-property" key={index}>
                <label>TEZ ID<input value={property.hotelId} placeholder="tez:1234" pattern="tez:[1-9][0-9]{0,14}"
                    onChange={event => field('reviewProperties', value.reviewProperties?.map((item, i) =>
                        i == index ? {...item, hotelId: event.target.value} : item))}/></label>
                <label>Expedia ID<input value={property.propertyId} placeholder="12345" pattern="[1-9][0-9]{0,14}"
                    onChange={event => field('reviewProperties', value.reviewProperties?.map((item, i) =>
                        i == index ? {...item, propertyId: event.target.value} : item))}/></label>
                <label className="aw-review-url">Точная страница Expedia<input type="url" value={property.sourceUrl}
                    placeholder="https://www.expedia.com/…h12345.Hotel-Information"
                    onChange={event => field('reviewProperties', value.reviewProperties?.map((item, i) =>
                        i == index ? {...item, sourceUrl: event.target.value} : item))}/></label>
                {!validReviewProperty(property) && <small>Нужна HTTPS-страница Expedia с тем же ID отеля.</small>}
                <button type="button" aria-label={'Удалить сопоставление ' + property.hotelId}
                    onClick={() => field('reviewProperties', value.reviewProperties?.filter((_, i) => i != index))}>
                    <Icon name="close" size={15}/></button></div>)}
            <button type="button" className="aw-secondary" disabled={(value.reviewProperties?.length ?? 0) >= 100}
                onClick={() => field('reviewProperties', [...value.reviewProperties ?? [], {hotelId: '', propertyId: '', sourceUrl: ''}])}>
                Добавить сопоставление</button></details>
    </div>
}

export function AgencyBrandPreview({value}: {value: AgencySettings}) {
    return <aside className="aw-brand-preview" style={{'--agency-preview-color': value.brandColor} as React.CSSProperties}>
        <span className="aw-eyebrow">Ваш стиль в сервисе</span><div className="aw-brand-sample"><span><Icon name="compass" size={26}/></span>
            <strong>{value.name || 'Ваше агентство'}</strong></div><p>{value.tagline || 'Путешествия начинаются с вашей идеи.'}</p>
        <div className="aw-preview-divider"/><div className="aw-preview-route"><Icon name="plane" size={19}/>
            <span>Таллин<small>Отправляемся к морю</small></span><Icon name="arrow" size={16}/><span>Мир<small>Выбираем вместе</small></span></div>
        <div className="aw-preview-tags">{value.destinations.map(id => <span key={id}>
            {agencyDestinationNames[id as keyof typeof agencyDestinationNames] ?? id}</span>)}</div>
        <div className="aw-preview-contact">{value.contact.email || value.contact.phone || 'Контакты вашего агентства'}</div>
        <small>Предпросмотр оформления. Кабинет работает в текущем закрытом доступе сайта.</small>
    </aside>
}
