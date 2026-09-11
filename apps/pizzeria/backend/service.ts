// =====================================================================
// pizzeria — the domain module: roles, multi-level access, one order flow
// =====================================================================
// Domain definition of the application. Five audiences share one state and
// see five different panels:
//   customer  — the public menu, MY orders, place/cancel
//   cook      — the kitchen board (no contacts), start cooking / mark ready
//   courier   — the dispatch board (address + phone of ready orders), pick up / deliver
//   manager   — kitchen + dispatch + staff (no secrets), edits the menu
//   owner     — everything above + revenue, assigns roles
// Every rule of WHO may do WHAT is data in this file: `allow` on commands
// (pruned from facades AND refused by the authority), `allow` on views
// (served only inside matching principals' facades, derived per session or
// per process). Password hashes live in state so every node can verify a
// login — and no view projects them.

import {createHash} from 'node:crypto'
import {kitchenWorkload} from './kitchen-workload'
import {seedInventory, stockPlan, allocate, consume, positiveQuantity, validId, type Inventory, type RecipeLine, type Allocation} from './inventory'
import {Command} from 'wenay-common2'
import {schemaCommand} from 'wenay-common2/service'
import type {ServiceCommandCtx, tServiceDefinition, tServicePrincipal} from 'wenay-common2/service'
import {hashSecret, verifySecret, type tSecret} from './identity'
import {dishDetails, publicDish, validateDishDetails, type DishDetails, type DishCard} from '../shared/dish'
import {createOrganizer} from '../organizer/domain'
import {emptyWork, type WorkState} from '../organizer/model'
import {withWorkAutomation} from './work-automation'
import {createBoardRoom} from '../organizer/collaboration-resource'
import {emptyCanvas} from '../organizer/canvas-model'

// ============================================================
// state
// ============================================================

export const ROLES = ['customer', 'cook', 'courier', 'manager', 'owner'] as const
export type tRole = typeof ROLES[number]

export type Account = {account: string, name: string, phone: string, roles: tRole[], secret: tSecret}
export type MenuItem = {id: string, title: string, price: number, available: boolean, recipe: RecipeLine[]} & Partial<DishDetails>
export type tOrderState = 'placed' | 'cooking' | 'ready' | 'delivering' | 'delivered' | 'cancelled'
export type Order = {
    id: string
    customer: string
    address: string
    phone: string
    items: string[]
    total: number
    lines?: (Pick<DishCard, 'id'|'title'|'price'> & Partial<DishDetails>)[]
    requirements?: RecipeLine[]
    allocations?: Allocation[]
    state: tOrderState
    cook?: string
    courier?: string
    ts: number
    history: {state: tOrderState, ts: number, by: string}[]
}
export type PizzeriaState = Inventory & {
    accounts: Record<string, Account>
    menu: Record<string, MenuItem>
    orders: Record<string, Order>
    organizer: WorkState
}

/** The demo staff and their passwords — printed by the stand, seeded as HASHES. */
export const DEMO_LOGINS = {
    owner: 'owner-pass',
    manager: 'manager-pass',
    chef: 'chef-pass',
    rider: 'rider-pass',
    alice: 'alice-pass',
} as const

function account(name: string, phone: string, roles: tRole[], password: string): Account {
    return {account: name, name: name[0].toUpperCase() + name.slice(1), phone, roles, secret: hashSecret(password)}
}

const ACCOUNT_SHAPE = /^[a-z][a-z0-9_-]{2,31}$/

function transition(order: Order, from: tOrderState[], to: tOrderState, by: string) {
    if (!from.includes(order.state)) throw new Error(`order ${order.id} is ${order.state}, expected ${from.join(' or ')}`)
    order.state = to
    order.history.push({state: to, ts: Date.now(), by})
}

function requireOrder(state: PizzeriaState, orderId: string) {
    const order = state.orders[orderId]
    if (!order) throw new Error(`unknown order: ${orderId}`)
    return order
}

const day = (ts: number) => new Date(ts).toISOString().slice(0, 10)

// ============================================================
// the definition
// ============================================================

const work = createOrganizer<PizzeriaState>({staffRoles:['cook', 'courier', 'manager', 'owner'],
    roleOptions:[{id:'cook', title:'Повар'}, {id:'courier', title:'Курьер'}, {id:'manager', title:'Менеджер'}, {id:'owner', title:'Владелец'}, {
        id:'customer', title:'Клиент'
    }],
    sources:function orderSources(state) {
        const labels={placed:'Принят', cooking:'Готовится', ready:'Готов', delivering:'В пути', delivered:'Доставлен', cancelled:'Отменён'}
        return Object.values(state.orders).map(order=>({id:order.id, label:'Заказ #'+order.id.slice(-6)+' · '+labels[order.state]}))
    },
    workload:{allow:['cook', 'manager', 'owner'], project:kitchenWorkload},
})

const pizzeriaDefinition = {
    name: 'pizzeria',
    version: 5,
    migrate(state: PizzeriaState, fromVersion = 1) {
        const organizer = {...(state.organizer ?? emptyWork()), canvas: state.organizer?.canvas ?? emptyCanvas()}
        const inventory = fromVersion < 2 ? {ingredients: {}, batches: {}, movements: []} : {}
        return {...state, organizer, ...inventory,
            menu: Object.fromEntries(Object.entries(state.menu).map(function upgrade([id, item]) {
                const defaults = fromVersion < 2 ? {recipe: [], available: false} : {}
                return [id, {...item, ...dishDetails(item), ...defaults}]
            }))}
    },
    storeId: 'pizzeria-store',
    originId: 'pizzeria-origin',
    initial: {
        ...seedInventory(),
        accounts: {
            owner: account('owner', '+1-555-0100', ['owner', 'manager'], DEMO_LOGINS.owner),
            manager: account('manager', '+1-555-0101', ['manager'], DEMO_LOGINS.manager),
            chef: account('chef', '+1-555-0102', ['cook'], DEMO_LOGINS.chef),
            rider: account('rider', '+1-555-0103', ['courier'], DEMO_LOGINS.rider),
            alice: account('alice', '+1-555-0110', ['customer'], DEMO_LOGINS.alice),
        },
        menu: {
            margherita: {
                id: 'margherita', title: 'Margherita',
                description: 'Тонкое тесто, томатный соус и нежная моцарелла. Выпекаем после вашего заказа.',
                portion: '30 см', photos: ['default:margherita'], price: 9, available: true,
                recipe: [{ingredientId: 'dough', quantity: 250}, {ingredientId: 'tomato', quantity: 80}, {
                    ingredientId:'cheese', quantity:100
                }]
            },
            diavola: {
                id: 'diavola', title: 'Diavola',
                description: 'Пицца с пряной салями, томатным соусом и расплавленной моцареллой.',
                portion: '30 см', photos: ['default:pepperoni'], price: 12, available: true,
                recipe: [{ingredientId: 'dough', quantity: 250}, {ingredientId: 'tomato', quantity: 80},
                    {ingredientId: 'cheese', quantity: 100}, {
                    ingredientId:'salami', quantity:60
                }]
            },
            calzone: {
                id: 'calzone', title: 'Calzone', price: 11, available: false, recipe: [{ingredientId:'dough', quantity:250}, {
                    ingredientId:'cheese', quantity:150
                }]
            },
        },
        orders: {},
        organizer: emptyWork(),
    } as PizzeriaState,

    // ============== identity above the library: roles from state, credentials → account ==============
    access: {
        rolesOf: (state: PizzeriaState, who: string) => state.accounts[who]?.roles ?? [],
        login: {
            input: {account: 'string', password: 'string'},
            resolve(state: PizzeriaState, input: {account: string, password: string}) {
                return verifySecret(state.accounts[input.account]?.secret, input.password) ? input.account : null
            },
        },
        signup: {input: {account: 'string', name: 'string', phone: 'string', password: 'string'}, command: 'signup'},
    },

    // ============== commands: who may do what is `allow`, enforced twice ==============
    commands: {
        ...work.commands,
        workRefresh:schemaCommand({}, {allow:['system'], apply() {return {ok:true}}}),
        signup: schemaCommand({account: 'string', name: 'string', phone: 'string', password: 'string'}, {
            allow: ['system'],
            validate(input) {
                if (!ACCOUNT_SHAPE.test(input.account)) throw new Error('account must match ' + ACCOUNT_SHAPE)
                if (input.password.length < 6) throw new Error('password must be at least 6 characters')
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                if (ctx.state.accounts[input.account]) throw new Error(`account ${input.account} already exists`)
                ctx.state.accounts[input.account] = {
                    account: input.account, name: input.name, phone: input.phone, roles: ['customer'], secret: hashSecret(input.password),
                }
                return {account: input.account, name: input.name, roles: ['customer'] as tRole[]}
            },
        }),
        placeOrder: schemaCommand({items: {array: 'string'}, address: 'string'}, {
            allow: ['customer'],
            validate(input) {
                if (input.address.trim().length < 5) throw new Error('Укажите адрес доставки (минимум 5 символов)')
                if (input.items.length == 0) throw new Error('an order needs at least one item')
                if (input.items.length > 20) throw new Error('at most 20 items per order')
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                let total = 0
                const needs: Record<string, number> = {}
                const lines: DishCard[] = []
                for (const itemId of input.items) {
                    const item = ctx.state.menu[itemId]
                    if (!item || !item.available) throw new Error(`${itemId} is not on the menu`)
                    if (!item.recipe.length) throw new Error('У блюда не настроена рецептура')
                    lines.push({...publicDish(item, ctx.state.ingredients), photos:[...dishDetails(item).photos]})
                    for (const part of item.recipe) needs[part.ingredientId] = (needs[part.ingredientId] ?? 0) + part.quantity
                    total += item.price
                }
                const requirements = Object.entries(needs).map(([ingredientId, quantity]) => ({ingredientId, quantity}))
                for (const need of requirements) positiveQuantity(need.quantity)
                const plan = stockPlan(ctx.state)
                const reservation = allocate(requirements, plan.free, Object.values(ctx.state.batches).sort((a, b) => a.expiresAt-b.expiresAt), ctx.state)
                if (typeof reservation == 'string') throw new Error(reservation)
                const id = 'o-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId)).digest('hex')
                if (Object.hasOwn(ctx.state.orders, id)) throw new Error('order request already used')
                const me = ctx.state.accounts[ctx.account]
                // Receipt scope prevents cross-account collisions; the digest keeps the tuple off the public ID.
                const order: Order = {
                    id, customer: ctx.account, address: input.address, phone: me?.phone ?? '',
                    items: [...input.items], lines, requirements, total: Math.round(total * 100) / 100, state: 'placed', ts: Date.now(),
                    history: [{state: 'placed', ts: Date.now(), by: ctx.account}],
                }
                ctx.state.orders[order.id] = order
                return {...order}
            },
        }),
        cancelOrder: schemaCommand({orderId: 'string'}, {
            allow: ['customer'],
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const order = requireOrder(ctx.state, input.orderId)
                if (order.customer != ctx.account) throw new Error('only the customer who ordered may cancel')
                transition(order, ['placed'], 'cancelled', ctx.account)
                return {id: order.id, state: order.state}
            },
        }),
        startCooking: schemaCommand({orderId: 'string'}, {
            allow: ['cook'],
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const order = requireOrder(ctx.state, input.orderId)
                if (order.state != 'placed') throw new Error('Заказ уже не ожидает приготовления')
                consume(ctx.state, order, ctx.account)
                transition(order, ['placed'], 'cooking', ctx.account)
                order.cook = ctx.account
                return {id: order.id, state: order.state, cook: ctx.account}
            },
        }),
        markReady: schemaCommand({orderId: 'string'}, {
            allow: ['cook'],
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const order = requireOrder(ctx.state, input.orderId)
                if (order.cook != ctx.account) throw new Error('only the cook who started it may mark it ready')
                transition(order, ['cooking'], 'ready', ctx.account)
                return {id: order.id, state: order.state}
            },
        }),
        pickUp: schemaCommand({orderId: 'string'}, {
            allow: ['courier'],
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const order = requireOrder(ctx.state, input.orderId)
                transition(order, ['ready'], 'delivering', ctx.account)
                order.courier = ctx.account
                return {id: order.id, state: order.state, courier: ctx.account, address: order.address}
            },
        }),
        markDelivered: schemaCommand({orderId: 'string'}, {
            allow: ['courier'],
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const order = requireOrder(ctx.state, input.orderId)
                if (order.courier != ctx.account) throw new Error('only the courier who picked it up may deliver it')
                transition(order, ['delivering'], 'delivered', ctx.account)
                return {id: order.id, state: order.state, total: order.total}
            },
        }),
        setMenuItem: schemaCommand({
            id: 'string', title: 'string', price: 'number', available: 'boolean',
            recipe: {array: {object: {ingredientId: 'string', quantity: 'number'}}},
            description: 'string?', composition: 'string?', portion: 'string?',
            photos: {array: 'string', optional: true}
        }, {
            allow: ['manager', 'owner'],
            validate(input) {
                validId(input.id)
                validateDishDetails(input)
                if (!input.title.trim() || input.title.length > 100) throw new Error('Название: от 1 до 100 символов')
                const rounded = Math.abs(input.price * 100 - Math.round(input.price * 100)) <= 0.000001
                const priced = input.price >= 0 && input.price <= 100000 && rounded
                if (!priced) throw new Error('Цена: от 0 до 100000, максимум два знака после запятой')
                if (!input.recipe.length || input.recipe.length > 50) throw new Error('В рецепте нужно от 1 до 50 ингредиентов')
                if (new Set(input.recipe.map(p => p.ingredientId)).size != input.recipe.length) throw new Error('Ингредиенты рецепта не должны повторяться')
                for (const part of input.recipe) positiveQuantity(part.quantity)
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                for (const part of input.recipe) {
                    if (Object.hasOwn(ctx.state.ingredients, part.ingredientId)) continue
                    throw new Error('Неизвестный ингредиент: ' + part.ingredientId)
                }
                const details = dishDetails({...ctx.state.menu[input.id], ...input})
                ctx.state.menu[input.id] = {
                    id: input.id, title: input.title.trim(), price: input.price,
                    available: input.available, recipe: input.recipe.map(p => ({
                    ...p
                })),
                    ...details,
                    description: details.description.trim(),
                    composition: details.composition.trim(),
                    portion: details.portion.trim(),
                    photos: [...details.photos]}
                return {...ctx.state.menu[input.id]}
            },
        }),
        addIngredient: schemaCommand({id:'string', title:'string', unit:{enum:['g', 'ml', 'pcs']}}, {
            allow: ['manager', 'owner'],
            validate(input) {
                validId(input.id)
                if (!input.title.trim() || input.title.length > 100) throw new Error('Укажите название до 100 символов')
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                if (Object.hasOwn(ctx.state.ingredients, input.id)) throw new Error('Ингредиент с таким ID уже есть')
                ctx.state.ingredients[input.id] = {...input, title: input.title.trim()}
                return {id: input.id}
            },
        }),
        receiveStock: schemaCommand({ingredientId:'string', quantity:'number', expiresAt:'string'}, {
            allow: ['manager', 'owner'],
            validate(input) {
                positiveQuantity(input.quantity)
                const expires = Date.parse(input.expiresAt)
                if (!Number.isFinite(expires) || expires <= Date.now()) {
                    throw new Error('Срок годности должен быть в будущем')
                }
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                if (!Object.hasOwn(ctx.state.ingredients, input.ingredientId)) throw new Error('Неизвестный ингредиент')
                const id = 'b-' + createHash('sha256').update(Command.commandReceiptKey(ctx.account, ctx.requestId)).digest('hex')
                if (Object.hasOwn(ctx.state.batches, id)) throw new Error('Поступление уже зарегистрировано')
                const at = Date.now()
                ctx.state.batches[id] = {id, ingredientId: input.ingredientId, quantity: input.quantity, expiresAt: Date.parse(input.expiresAt), receivedAt: at}
                ctx.state.movements.push({batchId:id, quantity:input.quantity, kind:'received', at, by:ctx.account, reason:'Поступление'})
                return {id}
            },
        }),
        spoilStock: schemaCommand({batchId:'string', quantity:'number', reason:'string'}, {
            allow: ['cook', 'manager', 'owner'],
            validate(input) {
                positiveQuantity(input.quantity)
                if (!input.reason.trim() || input.reason.length > 300) throw new Error('Укажите причину до 300 символов')
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                if (!Object.hasOwn(ctx.state.batches, input.batchId)) throw new Error('Неизвестная партия')
                const batch = ctx.state.batches[input.batchId]
                if (!batch || input.quantity > batch.quantity) throw new Error('Количество превышает остаток партии')
                batch.quantity -= input.quantity
                ctx.state.movements.push({batchId:batch.id, quantity:input.quantity, kind:'spoiled', at:Date.now(), by:ctx.account, reason:input.reason.trim()})
                return {id:batch.id, quantity:batch.quantity}
            },
        }),
        setRoles: schemaCommand({account: 'string', roles: {array: 'string'}}, {
            allow: ['owner'],
            validate(input) {
                for (const role of input.roles) if (!ROLES.includes(role as tRole)) throw new Error(`unknown role: ${role}`)
            },
            apply(ctx: ServiceCommandCtx<PizzeriaState>, input) {
                const target = ctx.state.accounts[input.account]
                if (!target) throw new Error(`unknown account: ${input.account}`)
                if (input.account == ctx.account && !input.roles.includes('owner')) throw new Error('an owner cannot drop the owner role')
                target.roles = [...new Set(input.roles as tRole[])]
                return {account: target.account, roles: [...target.roles]}
            },
        }),
    },

    // ============== views: what each audience reads, as its own line ==============
    views: {
        ...work.views,
        inventory: {
            allow: ['cook', 'manager', 'owner'], shared: true, keys: ['ingredients', 'batches', 'movements', 'orders'],
            project: (state: PizzeriaState) => ({
                ingredients: state.ingredients, batches: state.batches, movements: state.movements,
                waiting: Object.values(state.orders).filter(o => o.state == 'placed').map(o => ({
                    id:o.id, ts:o.ts, requirements:o.requirements
                }))
            }),
        },
        catalog: {
            allow: ['manager', 'owner'], shared: true, keys: ['menu'],
            project: (state: PizzeriaState) => ({items: Object.values(state.menu)}),
        },
        /** Anyone: the available menu. */
        menu: {
            allow: 'public', keys: ['menu', 'ingredients'],
            project: (state: PizzeriaState) => ({
                items: Object.values(state.menu).filter(item => item.available).map(item => publicDish(item, state.ingredients)),
            }),
        },
        /** A customer: MY orders — one line per session, filtered by the principal. */
        myOrders: {
            allow: ['customer'], keys: ['orders'],
            project(state: PizzeriaState, principal: tServicePrincipal | null) {
                const orders: Record<string, Order> = {}
                for (const order of Object.values(state.orders)) if (order.customer == principal?.account) orders[order.id] = {...order}
                return {orders}
            },
        },
        /** The kitchen: open orders WITHOUT contacts — one line per process. */
        kitchen: {
            allow: ['cook', 'manager', 'owner'], shared: true, keys: ['orders'],
            project(state: PizzeriaState) {
                const orders: Record<string, {id: string, items: string[], state: tOrderState, cook?: string, ts: number}> = {}
                for (const order of Object.values(state.orders)) {
                    if (order.state != 'placed' && order.state != 'cooking' && order.state != 'ready') continue
                    orders[order.id] = {
                        id: order.id,
                        items: order.lines?.map(line => line.title) ?? order.items,
                        state: order.state, ...(order.cook ? {cook: order.cook} : {}), ts: order.ts
                    }
                }
                return {orders}
            },
        },
        /** Dispatch: ready and delivering orders WITH the address and phone a courier needs. */
        dispatch: {
            allow: ['courier', 'manager', 'owner'], shared: true, keys: ['orders'],
            project(state: PizzeriaState) {
                const orders: Record<string, {id: string, address: string, phone: string, state: tOrderState, courier?: string}> = {}
                for (const order of Object.values(state.orders)) {
                    if (order.state != 'ready' && order.state != 'delivering') continue
                    orders[order.id] = {
                        id: order.id, address: order.address, phone: order.phone, state: order.state, ...(order.courier ? {courier: order.courier} : {})
                    }
                }
                return {orders}
            },
        },
        /** Staff: every account WITHOUT its secret. */
        staff: {
            allow: ['manager', 'owner'], shared: true, keys: ['accounts'],
            project(state: PizzeriaState) {
                const accounts: Record<string, {account: string, name: string, phone: string, roles: tRole[]}> = {}
                for (const entry of Object.values(state.accounts)) {
                    accounts[entry.account] = {account: entry.account, name: entry.name, phone: entry.phone, roles: [...entry.roles]}
                }
                return {accounts}
            },
        },
        /** The owner: delivered revenue by day. */
        revenue: {
            allow: ['owner'], shared: true, keys: ['orders'],
            project(state: PizzeriaState) {
                const byDay: Record<string, number> = {}
                let delivered = 0
                let total = 0
                for (const order of Object.values(state.orders)) {
                    if (order.state != 'delivered') continue
                    delivered++
                    total += order.total
                    const deliveredAt = order.history.findLast(entry => entry.state == 'delivered')?.ts ?? order.ts
                    byDay[day(deliveredAt)] = Math.round(((byDay[day(deliveredAt)] ?? 0) + order.total) * 100) / 100
                }
                return {delivered, total: Math.round(total * 100) / 100, byDay}
            },
        },
    },
} satisfies tServiceDefinition<PizzeriaState>

export function createPizzeriaService(deps: {directory?: string, provider?: AssistantProvider} = {}) {
    const room = createBoardRoom({allow: work.views.work.allow})
    const screen = createScreenRoom({allow: work.views.work.allow})
    const chat = createChatRoom({allow: work.views.work.allow, directory: deps.directory, provider: deps.provider})
    return {definition: {
        ...pizzeriaDefinition, commands: withWorkAutomation(pizzeriaDefinition.commands), resources: {
            board: room.resource, screen: screen.resource, chat: chat.resource
        }
    },
        mount(store: Parameters<typeof room.mount<PizzeriaState>>[0]['store']) {
            const closeBoard = room.mount({store, project: work.views.work.project})
            const closeScreen = screen.mount()
            const closeChat = chat.mount({
                store, project: work.views.work.project, principal: (state, account) => ({account, roles: state.accounts[account]?.roles ?? []})
            })
            return function close() {
                closeChat()
                closeScreen()
                closeBoard()
            }
        }}
}
export const serviceDefinition = createPizzeriaService().definition

export type PizzeriaDefinition = typeof serviceDefinition

import {createScreenRoom} from '../organizer/screen-resource'
import {createChatRoom} from '../organizer/chat-resource'
import type {AssistantProvider} from '../organizer/assistant-resource'
