import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {serviceDefinition, type PizzeriaState} from './service'
import {stockPlan} from './inventory'

async function main() {
    const leader = createServiceLeader({definition: serviceDefinition, selfUrl: () => 'http://localhost', log: () => {}})
    let seq = 0
    function command(account: string, name: string, input: unknown, id = `stock-${++seq}`) {
        const key = name as keyof typeof serviceDefinition.commands
        return leader.corridor.execute(account, key, id, input as never) as Promise<any>
    }
    const state = () => leader.line.control.store.snapshot()
    try {
        await assert.rejects(command('alice', 'addIngredient', {id: 'mushroom', title: 'Грибы', unit: 'g'}), /forbidden/)
        await command('manager', 'addIngredient', {id: 'mushroom', title: 'Грибы', unit: 'g'})
        await assert.rejects(command('manager', 'receiveStock', {
            ingredientId: 'mushroom',
            quantity: 0.5,
            expiresAt: new Date(Date.now()+60000).toISOString()
        }), /целым/)
        await assert.rejects(command('manager', 'receiveStock', {ingredientId: 'mushroom', quantity: 10, expiresAt: '2000-01-01'}), /будущем/)
        const receive = (quantity: number, days: number, id?: string) => command('manager', 'receiveStock', {
            ingredientId: 'mushroom',
            quantity,
            expiresAt: new Date(Date.now()+days*86400000).toISOString()
        }, id)
        const first = await receive(100, 1, 'first-delivery')
        const replay = await receive(100, 1, 'first-delivery')
        assert.equal(first.id, replay.id)
        assert.equal(state().batches[first.id].quantity, 100)
        const second = await receive(100, 2)
        const dish = {
            id: 'mushroom-pizza',
            title: 'Грибная',
            description: 'Грибы на тонком тесте',
            composition: 'Грибы',
            portion: '250 г',
            photos: ['default:vegetable'],
            price: 10,
            available: true,
            recipe: [{ingredientId: 'mushroom', quantity: 80}]
        }
        await assert.rejects(command('manager', 'setMenuItem', {...dish, photos: ['https://example.com/image.svg']}), /фотографию/)
        await assert.rejects(command('manager', 'setMenuItem', {...dish, description: 'x'.repeat(1201)}), /1200/)
        await assert.rejects(command('manager', 'setMenuItem', {...dish, photos: Array(6).fill('default:vegetable')}), /пяти/)
        await assert.rejects(command('manager', 'setMenuItem', {...dish, recipe: [...dish.recipe, ...dish.recipe]}), /повторяться/)
        await assert.rejects(command('manager', 'setMenuItem', {...dish, recipe: [{ingredientId: 'missing', quantity: 1}]}), /Неизвестный/)
        await command('manager', 'setMenuItem', dish)
        const publicMenu = serviceDefinition.views.menu.project(state()).items.find(item => item.id==dish.id)!
        assert.equal(publicMenu.description, dish.description)
        assert.deepEqual(publicMenu.photos, dish.photos)
        assert.equal('recipe' in publicMenu, false, 'public menu excludes kitchen quantities')
        const place = (id?: string) => command('alice', 'placeOrder', {items: [dish.id], address: 'Тестовая улица, 1'}, id)
        const order = await place('order-1')
        assert.equal((await place('order-1')).id, order.id)
        assert.equal(stockPlan(state()).free[first.id], 20)
        assert.equal(state().batches[first.id].quantity, 100, 'reservation does not consume stock')
        const order2 = await place()
        await assert.rejects(place(), /Не хватает/)
        await command('alice', 'cancelOrder', {orderId: order2.id})
        assert.equal(stockPlan(state()).free[second.id], 100, 'cancellation releases reservation')
        await command('manager', 'setMenuItem', {...dish, title: 'Новая рецептура', recipe: [{ingredientId: 'mushroom', quantity: 180}]})
        assert.equal(state().orders[order.id].requirements?.[0].quantity, 80, 'accepted recipe is immutable')
        assert.equal(state().orders[order.id].lines?.[0].title, 'Грибная')
        assert.equal(state().orders[order.id].lines?.[0].composition, 'Грибы')
        await command('manager', 'setMenuItem', {...dish, description: 'Новое описание', composition: 'Новый состав', photos: []})
        assert.equal(state().orders[order.id].lines?.[0].description, dish.description)
        assert.deepEqual(state().orders[order.id].lines?.[0].photos, dish.photos, 'accepted photographs remain a snapshot')
        await command('chef', 'spoilStock', {batchId: first.id, quantity: 100, reason: 'Плесень'}, 'spoil-1')
        await command('chef', 'spoilStock', {batchId: first.id, quantity: 100, reason: 'Плесень'}, 'spoil-1')
        assert.equal(state().movements.filter(m => m.kind=='spoiled').length, 1)
        assert.equal(stockPlan(state()).allocations[order.id][0].batchId, second.id, 'replacement reserve uses a good batch')
        await command('chef', 'spoilStock', {batchId: second.id, quantity: 30, reason: 'Нарушено хранение'})
        const before = state()
        await assert.rejects(command('chef', 'startCooking', {orderId: order.id}), /Не хватает/)
        assert.deepEqual(state(), before, 'failed cooking leaves all stock and order state intact')
        const third = await receive(20, 3)
        await command('chef', 'startCooking', {orderId: order.id}, 'cook-1')
        await command('chef', 'startCooking', {orderId: order.id}, 'cook-1')
        assert.equal(state().batches[second.id].quantity, 0)
        assert.equal(state().batches[third.id].quantity, 10)
        assert.equal(state().movements.filter(m => m.kind=='consumed').reduce((n, m) => n+m.quantity, 0), 80)
        await assert.rejects(command('chef', 'spoilStock', {batchId: third.id, quantity: 11, reason: 'Порча'}), /превышает/)
        await assert.rejects(command('alice', 'spoilStock', {batchId: third.id, quantity: 1, reason: 'Порча'}), /forbidden/)
        const expired = structuredClone(state())
        expired.orders[order.id].state='placed'
        for (const b of Object.values(expired.batches)) b.expiresAt = Date.now()-1
        const restored = createServiceLeader({definition: {...serviceDefinition, initial: expired}, selfUrl: () => 'http://localhost', log: () => {}})
        try {
            const late = restored.corridor.execute('chef', 'startCooking', 'expired-order', {
                orderId: order.id
            })
            await assert.rejects(late, /Не хватает/)
        } finally {
            restored.control.close()
        }
        const migrated = serviceDefinition.migrate({accounts: state().accounts, menu: state().menu, orders: state().orders} as PizzeriaState)
        assert.deepEqual(migrated.orders, state().orders)
        assert.equal(migrated.menu[dish.id].available, false)
        assert.equal(migrated.menu[dish.id].recipe.length, 0)
        assert.deepEqual(migrated.batches, {})
        const upgraded = serviceDefinition.migrate(state(), 2)
        assert.deepEqual(upgraded.batches, state().batches, 'v2 migration preserves inventory')
        assert.deepEqual(upgraded.menu[dish.id].recipe, state().menu[dish.id].recipe)
        assert.deepEqual(upgraded.orders, state().orders)
        assert.equal(upgraded.menu[dish.id].available, true)
        console.log('PASS inventory: roles, recipes, reservations, cancellation, FEFO, spoilage, expiry, retries and migration')
    } finally {leader.control.close()}
}
main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
