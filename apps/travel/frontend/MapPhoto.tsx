import {useRef, useState, type MouseEvent, type PointerEvent} from 'react'
import {createPortal} from 'react-dom'
import type {SupplyPhoto} from '../src/supply-contract.ts'
import type {PackageHotelGallery} from '../src/package-media-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {MapCardIcon} from './map-card-icons.tsx'
import './map-photo-icons.css'

interface MapPhotoProps {
    hotelId: string
    name: string
    photo?: SupplyPhoto | null
    photos?: readonly SupplyPhoto[]
    propertyUrl?: string
    showLabels?: boolean
    selectedUrl?: string
    sourcesHost?: HTMLElement
    onPhoto: (url: string) => void
    onOpen: () => void
}

export function MapPhoto({hotelId, name, photo, photos, propertyUrl, selectedUrl, sourcesHost, showLabels = false, onPhoto, onOpen}: MapPhotoProps) {
    const url = hotelId.startsWith('tez:') ? directoryUrl('package-gallery', {hotelId}) : null
    const gallery = useDirectoryQuery<PackageHotelGallery>(url)
    const [activeUrl, setActiveUrl] = useState(selectedUrl)
    const [unavailable, setUnavailable] = useState<string[]>([])
    const gesture = useRef<{id: number, x: number, y: number} | null>(null)
    const swiped = useRef(false)
    const supplied = gallery.data?.photos ?? photos ?? (photo ? [photo] : [])
    const available = supplied.filter(entry => safeHref(entry.url) && !unavailable.includes(entry.url))
    const index = Math.max(0, available.findIndex(entry => entry.url == activeUrl))
    const image = available[index]
    const original = image && safeHref('sourceImageUrl' in image ? String(image.sourceImageUrl) : image.url)
    const source = safeHref(gallery.data?.hotelUrl ?? propertyUrl ?? image?.sourceUrl)
    const sourceLinks = <>
        {original && <a href={original} target="_blank" rel="noopener noreferrer"
            className={sourcesHost ? 'map-card-action map-card-action--image' : undefined}
            title={'Открыть файл фотографии · ' + name} aria-label={'Файл фото · ' + name}>
            <MapCardIcon name="image" size={sourcesHost ? 18 : 14}/>{showLabels && <span>Файл фото</span>}
        </a>}
        {source && <a href={source} target="_blank" rel="noopener noreferrer"
            className={sourcesHost ? 'map-card-action map-card-action--source' : undefined}
            title={'Страница отеля у поставщика · ' + name} aria-label={'Страница источника · ' + name}>
            <MapCardIcon name="source" size={sourcesHost ? 18 : 14}/>{showLabels && <span>Источник</span>}
        </a>}
    </>

    function step(direction: number) {
        if (available.length < 2) return
        const next = available[(index + direction + available.length) % available.length]
        setActiveUrl(next.url)
        onPhoto(next.url)
    }

    function startSwipe(event: PointerEvent<HTMLButtonElement>) {
        if (!event.isPrimary || event.button != 0) return
        gesture.current = {id: event.pointerId, x: event.clientX, y: event.clientY}
        swiped.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    function finishSwipe(event: PointerEvent<HTMLButtonElement>) {
        const start = gesture.current
        gesture.current = null
        if (!start || start.id != event.pointerId) return
        const horizontal = event.clientX - start.x
        const vertical = event.clientY - start.y
        if (Math.abs(horizontal) < 32 || Math.abs(horizontal) <= Math.abs(vertical) * 1.2) return
        swiped.current = true
        step(horizontal < 0 ? 1 : -1)
    }

    function openHotel(event: MouseEvent<HTMLButtonElement>) {
        if (swiped.current && event.detail > 0) {
            swiped.current = false
            return
        }
        swiped.current = false
        onOpen()
    }

    return <div className="map-hotel-card__gallery" onKeyDown={event => {
        if (event.key == 'Enter' || event.key == ' ') event.stopPropagation()
    }}>
        <div className="map-hotel-card__media" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.stopPropagation()
            if (event.key == 'ArrowLeft' || event.key == 'ArrowRight') {
                event.preventDefault()
                step(event.key == 'ArrowLeft' ? -1 : 1)
            }
        }}>
            <button type="button" className="map-hotel-card__photo-open" aria-label={'Открыть отель ' + name}
                onClick={openHotel} onPointerDown={startSwipe} onPointerUp={finishSwipe}
                onPointerCancel={() => { gesture.current = null }}>
                {image ? <img className="map-hotel-card__photo" src={image.url} alt={name} loading="lazy" decoding="async" draggable={false}
                    onError={() => setUnavailable(current => [...current, image.url])}/> :
                    <span className="map-hotel-card__photo is-missing">Фото пока недоступно</span>}
            </button>
            {available.length > 1 && <>
                <button type="button" className="map-hotel-card__photo-arrow is-previous" aria-label={'Предыдущее фото · ' + name}
                    onClick={() => step(-1)}>‹</button>
                <button type="button" className="map-hotel-card__photo-arrow is-next" aria-label={'Следующее фото · ' + name}
                    onClick={() => step(1)}>›</button>
                <span className="map-hotel-card__photo-count" aria-live="polite" aria-atomic="true">{index + 1}/{available.length}</span>
            </>}
            {gallery.error && <button type="button" className="map-hotel-card__photo-retry" onClick={gallery.retry}
                title="Повторить загрузку фото" aria-label={'Повторить загрузку фото · ' + name}>
                <MapCardIcon name="refresh" size={14}/>{showLabels && <span>Повторить фото</span>}
            </button>}
        </div>
        {sourcesHost ? createPortal(sourceLinks, sourcesHost) :
            <div className="map-hotel-card__sources" data-show-labels={showLabels}>{sourceLinks}</div>}
    </div>
}
