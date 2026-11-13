import React, {useState} from 'react'
import {photoUrl, type DishCard} from '../shared/dish'

const price = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR'})

type CardProps = {item: DishCard, authority: string, children?: React.ReactNode}

export function DishCardView({item, authority, children}: CardProps) {
    const [selected, setSelected] = useState('')
    const [failed, setFailed] = useState('')
    const photo = item.photos.includes(selected) ? selected : item.photos[0]
    const source = photo ? photoUrl(photo, authority) : ''
    return <article className="panel menu">
        {source && source != failed ? <img
            className="dish-photo"
            src={source}
            alt={item.title}
            loading="lazy"
            onError={function unavailable() {setFailed(source)}}
        /> : <div className="dish-photo photo-empty">Фото скоро появится</div>}
        {item.photos.length > 1 && <div className="photo-thumbnails">
            {item.photos.map((id, index) => (
                <button
                    type="button"
                    key={id}
                    aria-label={`Фото ${index + 1}: ${item.title}`}
                    aria-pressed={id == photo}
                    onClick={() => setSelected(id)}
                >
                    <img src={photoUrl(id, authority)} alt="" loading="lazy"/>
                </button>
            ))}
        </div>}
        <h3>{item.title || 'Название блюда'}</h3>
        {item.portion && <small>{item.portion}</small>}
        {item.description && <p className="dish-description">{item.description}</p>}
        {item.composition && <p className="dish-composition"><b>Состав:</b> {item.composition}</p>}
        <footer>
            <b>{price.format(item.price)}</b>
            {children}
        </footer>
    </article>
}
