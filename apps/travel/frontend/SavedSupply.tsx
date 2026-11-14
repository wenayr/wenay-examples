import {useEffect, useState} from 'react'
import {safeHref} from './DirectoryCard.tsx'
import {providerKindNames} from './provider-client.ts'
import {priceBasisNames, priceTypeNames, providerMoney, providerTime} from './ProviderResults.tsx'
import {providerSelectionEvent, readProviderSelections, removeProviderSelection, type SavedProviderSelection} from './provider-saved.ts'

export function SavedSupply() {
    const [items, setItems] = useState<SavedProviderSelection[]>([])
    useEffect(() => {
        let active = true
        async function read() {
            const saved = await readProviderSelections()
            if (active) setItems(saved)
        }
        void read()
        window.addEventListener('storage', read)
        window.addEventListener(providerSelectionEvent, read)
        return () => {
            active = false
            window.removeEventListener('storage', read)
            window.removeEventListener(providerSelectionEvent, read)
        }
    }, [])
    async function remove(id: string) {
        setItems(await removeProviderSelection(id))
    }
    if (!items.length) return null
    return <section className="provider-saved"><h2>Предложения поставщиков</h2>
        <p>Сохранённые цены на момент проверки. Обновите поиск, чтобы проверить наличие и текущие условия.</p>
        <div className="provider-offer-grid">{items.map(item => <article key={item.id} className="provider-offer"><div className="provider-offer-body">
            <span className="provider-locality">{providerKindNames[item.kind]} · {item.providerId}</span><h3>{item.title}</h3>
            <div className="provider-price"><strong>{providerMoney(item.amount, item.currency)}</strong><small>{priceBasisNames[item.basis]}</small>
                <small>{priceTypeNames[item.priceType]}</small></div>
            <p className="provider-checked">{item.accuracy == 'live-offer' ? 'Сохранённый тариф' : 'Сохранённый ценовой ориентир'}</p>
            <p className="provider-checked">Сохранено по проверке {providerTime(item.checkedAt)}
                {item.expiresAt && ' · срок тарифа ' + providerTime(item.expiresAt)}</p>
            <div className="provider-offer-actions"><a href={item.resumeUrl}>Обновить сравнение →</a>
                <a href={safeHref(item.sourceUrl)} target="_blank" rel="noopener noreferrer">У поставщика ↗</a>
                <button type="button" onClick={() => { void remove(item.id) }}>Убрать</button></div>
        </div></article>)}</div>
    </section>
}
