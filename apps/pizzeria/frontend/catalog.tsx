import type {tCommandRun} from '../shared/react/command-action'
import type {tClientCommands} from 'wenay-common2/service/client'
import type {serviceDefinition} from '../backend/service'
import React, {useState} from 'react'
import type {MenuItem} from '../backend/service'
import type {Inventory, RecipeLine} from '../backend/inventory'
import {dishDetails, photoUrl, publicDish} from '../shared/dish'
import {DishCardView} from './dish-card'
import {DishPhotos} from './dish-photos'

const units = {g: 'г', ml: 'мл', pcs: 'шт.'}

function emptyDish(): MenuItem {
    return {
        id: 'dish-' + crypto.randomUUID(),
        title: '',
        price: 0,
        available: true,
        recipe: [],
        description: '',
        composition: '',
        portion: '',
        photos: []
    }
}

type CatalogCommands = Pick<tClientCommands<typeof serviceDefinition>, 'setMenuItem'>

type CatalogProps = {
    items: MenuItem[],
    ingredients: Inventory['ingredients'],
    busy: boolean,
    run: tCommandRun<CatalogCommands>,
    authority: string,
    token: string
}

export function Catalog({items, ingredients, busy, run, authority, token}: CatalogProps) {
    const [draft, setDraft] = useState(emptyDish)
    const [editing, setEditing] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [notice, setNotice] = useState('')

    const blocked = busy || uploading
    const details = dishDetails(draft)

    function changePart(index: number, patch: Partial<RecipeLine>) {
        setDraft(previous => ({
            ...previous,
            recipe: previous.recipe.map((part, at) => at == index ? {...part, ...patch} : part)
        }))
    }
    async function saveDish(event: React.FormEvent) {
        event.preventDefault()
        if (blocked) return
        if (!await run('setMenuItem', draft)) return
        setNotice(draft.available
            ? 'Блюдо сохранено и появилось в меню.'
            : 'Блюдо сохранено. Оно скрыто от клиентов.')
        setDraft(emptyDish())
        setEditing(false)
    }
    function editDish(item: MenuItem) {
        setDraft({...item, ...dishDetails(item), recipe: item.recipe.map(part => ({...part}))})
        setEditing(true)
        setNotice('')
    }
    function resetDraft() {
        setDraft(emptyDish())
        setEditing(false)
        setNotice('')
    }

    function card(item: MenuItem) {
        const cover = dishDetails(item).photos[0]
        return <article className="batch" key={item.id}>
            {cover && (
                <img className="catalog-cover" src={photoUrl(cover, authority)} alt="" loading="lazy"/>
            )}
            <h3>{item.title}</h3>
            <p>{item.price} € · {item.available ? 'В продаже' : 'Скрыто'}</p>
            <ul>
                {item.recipe.map(function line(part) {
                    const ingredient = ingredients[part.ingredientId]
                    return <li key={part.ingredientId}>
                        {ingredient?.title ?? part.ingredientId}: {part.quantity}
                        {' '}{units[ingredient?.unit] ?? ''}
                    </li>
                })}
            </ul>
            {!item.recipe.length && <p>Нужно настроить рецептуру.</p>}
            <button disabled={blocked} onClick={() => editDish(item)}>Редактировать</button>
        </article>
    }

    const recipe = draft.recipe.map((part, index) => (
        <div className="row recipe-line" key={index}>
            <label>Ингредиент
                <select
                    value={part.ingredientId}
                    required
                    onChange={event => changePart(index, {ingredientId: event.target.value})}
                >
                    <option value="">Выберите ингредиент</option>
                    {Object.values(ingredients).map(function option(ingredient) {
                        const taken = draft.recipe.some(function used(other, at) {
                            return at != index && other.ingredientId == ingredient.id
                        })
                        return <option key={ingredient.id} value={ingredient.id} disabled={taken}>
                            {ingredient.title} ({units[ingredient.unit]})
                        </option>
                    })}
                </select>
            </label>
            <label>Количество
                <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={part.quantity}
                    onChange={event => changePart(index, {quantity: Number(event.target.value)})}
                />
            </label>
            <button
                type="button"
                onClick={() => setDraft({
                    ...draft,
                    recipe: draft.recipe.filter((_ignored, at) => at != index)
                })}
            >
                Убрать
            </button>
        </div>
    ))

    return <section className="panel">
        <h2>Блюда и рецептуры</h2>
        <div className="cards">{items.map(card)}</div>
        <h3>{editing ? 'Редактирование блюда' : 'Новое блюдо'}</h3>
        {notice && <p role="status">{notice}</p>}
        <div className="dish-editor-layout">
            <form onSubmit={saveDish}>
                <fieldset disabled={blocked}>
                    <div className="row">
                        <label>Название блюда
                            <input
                                value={draft.title}
                                required
                                maxLength={100}
                                onChange={event => setDraft({...draft, title: event.target.value})}
                            />
                        </label>
                        <label>Цена, €
                            <input
                                type="number"
                                min="0"
                                max="100000"
                                step="0.01"
                                required
                                value={draft.price}
                                onChange={event => setDraft({...draft, price: Number(event.target.value)})}
                            />
                        </label>
                    </div>
                    <label>Описание для клиента
                        <textarea
                            value={details.description}
                            maxLength={1200}
                            rows={3}
                            placeholder="Какое блюдо на вкус, как готовим, чем оно особенное"
                            onChange={event => setDraft({...draft, description: event.target.value})}
                        />
                    </label>
                    <label>Размер или вес порции
                        <input
                            value={details.portion}
                            maxLength={100}
                            placeholder="Например: 30 см · 450 г"
                            onChange={event => setDraft({...draft, portion: event.target.value})}
                        />
                    </label>
                    <label>Состав для клиента
                        <textarea
                            value={details.composition}
                            maxLength={600}
                            rows={2}
                            placeholder="Оставьте пустым — покажем названия ингредиентов из рецептуры"
                            onChange={event => setDraft({...draft, composition: event.target.value})}
                        />
                    </label>
                    <small>
                        Можно уточнить соусы, начинку и аллергены.
                        Количества для кухни задаются отдельно ниже.
                    </small>
                    <label className="check">
                        <input
                            type="checkbox"
                            checked={draft.available}
                            onChange={event => setDraft({...draft, available: event.target.checked})}
                        />
                        В продаже
                    </label>
                    <h3>Рецептура для кухни · на одну порцию</h3>
                    <p>
                        Эти количества резервируются при заказе и списываются при начале
                        приготовления. Клиент их не видит.
                    </p>
                    {recipe}
                    <button
                        type="button"
                        disabled={!Object.keys(ingredients).length || draft.recipe.length >= 50}
                        onClick={() => setDraft({
                            ...draft,
                            recipe: [...draft.recipe, {ingredientId: '', quantity: 1}]
                        })}
                    >
                        + Ингредиент
                    </button>
                    {!Object.keys(ingredients).length && <p>Сначала добавьте ингредиенты на складе ниже.</p>}
                    <DishPhotos
                        key={draft.id}
                        photos={details.photos}
                        authority={authority}
                        token={token}
                        disabled={busy}
                        onBusy={setUploading}
                        onChange={value => setDraft(previous => ({...previous, photos: value}))}
                    />
                    <div className="row recipe-line">
                        <button className="primary" disabled={blocked || !draft.recipe.length}>
                            Сохранить блюдо
                        </button>
                        <button type="button" onClick={resetDraft}>
                            {editing ? 'Отменить редактирование' : 'Очистить форму'}
                        </button>
                    </div>
                </fieldset>
            </form>
            <aside className="dish-preview">
                <h3>Так увидит клиент</h3>
                <DishCardView item={publicDish(draft, ingredients)} authority={authority}>
                    <button type="button" disabled>+ В корзину</button>
                </DishCardView>
                <small>
                    {draft.available
                        ? 'Появится в меню после сохранения.'
                        : 'Блюдо скрыто от клиентов.'}
                </small>
            </aside>
        </div>
    </section>
}
