import type {PizzeriaState, Order} from './service'

export type Ingredient = {id: string, title: string, unit: 'g' | 'ml' | 'pcs'}
export type RecipeLine = {ingredientId: string, quantity: number}
export type Batch = {id: string, ingredientId: string, quantity: number, expiresAt: number, receivedAt: number}
export type Allocation = {batchId: string, quantity: number}
export type StockMovement = {
    batchId: string,
    quantity: number,
    kind: 'received' | 'consumed' | 'spoiled',
    at: number,
    by: string,
    reason: string,
    orderId?: string
}
export type Inventory = {ingredients: Record<string, Ingredient>, batches: Record<string, Batch>, movements: StockMovement[]}

export function positiveQuantity(quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Количество должно быть положительным целым числом')
}
export function validId(id: string) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) throw new Error('ID: латинская буква, затем буквы, цифры, дефис или подчёркивание (до 64 символов)')
}
// ============================================================
// Initial stock
// ============================================================

export function seedInventory(): Inventory {
    const ingredients: Inventory['ingredients'] = {
        dough: {id: 'dough', title: 'Тесто', unit: 'g'}, 
        tomato: {id: 'tomato', title: 'Томатный соус', unit: 'g'}, 
        cheese: {id: 'cheese', title: 'Моцарелла', unit: 'g'}, 
        salami: {id: 'salami', title: 'Салями', unit: 'g'}, 
    }
    const now = Date.now()
    const batches = Object.fromEntries(Object.keys(ingredients).map(id => [id + '-demo', {
        id: id + '-demo', ingredientId: id, quantity: 10000, receivedAt: now, expiresAt: now + 7 * 86400000, 
    }]))
    return {ingredients, batches, movements: Object.values(batches).map(b => ({
        batchId: b.id,
        quantity: b.quantity,
        kind: 'received',
        at: now,
        by: 'system',
        reason: 'Демонстрационное поступление'
    }))}
}

// ============================================================
// Reservation and consumption
// ============================================================

// Rebuild reservations in order of acceptance. A spoiled/expired batch can never
// remain usable just because it was previously reserved. No state is mutated.
type PlanState = Pick<PizzeriaState, 'ingredients' | 'batches'> & {
    orders: Record<string, Pick<Order, 'id' | 'ts' | 'state' | 'requirements'>>
}

export function stockPlan(state: PlanState, now = Date.now()) {
    const free: Record<string, number> = Object.fromEntries(Object.values(state.batches).map(b => [b.id, b.expiresAt > now ? b.quantity : 0]))
    const allocations: Record<string, Allocation[]> = {}
    const issues: Record<string, string> = {}
    const batches = Object.values(state.batches).sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id))
    const waiting = Object.values(state.orders).filter(o => o.state == 'placed').sort((a, b) => a.ts - b.ts)
    for (const order of waiting) {
        const result = allocate(order.requirements, free, batches, state)
        if (typeof result == 'string') issues[order.id] = result
        else {
            allocations[order.id] = result
            for (const a of result) free[a.batchId] -= a.quantity
        }
    }
    return {free, allocations, issues}
}

export function allocate(
    requirements: RecipeLine[] | undefined,
    free: Record<string, number>,
    batches: Batch[],
    state: Pick<PizzeriaState, 'ingredients'>
): Allocation[] | string {
    if (!requirements?.length) return 'У заказа нет сохранённой рецептуры: требуется отмена и повторное оформление'
    const allocations: Allocation[] = []
    for (const need of requirements) {
        let left = need.quantity
        for (const batch of batches) {
            if (batch.ingredientId != need.ingredientId) continue
            const quantity = Math.min(left, free[batch.id] ?? 0)
            if (quantity > 0) {
                allocations.push({batchId: batch.id, quantity})
                left -= quantity
            }
            if (!left) break
        }
        if (left) return `Не хватает: ${state.ingredients[need.ingredientId]?.title ?? need.ingredientId} (${left})`
    }
    return allocations
}

export function consume(state: PizzeriaState, order: Order, by: string) {
    const plan = stockPlan(state)
    if (plan.issues[order.id]) throw new Error(plan.issues[order.id])
    const allocations = plan.allocations[order.id]
    if (!allocations) throw new Error('Заказ не ожидает приготовления')
    order.allocations = allocations
    for (const a of allocations) {
        state.batches[a.batchId].quantity -= a.quantity
        state.movements.push({...a, kind: 'consumed', at: Date.now(), by, reason: 'Приготовление заказа', orderId: order.id})
    }
}
