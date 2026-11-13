import type {SupplyOptions, SupplyOffer, SupplySource} from '../src/supply-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {Icon} from './Icons.tsx'

export const sourceStatus = {
    live: 'Данные получены', cached: 'Сохранённая выгрузка', unavailable: 'Недоступен',
    handoff: 'Переход к поставщику', 'requires-access': 'Требуется партнёрский доступ',
} as const satisfies Record<SupplySource['status'], string>

export function SourceCredits({sources}: {sources: SupplySource[]}) {
    const licensed = sources.filter(s => s.license && s.licenseUrl)
    if (!licensed.length) return null
    return <p className="directory-credits">Данные: {licensed.map((s, index) => <span key={s.id}>
        {index > 0 && ' · '}{s.attribution || s.name}
        {' '}<a href={safeHref(s.licenseUrl)} target="_blank" rel="noopener noreferrer">{s.license}</a>
    </span>)}</p>
}

export function SourceLine({sources}: {sources: SupplySource[]}) {
    return <details className="directory-sources"><summary>Источники данных</summary><ul>{sources.map(s => <li key={s.id}>
        <strong>{s.url ? <a href={safeHref(s.url)} target="_blank" rel="noopener noreferrer">{s.name}</a> : s.name}</strong>
        <span>{sourceStatus[s.status]}</span>
        {s.license && <a href={safeHref(s.licenseUrl)} target="_blank" rel="noopener noreferrer">{s.license}</a>}{s.description &&
            <small>{s.description}</small>}
        {s.updatedAt && <time dateTime={s.updatedAt}>Обновлено {new Date(s.updatedAt).toLocaleDateString('ru-RU')}</time>}
    </li>)}</ul></details>
}

const checked = new Intl.DateTimeFormat('ru-RU', {dateStyle: 'short', timeStyle: 'short'})

function offerPrice(offer: SupplyOffer) {
    return new Intl.NumberFormat('ru-RU', {style: 'currency', currency: offer.price.currency, maximumFractionDigits: 2})
        .format(offer.price.total / 100)
}

export function Rates({items}: {items: SupplyOffer[]}) {
    return <ul className="directory-rates">{items.map(offer => <li key={offer.id}>
        <a href={safeHref(offer.url)} target="_blank" rel="noopener noreferrer">
            <span><strong>{offer.label}</strong>
                <small>{offer.scope == 'hotel' ? 'Размещение' : 'Пакетный тур · цена за группу'}</small>
                <small><time dateTime={offer.checkedAt}>Проверено {checked.format(new Date(offer.checkedAt))}</time></small>
            </span>
            <span className="rate-total">{offerPrice(offer)} <Icon name="arrow" size={15}/></span>
        </a>
    </li>)}</ul>
}

export function HotelOptions({data}: {data: SupplyOptions}) {
    const byHotel = data.offers.filter(offer => offer.scope == 'hotel')
    return <div className="directory-options">
        {byHotel.length > 0 ? <Rates items={byHotel}/> : <p>Подтверждённой цены для этого объекта на выбранные даты пока нет.</p>}
        {data.links.length > 0 && <><h4>Поиск у посредников</h4><div className="directory-links">
            {data.links.map(link => <a href={safeHref(link.url)} key={link.id} target="_blank" rel="noopener noreferrer">
                <span><b>{link.label}</b><small>{link.scope == 'hotel' ? 'Открыть у поставщика' : 'Поиск по направлению'}</small></span>
                <Icon name="arrow" size={16}/>
            </a>)}
        </div></>}
        {!!data.sources.length && <SourceLine sources={data.sources}/>}
    </div>
}
