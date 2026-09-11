import {stockPlan} from './inventory'
import type {PizzeriaState} from './service'
import type {ServiceCommandCtx,tServiceCommand} from 'wenay-common2/service'
import {WORK_COLUMNS,type WorkTask} from '../organizer/model'
import {cloneStoreValue} from 'wenay-common2/observe'

// Source-derived tasks have stable IDs and stay read-only on the work board.
export function synchronizeWork(state:PizzeriaState,now=Date.now()) {
    const work=state.organizer
    const wanted:WorkTask[]=[]
    function task(id:string,title:string,status:WorkTask['status'],source:NonNullable<WorkTask['source']>,audience:string[],assignee='',description='') {
        wanted.push({id,title,status,source,audience,assignee,description,createdBy:'system',automatic:true,due:'',priority:source.kind=='stock'?'high':'normal',revision:0})
    }
    for (const order of Object.values(state.orders)) {
        const label='Заказ #'+order.id.slice(-6)
        const source={kind:'order' as const,id:order.id,label}
        task('auto-kitchen-'+order.id,'Приготовить · '+label,order.state=='placed'?'todo':order.state=='cooking'?'doing':'done',source,['cook'],order.cook,
            order.state=='cancelled'?'Заказ отменён':(order.lines?.map(line=>line.title) ?? order.items).join(', '))
        if (['ready','delivering','delivered'].includes(order.state)) task('auto-delivery-'+order.id,'Доставить · '+label,order.state=='ready'?'todo':order.state=='delivering'?'doing':'done',source,['courier'],order.courier)
    }
    const plan=stockPlan(state,now)
    for (const [id,issue] of Object.entries(plan.issues)) task('auto-shortage-'+id,'Пополнить склад · заказ #'+id.slice(-6),'todo',{kind:'stock',id,label:'Нехватка для заказа #'+id.slice(-6)},['cook'], '',issue)
    for (const batch of Object.values(state.batches)) if (batch.quantity>0 && batch.expiresAt<=now) {
        task('auto-expired-'+batch.id,'Списать просрочку · '+state.ingredients[batch.ingredientId]?.title,'todo',{kind:'stock',id:batch.id,label:'Партия #'+batch.id.slice(-8)},['cook'],'','Остаток: '+batch.quantity)
    }
    const ids=new Set(wanted.map(task=>task.id))
    for (const previous of Object.values(work.tasks)) if (previous.automatic&&!ids.has(previous.id)&&previous.status!='done') {
        wanted.push({...cloneStoreValue(previous),status:'done',description:'Проблема устранена'})
    }
    for (const next of wanted) {
        const previous=work.tasks[next.id]
        if (previous && JSON.stringify({...previous,revision:0})==JSON.stringify({...next,revision:0})) continue
        const moved=!previous||previous.status!=next.status
        next.revision=(previous?.revision ?? 0)+1
        work.tasks[next.id]=next
        if (moved) {
            for (const column of WORK_COLUMNS) work.columns[column.key]=work.columns[column.key].filter(id=>id!=next.id)
            work.columns[next.status].push(next.id)
        }
    }
}

export function withWorkAutomation<C extends Record<string,tServiceCommand<PizzeriaState>>>(commands:C):C {
    return Object.fromEntries(Object.entries(commands).map(([name,command])=>[name,{...command,apply:function applyAndUpdateBoard(ctx:ServiceCommandCtx<PizzeriaState>,input:unknown) {
        const result=command.apply(ctx,input)
        synchronizeWork(ctx.state)
        return result
    }}])) as C
}
