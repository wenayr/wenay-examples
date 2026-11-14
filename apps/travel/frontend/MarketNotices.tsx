import type {MarketEvidence, MarketNotice} from '../src/market-contract.ts'
import {safeHref} from './DirectoryCard.tsx'

const checkedDate = new Intl.DateTimeFormat('ru', {dateStyle: 'medium'})

export function MarketEvidenceLinks({items}: {items: MarketEvidence[]}) {
    if (!items.length) return null
    return <ul className="market-evidence">{items.map(item => {
        const date = new Date(item.checkedAt)
        return <li key={item.url}><a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer">{item.title} ↗</a>
            {Number.isFinite(date.getTime()) && <small>Проверено {checkedDate.format(date)}</small>}</li>
    })}</ul>
}

export function MarketNotices({items}: {items: MarketNotice[] | undefined}) {
    return <>{items?.map(notice => <aside key={notice.title} className={'market-notice market-notice-' + notice.kind} role="note">
        <h2>{notice.title}</h2><p>{notice.description}</p><MarketEvidenceLinks items={notice.evidence}/></aside>)}</>
}
