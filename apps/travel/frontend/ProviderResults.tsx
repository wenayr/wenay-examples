import {useEffect, useState} from 'react'
import type {ProviderOffer, ProviderQuery, ProviderSearch} from '../src/provider-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {providerQueryLink, providerStatusNames} from './provider-client.ts'
import {providerSelectionId, readProviderSelections, toggleProviderSelection, type SavedProviderSelection} from './provider-saved.ts'
import {dateLabel} from './presentation.ts'
import {MarketNotices} from './MarketNotices.tsx'
import './providers.css'

export const priceBasisNames = {
    party: 'за всю группу и поездку', person: 'за одного человека', 'room-night': 'за номер и ночь',
} as const satisfies Record<ProviderOffer['price']['basis'], string>
const accuracyNames = {
    'live-offer': 'Тариф поставщика', 'published-from': 'Опубликованная цена от', 'cached-indicative': 'Сохранённый ориентир',
} as const satisfies Record<ProviderOffer['accuracy'], string>
export const priceTypeNames = {net: 'Закупочная цена для агентства', retail: 'Цена продавца', unknown: 'Состав цены уточняется'} as const
const updated = new Intl.DateTimeFormat('ru', {dateStyle: 'short', timeStyle: 'short'})
export const providerTime = (value: string) => updated.format(new Date(value))
export const providerMoney = (amount: number, currency: string) => new Intl.NumberFormat('ru', {
    style: 'currency', currency,
}).format(amount)

function offerEnd(offer: ProviderOffer) {
    const dates = [offer.expiresAt, offer.deal?.expiresAt].flatMap(value => value ? [Date.parse(value)] : []).filter(Number.isFinite)
    return dates.length ? Math.min(...dates) : null
}

function Included({offer}: {offer: ProviderOffer}) {
    const {includes} = offer
    let baggage = 'Багаж не указан'
    if (includes.checkedBags === 0) baggage = 'Без зарегистрированного багажа'
    if (includes.checkedBags && includes.checkedBags > 0) baggage = 'Багаж на человека · ' + includes.checkedBags
    let taxes = 'Состав сборов уточняется'
    if (includes.taxes === true) taxes = 'Налоги включены'
    if (includes.taxes === false) taxes = 'Налоги оплачиваются отдельно'
    return <ul className="provider-included">
        {offer.flight && <li>{baggage}</li>}
        <li>{taxes}</li>
        {includes.board && <li>Питание · {includes.board}</li>}
        {includes.refundable === true && <li>Возврат предусмотрен по условиям тарифа</li>}
        {includes.refundable === false && <li>Невозвратный тариф</li>}
        {includes.refundable == null && <li>Условия отмены уточняются</li>}
    </ul>
}

function OfferCard({offer, provider, selected, onSave, compare, onCompare, compareLimit}: {
    offer: ProviderOffer, provider: string, selected: boolean, onSave: () => void,
    compare: boolean, onCompare: () => void, compareLimit: boolean,
}) {
    const expiresAt = offerEnd(offer)
    const expires = expiresAt !== null && expiresAt <= Date.now()
    const media = offer.media?.[0]
    return <article className={'provider-offer' + (offer.deal ? ' provider-offer-deal' : '')}>
        {media && safeHref(media.url) && <figure><img src={safeHref(media.url)} alt={offer.hotel?.name ?? offer.title} loading="lazy"/>
            <figcaption><a href={safeHref(media.sourceUrl)} target="_blank" rel="noopener noreferrer">{media.credit || provider}</a>
                {media.license && ' · ' + media.license}</figcaption></figure>}
        <div className="provider-offer-body"><div className="provider-offer-top"><span>{provider}</span><small>{accuracyNames[offer.accuracy]}</small></div>
            <h3>{offer.title}</h3>
            {offer.origin && !offer.flight && <p className="provider-locality">Вылет из {offer.origin}</p>}
            {offer.destination && <p className="provider-locality">{offer.destination.name} · {offer.destination.country}</p>}
            {offer.flight && <p className="provider-locality">{offer.flight.origin} → {offer.flight.destination}
                {offer.flight.carrier && ' · ' + offer.flight.carrier}
                {offer.flight.stops === 0 && ' · прямой рейс'}
                {offer.flight.stops != null && offer.flight.stops > 0 && ' · пересадок ' + offer.flight.stops}</p>}
            <p className="provider-offer-period">{offer.departure && 'Вылет ' + dateLabel(offer.departure)}
                {offer.returnDate && ' — ' + dateLabel(offer.returnDate)}
                {offer.checkIn && ' · проживание ' + dateLabel(offer.checkIn)}{offer.checkOut && ' — ' + dateLabel(offer.checkOut)}
                {offer.nights && ' · ночей ' + offer.nights}
                {offer.adults && ' · взрослых ' + offer.adults}</p>
            <div className="provider-price"><strong>{offer.accuracy != 'live-offer' && 'От '}{providerMoney(offer.price.amount, offer.price.currency)}</strong>
                <small>{priceBasisNames[offer.price.basis]}</small><small className={'provider-price-type provider-price-' + (offer.price.type ?? 'unknown')}>
                    {priceTypeNames[offer.price.type ?? 'unknown']}</small></div>
            <Included offer={offer}/>
            {offer.deal && <aside className="provider-deal-proof"><strong>
                {offer.deal.kind == 'supplier-sale' ? 'Акция поставщика' : 'Наблюдаемое снижение цены'}</strong>
                <p>{offer.deal.description}</p><a href={safeHref(offer.deal.evidenceUrl)} target="_blank" rel="noopener noreferrer">Основание предложения ↗</a>
                <small>{offer.deal.expiresAt ? 'Акция до ' + providerTime(offer.deal.expiresAt) : 'Срок акции в источнике не указан'}</small>
            </aside>}
            {offer.conditions && <details className="provider-conditions"><summary>Условия</summary><p>{offer.conditions}</p></details>}
            <p className="provider-checked">Проверено {providerTime(offer.checkedAt)}
                {offer.expiresAt && ' · тариф до ' + providerTime(offer.expiresAt)}{expires && ' · срок истёк'}</p>
            <div className="provider-offer-actions"><button type="button" aria-pressed={selected} onClick={onSave}>
                {selected ? 'В поездке' : 'В поездку'}</button>
                <label><input type="checkbox" checked={compare} disabled={!compare && compareLimit} onChange={onCompare}/> Сравнить</label>
                {!expires && <a href={safeHref(offer.bookingUrl || offer.sourceUrl)} target="_blank" rel="noopener noreferrer">К поставщику ↗</a>}
            </div>
        </div>
    </article>
}

function CompareOffers({items, onClear, onRemove}: {items: ProviderOffer[], onClear: () => void, onRemove: (offer: ProviderOffer) => void}) {
    if (!items.length) return null
    const first = items[0]
    const same = Boolean(first.comparisonKey) && items.every(offer => offer.comparisonKey == first.comparisonKey
        && offer.price.type == first.price.type && offer.price.currency == first.price.currency && offer.price.basis == first.price.basis)
    return <section className="provider-selected"><div className="provider-section-heading"><h2>Выбранные варианты · {items.length} из 3</h2>
        <button type="button" onClick={onClear}>Очистить</button></div>
        <p>{same ? 'Поставщики передали одинаковый ключ сравнения тарифа.' : 'Проверьте различия в расчёте цены, объекте и включённых услугах.'}</p>
        <div className="agency-table-scroll"><table className="provider-compare"><thead><tr><th>Условие</th>
            {items.map(offer => <th key={offer.providerId + offer.id}>{offer.title}</th>)}</tr></thead>
            <tbody><tr><th>Сумма</th>{items.map(offer => <td key={offer.id}>{providerMoney(offer.price.amount, offer.price.currency)}</td>)}</tr>
                <tr><th>Расчёт</th>{items.map(offer => <td key={offer.id}>{priceBasisNames[offer.price.basis]}</td>)}</tr>
                <tr><th>Тип цены</th>{items.map(offer => <td key={offer.id}>{priceTypeNames[offer.price.type ?? 'unknown']}</td>)}</tr>
                <tr><th>Поставщик</th>{items.map(offer => <td key={offer.id}>{offer.providerId}</td>)}</tr>
                <tr><th>Что включено</th>{items.map(offer => <td key={offer.id}><Included offer={offer}/></td>)}</tr>
                <tr><th>Проверено</th>{items.map(offer => <td key={offer.id}>{providerTime(offer.checkedAt)}</td>)}</tr>
                <tr><th>Условия</th>{items.map(offer => <td key={offer.id}>{offer.conditions || 'Уточняются у поставщика'}</td>)}</tr>
                <tr><th>Действия</th>{items.map(offer => <td key={offer.id}><button onClick={() => onRemove(offer)}>Убрать</button></td>)}</tr>
            </tbody></table></div>
    </section>
}

export function ProviderResults({data, query, onRetry, names = {}}: {
    data: ProviderSearch, query: ProviderQuery, onRetry: () => void, names?: Record<string, string>,
}) {
    const [provider, setProvider] = useState('all')
    const [country, setCountry] = useState('all')
    const [product, setProduct] = useState('all')
    const [basis, setBasis] = useState('all')
    const [budget, setBudget] = useState('')
    const [selected, setSelected] = useState<ProviderOffer[]>([])
    const [saved, setSaved] = useState<SavedProviderSelection[]>([])
    const [now, setNow] = useState(Date.now)
    useEffect(() => { void readProviderSelections().then(setSaved) }, [])
    useEffect(() => {
        const expiry = data.offers.flatMap(offer => {
            const end = offerEnd(offer)
            return end !== null ? [end] : []
        }).filter(value => value > now)
        if (!expiry.length) return
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, Math.min(...expiry) - Date.now() + 10))
        return () => clearTimeout(timer)
    }, [data, now])
    const providers = new Map(data.results.map(result => [result.providerId, names[result.providerId] ?? result.providerId]))
    const countries = [...new Set(data.offers.flatMap(offer => offer.destination?.country ? [offer.destination.country] : []))].sort()
    const current = data.offers.filter(offer => {
        const end = offerEnd(offer)
        return end === null || end > Math.max(now, Date.now())
    })
    const visible = current.filter(offer => {
        if (provider != 'all' && offer.providerId != provider) return false
        if (country != 'all' && offer.destination?.country != country) return false
        if (product != 'all' && offer.kind != product) return false
        if (basis != 'all' && offer.price.basis != basis) return false
        if (budget && (offer.price.currency != query.currency || offer.price.amount > Number(budget))) return false
        return true
    }).sort((a, b) => (a.price.type ?? 'unknown').localeCompare(b.price.type ?? 'unknown')
        || a.price.currency.localeCompare(b.price.currency) || a.price.basis.localeCompare(b.price.basis) || a.price.amount - b.price.amount)
    const selectedOffers = selected
    function compare(offer: ProviderOffer) {
        const same = (item: ProviderOffer) => item.providerId == offer.providerId && item.id == offer.id
        setSelected(items => items.some(same) ? items.filter(item => !same(item)) : [...items, offer].slice(0, 3))
    }
    async function save(offer: ProviderOffer) {
        setSaved(await toggleProviderSelection(query, offer))
    }
    return <section className="provider-results" aria-label="Цены у поставщиков"><div className="provider-section-heading">
        <h2>{query.kind == 'deals' ? 'Предложения с подтверждённым основанием' : 'Предложения поставщиков'}</h2>
        <button type="button" onClick={onRetry}>Обновить цены</button></div>
        <MarketNotices items={data.notices}/>
        <div className="provider-result-filters">
            <label>Источник<select value={provider} onChange={event => setProvider(event.target.value)}><option value="all">Все источники</option>
                {[...providers].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Страна<select value={country} onChange={event => setCountry(event.target.value)}><option value="all">Все страны</option>
                {countries.map(name => <option key={name}>{name}</option>)}</select></label>
            {query.kind == 'deals' && <label>Тип предложения<select value={product} onChange={event => setProduct(event.target.value)}>
                <option value="all">Все предложения</option><option value="packages">Туры</option><option value="flights">Перелёты</option>
                <option value="hotels">Отели</option></select></label>}
            <label>Расчёт цены<select value={basis} onChange={event => setBasis(event.target.value)}><option value="all">Все способы расчёта</option>
                {Object.entries(priceBasisNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Бюджет до, {query.currency || 'EUR'}<input type="number" min="0" step="1" value={budget}
                onChange={event => setBudget(event.target.value)} placeholder="Без ограничения"/></label>
        </div>
        <p className="provider-results-note" role="status">Показано {visible.length} из {current.length}. Цены упорядочены по типу, валюте и способу расчёта.
            {budget && ' При заданном бюджете показаны цены только в выбранной валюте.'}</p>
        {!visible.length && <div className="provider-empty"><h3>Подтверждённых предложений по этим параметрам пока нет</h3>
            <p>Посмотрите ответы источников ниже, измените параметры или повторите запрос.</p></div>}
        <div className="provider-offer-grid">{visible.map(offer => <OfferCard key={offer.providerId + '/' + offer.id} offer={offer}
            provider={providers.get(offer.providerId) ?? offer.providerId} selected={saved.some(item => item.id == providerSelectionId(query, offer))}
            onSave={() => { void save(offer) }} compare={selected.some(item => item.providerId == offer.providerId && item.id == offer.id)}
            onCompare={() => compare(offer)} compareLimit={selected.length >= 3}/>)}</div>
        <nav className="provider-portions" aria-label="Продолжение выдачи поставщиков">
            {data.results.filter(result => result.partial || result.nextOffset != null).map(result => <div key={result.providerId}>
                <p>{providers.get(result.providerId)} · показана часть ответа
                    {result.total != null && ' · размер выборки источника ' + result.total}.</p>
                {result.nextOffset != null && <a href={providerQueryLink({...query, providers: [result.providerId], offset: result.nextOffset})}>
                    Следующая порция →</a>}
            </div>)}
        </nav>
        <CompareOffers items={selectedOffers} onClear={() => setSelected([])} onRemove={compare}/>
        <details className="provider-responses" open={!data.offers.length}><summary>Ответы источников · {data.results.length}</summary>
            <ul>{data.results.map(result => <li key={result.providerId}>
                <strong>{providers.get(result.providerId)}</strong><span>{providerStatusNames[result.status]} · предложений {result.offers.length}</span>
                <p>{result.description}</p>{result.checkedAt && <small>Проверено {providerTime(result.checkedAt)}</small>}
                {result.partial && <p>Показана часть ответа источника{result.total != null && ' · всего в его выборке ' + result.total}.</p>}
                {result.sourceUrl && <a href={safeHref(result.sourceUrl)} target="_blank" rel="noopener noreferrer">Открыть источник ↗</a>}
            </li>)}</ul><a href="#providers">Проверить подключение поставщиков →</a>
        </details>
    </section>
}
