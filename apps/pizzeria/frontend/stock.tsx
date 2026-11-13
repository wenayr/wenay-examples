import React, {useEffect, useState} from 'react'
import {stockPlan, type Inventory} from '../backend/inventory'
import type {serviceDefinition} from '../backend/service'

import type {tCommandRun} from '../shared/react/command-action'
import type {tClientCommands} from 'wenay-common2/service/client'

type StockCommands = Pick<
    tClientCommands<typeof serviceDefinition>,
    'addIngredient' | 'receiveStock' | 'spoilStock'
>

type tRun = tCommandRun<StockCommands>

const units = {g: 'г', ml: 'мл', pcs: 'шт.'}

const movementKinds = {received: 'Поступление', consumed: 'Расход', spoiled: 'Порча'}

function date(at: number) {
    return new Date(at).toLocaleString('ru-RU')
}

type StockData = ReturnType<typeof serviceDefinition.views.inventory.project>

type StockProps = {value: StockData, manage: boolean, busy: boolean, run: tRun}

export function Stock({value, manage, busy, run}: StockProps) {
    const [now, setNow] = useState(Date.now())
    useEffect(function trackExpiry() {
        const timer = setInterval(function tick() {setNow(Date.now())}, 1000)
        return function stopClock() {clearInterval(timer)}
    }, [])

    const ingredients = Object.values(value.ingredients)
    const batches = Object.values(value.batches).sort((a, b) => a.expiresAt - b.expiresAt)
    const waiting = Object.fromEntries(value.waiting.map(function placed(order) {
        return [order.id, {...order, state: 'placed' as const}]
    }))
    const plan = stockPlan({...value, orders: waiting}, now)

    async function addIngredient(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const added = await run('addIngredient', {
            id: String(data.get('id')),
            title: String(data.get('title')),
            unit: String(data.get('unit')) as 'g' | 'ml' | 'pcs'
        })
        if (added) form.reset()
    }
    async function receiveStock(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const received = await run('receiveStock', {
            ingredientId: String(data.get('ingredientId')),
            quantity: Number(data.get('quantity')),
            expiresAt: new Date(String(data.get('expiresAt'))).toISOString()
        })
        if (received) form.reset()
    }

    function row(ingredient: Inventory['ingredients'][string]) {
        const own = batches.filter(batch => batch.ingredientId == ingredient.id)
        const good = own.reduce((sum, batch) => sum + (batch.expiresAt > now ? batch.quantity : 0), 0)
        const free = own.reduce((sum, batch) => sum + (plan.free[batch.id] ?? 0), 0)
        const expired = own.reduce((sum, batch) => sum + (batch.expiresAt <= now ? batch.quantity : 0), 0)
        return <tr key={ingredient.id}>
            <td>{ingredient.title} <small>({units[ingredient.unit]})</small></td>
            <td>{good}</td>
            <td>{good - free}</td>
            <td>{free}</td>
            <td>{expired}</td>
        </tr>
    }

    const forms = <>
        <h3>Новый ингредиент</h3>
        <form className="row" onSubmit={addIngredient}>
            <label>ID
                <input name="id" required pattern="[a-z][a-z0-9_-]{0,63}" placeholder="mushrooms"/>
            </label>
            <label>Название
                <input name="title" required maxLength={100}/>
            </label>
            <label>Единица
                <select name="unit">
                    <option value="g">Граммы</option>
                    <option value="ml">Миллилитры</option>
                    <option value="pcs">Штуки</option>
                </select>
            </label>
            <button disabled={busy}>Добавить ингредиент</button>
        </form>
        <h3>Поступление партии</h3>
        <form className="row" onSubmit={receiveStock}>
            <label>Ингредиент
                <select name="ingredientId" required>
                    {ingredients.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.title} ({units[item.unit]})
                        </option>
                    ))}
                </select>
            </label>
            <label>Количество
                <input name="quantity" type="number" min="1" step="1" required/>
            </label>
            <label>Годен до (местное время)
                <input name="expiresAt" type="datetime-local" required/>
            </label>
            <button disabled={busy || !ingredients.length}>Принять на склад</button>
        </form>
    </>

    function batchCard(batch: Inventory['batches'][string]) {
        async function spoilStock(event: React.FormEvent<HTMLFormElement>) {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            const written = await run('spoilStock', {
                batchId: batch.id,
                quantity: Number(data.get('quantity')),
                reason: String(data.get('reason'))
            })
            if (written) form.reset()
        }
        const expired = batch.expiresAt <= now
        return <article className="batch" key={batch.id}>
            <h3>{value.ingredients[batch.ingredientId]?.title}</h3>
            <small>Партия #{batch.id.slice(-8)} · поступила {date(batch.receivedAt)}</small>
            <p>
                Остаток: <b>{batch.quantity} {units[value.ingredients[batch.ingredientId].unit]}</b>
                <br/>
                <span className={expired ? 'expired' : ''}>
                    Годен до {date(batch.expiresAt)}{expired ? ' · Просрочено' : ''}
                </span>
            </p>
            <form className="row" onSubmit={spoilStock}>
                <label>Испорчено
                    <input name="quantity" type="number" min="1" max={batch.quantity} step="1" required/>
                </label>
                <label>Причина
                    <input
                        name="reason"
                        required
                        maxLength={300}
                        placeholder="Плесень, нарушено хранение…"
                    />
                </label>
                <button disabled={busy}>Списать порчу</button>
            </form>
        </article>
    }

    const movements = <details>
        <summary>Последние движения склада</summary>
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Время</th>
                        <th>Ингредиент / партия</th>
                        <th>Операция</th>
                        <th>Количество</th>
                        <th>Кто / причина</th>
                    </tr>
                </thead>
                <tbody>
                    {value.movements.slice(-50).reverse().map(function line(item, index) {
                        const ingredientId = value.batches[item.batchId]?.ingredientId
                        const order = item.orderId ? ` #${item.orderId.slice(-6)}` : ''
                        return <tr key={index}>
                            <td>{date(item.at)}</td>
                            <td>{value.ingredients[ingredientId]?.title} / {item.batchId.slice(-8)}</td>
                            <td>{movementKinds[item.kind]}</td>
                            <td>{item.quantity}</td>
                            <td>{item.by}: {item.reason}{order}</td>
                        </tr>
                    })}
                </tbody>
            </table>
        </div>
    </details>

    const live = batches.filter(batch => batch.quantity > 0)

    return <section id="stock-panel" className="panel">
        <h2>Склад ингредиентов</h2>
        <p>
            Резерв — для принятых заказов. Расход происходит при начале приготовления.
            Срок годности проверяется сервером перед расходом.
        </p>
        {!ingredients.length && (
            <p className="empty">Добавьте ингредиент, затем зарегистрируйте поступление.</p>
        )}
        <div className="table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Ингредиент</th>
                        <th>Пригодно</th>
                        <th>Резерв</th>
                        <th>Свободно</th>
                        <th>Просрочено</th>
                    </tr>
                </thead>
                <tbody>{ingredients.map(row)}</tbody>
            </table>
        </div>
        {Object.entries(plan.issues).map(([id, issue]) => (
            <p className="alert" key={id}>
                Заказ #{id.slice(-6)}: {issue}. Пополните склад,
                клиент может отменить заказ до приготовления.
            </p>
        ))}
        {manage && forms}
        <h3>Партии и обнаруженная порча</h3>
        <p>Укажите фактически испорченное количество, включая зарезервированное.</p>
        {!live.length && <p className="empty">На складе пока нет остатков.</p>}
        <div className="cards">{live.map(batchCard)}</div>
        {movements}
    </section>
}
