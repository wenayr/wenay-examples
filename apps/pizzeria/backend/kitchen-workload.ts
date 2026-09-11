import type {PizzeriaState} from './service'
import type {Workload} from '../organizer/model'

export function kitchenWorkload(state:PizzeriaState):Workload {
    const orders=Object.values(state.orders)
    const waiting=orders.filter(order=>order.state=='placed')
    const active=orders.filter(order=>order.state=='cooking')
    // Keep a cook with unfinished orders visible even if their role was changed.
    const accounts=new Set([...Object.values(state.accounts).filter(person=>person.roles.includes('cook')).map(person=>person.account),...active.map(order=>order.cook).filter((account):account is string=>!!account)])
    return {
        queue:{orders:waiting.length,dishes:waiting.reduce((sum,order)=>sum+order.items.length,0)},
        people:[...accounts].map(function personLoad(account) {
            const assigned=active.filter(order=>order.cook==account)
            const starts=assigned.flatMap(order=>order.history.filter(event=>event.state=='cooking').map(event=>event.ts))
            return {account,orders:assigned.length,dishes:assigned.reduce((sum,order)=>sum+order.items.length,0),oldestStartedAt:starts.length?Math.min(...starts):null}
        }),
    }
}
