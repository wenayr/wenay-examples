import assert from 'node:assert/strict'
import {mkdtempSync,realpathSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createProcess} from '../backend/process-resource'
import {createServiceClient,describeService,type ServiceClient} from 'wenay-common2/service/client'
import {createServiceLeader} from 'wenay-common2/service/server'
import {serviceDefinition} from '../backend/service'
import {organizerDefinition} from './service'
import type {WorkView} from './model'

async function waitFor(label:string,predicate:()=>boolean) {
    const deadline=Date.now()+15000
    while(!predicate()) {
        if(Date.now()>deadline)throw new Error('Timeout: '+label)
        await new Promise(function tick(resolve) {setTimeout(resolve,30)})
    }
}

async function standalone() {
    const root=realpathSync(tmpdir())
    const directory=mkdtempSync(path.join(root,'organizer-check-'))
    const env={SERVICE_DATA_DIR:directory,SERVICE_PORT:'0',SERVICE_TOKEN_SECRET:randomBytes(32).toString('hex'),SERVICE_NODE_TOKEN:randomBytes(32).toString('hex')}
    let host=createProcess({script:'../organizer/server.ts',env})
    let url=await host.ready
    const clients:ServiceClient<typeof organizerDefinition>[]=[]
    async function client(account:string,password=account+'-pass') {
        const answer=await fetch(url+'/api/organizer/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[{account,password}]})}).then(response=>response.json())
        assert(answer.ok)
        const session=createServiceClient<typeof organizerDefinition>({definition:describeService(organizerDefinition),url,auth:{token:answer.value.token}})
        clients.push(session)
        await session.ready()
        await session.views.work.ready
        return session
    }
    try {
        const owner=await client('owner')
        const manager=await client('manager')
        const worker=await client('worker')
        const person={account:'nina',name:'Нина',roles:['member'],position:'Оператор',note:'Внутренняя заметка',password:'nina-pass'}
        await assert.rejects(manager.commands.workSavePerson('forbidden-person',person),/владелец/)
        await owner.commands.workSavePerson('create-person',person)
        const nina=await client('nina')
        assert.equal(nina.views.work.store.state.people.find(person=>person.account=='nina')?.note,'')
        const draft={id:'',revision:0,title:'Проверить оборудование',description:'Перед началом смены',assignee:'worker',due:'2026-09-10',priority:'normal' as const,sourceId:'',checklist:[{title:'Проверить нагрев',done:false}]}
        await assert.rejects(manager.commands.workSaveTask('invalid-date',{...draft,due:'2026-02-30'}),/дату/)
        const created=await manager.commands.workSaveTask('create-task',draft)
        assert.equal((await manager.commands.workSaveTask('create-task',draft)).id,created.id)
        const second=await manager.commands.workSaveTask('second-task',{...draft,title:'Вторая задача'})
        await manager.commands.workMoveTask('reorder-in-column',{id:second.id,revision:second.revision,status:'todo',beforeId:created.id})
        await waitFor('relative order is preserved',()=>manager.views.work.store.state.columns.find(column=>column.key=='todo')?.items[0]==second.id)
        await waitFor('worker sees assigned task',()=>!!worker.views.work.store.state.tasks[created.id])
        assert.equal(nina.views.work.store.state.tasks[created.id],undefined)
        await assert.rejects(nina.commands.workMoveTask('foreign-task',{id:created.id,revision:1,status:'done',beforeId:''}),/доступа/)
        const moved=await worker.commands.workMoveTask('start-task',{id:created.id,revision:1,status:'doing',beforeId:''})
        await waitFor('manager gets same move',()=>manager.views.work.store.state.tasks[created.id]?.status=='doing')
        await assert.rejects(manager.commands.workSaveTask('stale-edit',{...draft,id:created.id,revision:1,title:'Stale overwrite'}),/уже изменена/)
        await assert.rejects(worker.commands.workMoveTask('unfinished-checklist',{id:created.id,revision:moved.revision,status:'done',beforeId:''}),/пункты/)
        await assert.rejects(nina.commands.workCheckTask('foreign-check',{id:created.id,revision:moved.revision,index:0,done:true}),/доступа/)
        await assert.rejects(worker.commands.workCheckTask('invalid-index',{id:created.id,revision:moved.revision,index:0.5,done:true}),/не найден/)
        const checked=await worker.commands.workCheckTask('checked',{id:created.id,revision:moved.revision,index:0,done:true})
        assert.equal((await worker.commands.workCheckTask('checked',{id:created.id,revision:moved.revision,index:0,done:true})).revision,checked.revision)
        await assert.rejects(manager.commands.workCheckTask('stale-check',{id:created.id,revision:moved.revision,index:0,done:false}),/уже изменена/)
        const finished=await worker.commands.workMoveTask('finish-task',{id:created.id,revision:checked.revision,status:'done',beforeId:''})
        await waitFor('completion is visible',()=>manager.views.work.store.state.tasks[created.id]?.completedBy=='worker')
        await assert.rejects(worker.commands.workCheckTask('change-result',{id:created.id,revision:finished.revision,index:0,done:false}),/Верните/)
        await assert.rejects(worker.commands.workSaveTask('edit-result',{...draft,id:created.id,revision:finished.revision}),/Верните/)
        const reopened=await worker.commands.workMoveTask('reopen',{id:created.id,revision:finished.revision,status:'doing',beforeId:''})
        await waitFor('completion reset',()=>!worker.views.work.store.state.tasks[created.id]?.completedAt)
        await worker.commands.workMoveTask('finish-again',{id:created.id,revision:reopened.revision,status:'done',beforeId:''})
        await owner.commands.workSavePerson('remove-manager',{account:'manager',name:'Менеджер',roles:['member'],position:'',note:'',password:''})
        await waitFor('open view loses management',()=>manager.views.work.store.state.manage==false)
        await waitFor('reactive permissions revoke command',()=>!manager.identity.permissions.state.commands.includes('workSavePerson'))
        await assert.rejects(manager.commands.workSavePerson('forged-profile',{...person,name:'Changed'}),/forbidden/)
        const sameStore=manager.views.work.store
        await owner.commands.workSavePerson('restore-manager',{account:'manager',name:'Менеджер',roles:['manager'],position:'',note:'',password:''})
        await waitFor('reactive permissions restore command',()=>manager.identity.permissions.state.commands.includes('workSavePerson'))
        await manager.commands.workSavePerson('after-restore',{...person,password:'',note:'Роль возвращена без нового клиента'})
        assert.equal(manager.views.work.store,sameStore)
        for(const session of clients)session.close()
        await host.control.stop()
        host=createProcess({script:'../organizer/server.ts',env})
        url=await host.ready
        const restored=await client('owner')
        assert.equal(restored.views.work.store.state.tasks[created.id].status,'done')
        assert.equal(restored.views.work.store.state.tasks[created.id].checklist?.[0].done,true)
        assert.equal(restored.views.work.store.state.tasks[created.id].completedBy,'worker')
        assert.equal(restored.views.work.store.state.tasks[created.id].due,'2026-09-10')
        assert.equal(restored.views.work.store.state.people.find(person=>person.account=='nina')?.position,'Оператор')
        assert.equal(restored.views.work.store.state.columns.flatMap(column=>column.items).filter(id=>id==created.id).length,1)
        console.log('PASS organizer: standalone process, employees, deadlines, checklist completion/reopen, role boundaries, live clients, stale edits, receipts and durable restart')
    } finally {
        for(const session of clients)session.close()
        await host.control.stop()
        const resolved=realpathSync(directory)
        assert.equal(path.dirname(resolved),root)
        assert(path.basename(resolved).startsWith('organizer-check-'))
        rmSync(resolved,{recursive:true})
    }
}

async function integration() {
    const leader=createServiceLeader({definition:serviceDefinition,selfUrl:()=> 'http://localhost'})
    let seq=0
    const command=(account:string,name:keyof typeof serviceDefinition.commands,input:unknown)=>leader.corridor.execute(account,name,'work-test-'+(++seq),input as never)
    const state=()=>leader.line.control.store.snapshot()
    try {
        const placed=await command('alice','placeOrder',{items:['margherita','margherita'],address:'Тестовая улица, 1'}) as {id:string}
        const workload=()=>(leader.access.snapshot('work',{account:'manager',roles:['manager']}) as WorkView).workload!
        assert.deepEqual(workload().queue,{orders:1,dishes:2})
        assert.equal((leader.access.snapshot('work',{account:'rider',roles:['courier']}) as WorkView).workload,undefined)
        assert.equal(workload().people.find(person=>person.account=='chef')?.dishes,0)
        const kitchen='auto-kitchen-'+placed.id
        assert.equal(state().organizer.tasks[kitchen].status,'todo')
        await assert.rejects(command('manager','workMoveTask',{id:kitchen,revision:1,status:'done',beforeId:''}),/Автоматическая/)
        await command('chef','spoilStock',{batchId:'dough-demo',quantity:10000,reason:'Порча'})
        const shortage='auto-shortage-'+placed.id
        assert.equal(state().organizer.tasks[shortage].status,'todo')
        await command('manager','receiveStock',{ingredientId:'dough',quantity:1000,expiresAt:new Date(Date.now()+86400000).toISOString()})
        assert.equal(state().organizer.tasks[shortage].status,'done')
        await command('chef','startCooking',{orderId:placed.id})
        assert.deepEqual(workload().queue,{orders:0,dishes:0})
        assert.equal(workload().people.find(person=>person.account=='chef')?.orders,1)
        assert.equal(workload().people.find(person=>person.account=='chef')?.dishes,2)
        assert(workload().people.find(person=>person.account=='chef')?.oldestStartedAt)
        assert.equal(state().organizer.tasks[kitchen].status,'doing')
        assert(state().organizer.columns.doing.includes(kitchen),'automatic task must move its column as well as its status')
        assert(!state().organizer.columns.todo.includes(kitchen))
        await command('chef','markReady',{orderId:placed.id})
        assert.equal(workload().people.find(person=>person.account=='chef')?.dishes,0)
        assert.equal(state().organizer.tasks[kitchen].status,'done')
        const delivery='auto-delivery-'+placed.id
        assert.equal(state().organizer.tasks[delivery].status,'todo')
        await command('rider','pickUp',{orderId:placed.id})
        assert.equal(state().organizer.tasks[delivery].status,'doing')
        await command('rider','markDelivered',{orderId:placed.id})
        assert.equal(state().organizer.tasks[delivery].status,'done')
        for(const [status,ids] of Object.entries(state().organizer.columns)) {
            for(const id of ids)assert.equal(state().organizer.tasks[id].status,status,'column and task status agree')
        }
        assert.throws(()=>leader.access.snapshot('work',{account:'alice',roles:['customer']}),/forbidden/)
        const expired=structuredClone(state())
        expired.batches['cheese-demo'].expiresAt=Date.now()-1
        const restored=createServiceLeader({definition:{...serviceDefinition,initial:expired},selfUrl:()=> 'http://localhost'})
        try {
            await restored.corridor.system.workRefresh('expiry-refresh',{})
            assert.equal(restored.line.control.store.state.organizer.tasks['auto-expired-cheese-demo'].status,'todo')
            await restored.corridor.execute('chef','spoilStock','remove-expired',{batchId:'cheese-demo',quantity:restored.line.control.store.state.batches['cheese-demo'].quantity,reason:'Просрочка'})
            assert.equal(restored.line.control.store.state.organizer.tasks['auto-expired-cheese-demo'].status,'done')
        } finally {restored.control.close()}
        console.log('PASS pizzeria organizer: automatic kitchen/delivery, shortage recovery, expiry cleanup and customer exclusion')
    } finally {leader.control.close()}
}
async function main() {await integration();await standalone()}
main().catch(function failed(error) {console.error(error);process.exitCode=1})
