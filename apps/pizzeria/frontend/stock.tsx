import React, {useEffect, useState} from 'react'
import {stockPlan, type Inventory} from '../backend/inventory'
import type {serviceDefinition} from '../backend/service'

import type {tCommandRun} from '../shared/react/command-action'
import type {tClientCommands} from 'wenay-common2/service/client'
type tRun=tCommandRun<Pick<tClientCommands<typeof serviceDefinition>,'addIngredient'|'receiveStock'|'spoilStock'>>
const units = {g:'г', ml:'мл', pcs:'шт.'}
function date(at: number) {
    return new Date(at).toLocaleString('ru-RU')
}
type StockData = ReturnType<typeof serviceDefinition.views.inventory.project>

export function Stock({value, manage, busy, run}: {value:StockData, manage:boolean, busy:boolean, run:tRun}) {
    const [now, setNow] = useState(Date.now())
    useEffect(function trackExpiry() {
        const timer = setInterval(function tick() {setNow(Date.now())}, 1000)
        return function stopClock() {clearInterval(timer)}
    }, [])
    const ingredients = Object.values(value.ingredients)
    const batches = Object.values(value.batches).sort((a,b) => a.expiresAt-b.expiresAt)
    const plan = stockPlan({...value, orders:Object.fromEntries(value.waiting.map(o => [o.id,{...o,state:'placed' as const}]))}, now)
    return <section id="stock-panel" className="panel"><h2>Склад ингредиентов</h2><p>Резерв — для принятых заказов. Расход происходит при начале приготовления. Срок годности проверяется сервером перед расходом.</p>
        {!ingredients.length && <p className="empty">Добавьте ингредиент, затем зарегистрируйте поступление.</p>}
        <div className="table-scroll"><table><thead><tr><th>Ингредиент</th><th>Пригодно</th><th>Резерв</th><th>Свободно</th><th>Просрочено</th></tr></thead><tbody>{ingredients.map(function ingredientRow(i) {
            const own = batches.filter(b => b.ingredientId == i.id)
            const good = own.reduce((n,b) => n+(b.expiresAt > now ? b.quantity : 0),0)
            const free = own.reduce((n,b) => n+(plan.free[b.id] ?? 0),0)
            const expired = own.reduce((n,b) => n+(b.expiresAt <= now ? b.quantity : 0),0)
            return <tr key={i.id}><td>{i.title} <small>({units[i.unit]})</small></td><td>{good}</td><td>{good-free}</td><td>{free}</td><td>{expired}</td></tr>
        })}</tbody></table></div>
        {Object.entries(plan.issues).map(([id, issue]) => <p className="alert" key={id}>Заказ #{id.slice(-6)}: {issue}. Пополните склад
            клиент может отменить заказ до приготовления.</p>)}
        {manage && <><h3>Новый ингредиент</h3><form className="row" onSubmit={async function addIngredient(e) {
            e.preventDefault()
            const form=e.currentTarget
            const d=new FormData(form)
            if (await run('addIngredient',{id:String(d.get('id')),title:String(d.get('title')),unit:String(d.get('unit')) as 'g'|'ml'|'pcs'})) form.reset()
        }}><label>ID<input name="id" required pattern="[a-z][a-z0-9_-]{0,63}" placeholder="mushrooms"/></label><label>Название<input name="title" required maxLength={100}/></label><label>Единица<select name="unit"><option value="g">Граммы</option><option value="ml">Миллилитры</option><option value="pcs">Штуки</option></select></label><button disabled={busy}>Добавить ингредиент</button></form>
        <h3>Поступление партии</h3><form className="row" onSubmit={async function receiveStock(e) {
            e.preventDefault()
            const form=e.currentTarget
            const d=new FormData(form)
            if (await run('receiveStock',{ingredientId:String(d.get('ingredientId')),quantity:Number(d.get('quantity')),expiresAt:new Date(String(d.get('expiresAt'))).toISOString()})) form.reset()
        }}><label>Ингредиент<select name="ingredientId" required>{ingredients.map(i=><option key={i.id} value={i.id}>{i.title} ({units[i.unit]})</option>)}</select></label><label>Количество<input name="quantity" type="number" min="1" step="1" required/></label><label>Годен до (местное время)<input name="expiresAt" type="datetime-local" required/></label><button disabled={busy||!ingredients.length}>Принять на склад</button></form></>}
        <h3>Партии и обнаруженная порча</h3><p>Укажите фактически испорченное количество, включая зарезервированное. Для списания всей партии укажите весь остаток. Уже израсходованное количество повторно не списывается.</p>
        {!batches.some(b=>b.quantity>0) && <p className="empty">На складе пока нет остатков.</p>}
        <div className="cards">{batches.filter(b=>b.quantity>0).map(b=><article className="batch" key={b.id}><h3>{value.ingredients[b.ingredientId]?.title}</h3><small>Партия #{b.id.slice(-8)} · поступила {date(b.receivedAt)}</small><p>Остаток: <b>{b.quantity} {units[value.ingredients[b.ingredientId].unit]}</b><br/><span className={b.expiresAt<=now?'expired':''}>Годен до {date(b.expiresAt)}{b.expiresAt<=now?' · Просрочено':''}</span></p><form className="row" onSubmit={async function spoilStock(e) {
            e.preventDefault()
            const form=e.currentTarget
            const d=new FormData(form)
            if(await run('spoilStock',{batchId:b.id,quantity:Number(d.get('quantity')),reason:String(d.get('reason'))})) form.reset()
        }}><label>Испорчено<input name="quantity" type="number" min="1" max={b.quantity} step="1" required/></label><label>Причина<input name="reason" required maxLength={300} placeholder="Плесень, нарушено хранение…"/></label><button disabled={busy}>Списать порчу</button></form></article>)}</div>
        <details><summary>Последние движения склада</summary><div className="table-scroll"><table><thead><tr><th>Время</th><th>Ингредиент / партия</th><th>Операция</th><th>Количество</th><th>Кто / причина</th></tr></thead><tbody>{value.movements.slice(-50).reverse().map((m,index)=><tr key={index}><td>{date(m.at)}</td><td>{value.ingredients[value.batches[m.batchId]?.ingredientId]?.title} / {m.batchId.slice(-8)}</td><td>{{received:'Поступление',consumed:'Расход',spoiled:'Порча'}[m.kind]}</td><td>{m.quantity}</td><td>{m.by}: {m.reason}{m.orderId && ` #${m.orderId.slice(-6)}`}</td></tr>)}</tbody></table></div></details>
    </section>
}
