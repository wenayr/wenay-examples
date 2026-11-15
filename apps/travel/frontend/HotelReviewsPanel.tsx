import type {HotelReviews} from '../src/hotel-reviews-contract.ts'
import {useAgency} from './agency/AgencyProvider.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {safeHref} from './DirectoryCard.tsx'
import {Icon} from './Icons.tsx'
import './hotel-reviews.css'

const date = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
const month = new Intl.DateTimeFormat('ru-RU', {month: 'long', year: 'numeric', timeZone: 'UTC'})
const reviewPolicyUrl = 'https://a.travel-assets.com/documentation-hubs/prod/rapid/latest/en-US/assets/lodging-review-policies/Customer_Reviews_Policy_Russian.docx'

function reviewDate(value: string) {
    if (/^\d{4}$/.test(value)) return value
    if (/^\d{4}-\d{2}$/.test(value)) {
        const monthStamp = Date.parse(value + '-01T00:00:00Z')
        return Number.isFinite(monthStamp) ? month.format(monthStamp) : value
    }
    const stamp = Date.parse(value)
    return Number.isFinite(stamp) ? date.format(stamp) : value
}

export function HotelReviewsPanel({hotelId}: {hotelId: string}) {
    const {agency} = useAgency()
    const enabled = agency?.showReviews ?? true
    const query = useDirectoryQuery<HotelReviews>(enabled ? directoryUrl('hotel-reviews', {hotelId}) : null)
    if (!enabled) return null
    const data = query.data?.hotelId == hotelId ? query.data : undefined
    if (data?.status == 'disabled') return null
    const summary = data?.summary
    const sourceUrl = safeHref(data?.source.url)
    return <section className="hotel-reviews" aria-label="Отзывы об отеле" aria-busy={query.loading}>
        <header className="hotel-reviews__header">
            <div><span className="hotel-reviews__eyebrow">Опыт путешественников</span><h3>Отзывы об отеле</h3></div>
            {summary && <div className="hotel-reviews__score"><strong>{summary.rating} <small>/ {summary.maxRating}</small></strong>
                <span>{summary.count.toLocaleString('ru-RU')} отзывов · {data.source.name}</span></div>}
        </header>
        {query.loading && !data && <p className="hotel-reviews__note" role="status">Получаем отзывы из источника…</p>}
        {query.error && <p className="hotel-reviews__note" role="status">Отзывы временно недоступны.
            {' '}<button type="button" onClick={query.retry}>Повторить</button></p>}
        {data && data.status != 'ready' && <div className="hotel-reviews__empty">
            <Icon name="chat" size={23}/><p>{data.message ?? 'Отзывы для этого отеля пока недоступны.'}</p>
        </div>}
        {data?.externalReferences.length ? <div className="hotel-reviews__references">
            {data.externalReferences.map(reference => <a key={reference.url} href={safeHref(reference.url)}
                target="_blank" rel="noopener noreferrer" title={'Отель сопоставлен ' + reviewDate(reference.identityCheckedOn)}>
                Читать отзывы на {reference.name} <Icon name="external" size={14}/>
            </a>)}
        </div> : null}
        {data?.reviews.length ? <div className="hotel-reviews__list">{data.reviews.map(review => <article key={review.id} className="hotel-review">
            <header><div><strong>{review.author}</strong><time dateTime={review.publishedAt}>{reviewDate(review.publishedAt)}</time></div>
                {review.rating != null && <span className="hotel-review__rating">{review.rating} / {review.maxRating}</span>}</header>
            {review.title && <h4>{review.title}</h4>}
            <p>{review.text}</p>
            <footer>{review.verifiedStay === true && <span>Проживание подтверждено источником</span>}
                {review.travelDate && <span>Поездка: {reviewDate(review.travelDate)}</span>}
                {safeHref(review.sourceUrl) && <a href={safeHref(review.sourceUrl)} target="_blank" rel="noopener noreferrer">
                    Страница отзывов {data.source.name} <Icon name="external" size={12}/></a>}</footer>
        </article>)}</div> : null}
        {data && <footer className="hotel-reviews__source">
            <span>{data.source.attribution}</span>
            {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{data.source.name} <Icon name="external" size={12}/></a>}
            {data.source.retrievedAt && <time dateTime={data.source.retrievedAt}>
                Получено {reviewDate(data.source.retrievedAt)}{data.source.stale && ' · ожидает обновления'}</time>}
            {data.source.partial && data.source.retrievedAt && <span>Показана часть отзывов источника.</span>}
        </footer>}
        {data?.reviews.length ? <details className="hotel-reviews__policy"><summary>Как публикуются отзывы Expedia</summary>
            <p>Expedia Group проверяет, что путешественник бронировал через группу. За отзыв может быть выдан скидочный купон.
                Публикуются положительные и отрицательные отзывы, соответствующие правилам.</p>
            <a href={reviewPolicyUrl} target="_blank" rel="noopener noreferrer">Правила публикации отзывов Expedia (DOCX) ↗</a>
        </details> : null}
    </section>
}
