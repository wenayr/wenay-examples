import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {startNetwork} from './network'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {serviceDefinition} from './service'
import {createTokenCodec} from 'wenay-common2/server/auth'

async function waitFor(label: string, predicate: () => boolean, timeoutMs=15000) {
    const deadline = Date.now()+timeoutMs
    while (!predicate()) {
        if (Date.now()>deadline) throw new Error('Timeout: '+label)
        await new Promise(function tick(resolve) {setTimeout(resolve,50)})
    }
}

async function main() {
    const root = realpathSync(tmpdir())
    const dataDir = mkdtempSync(path.join(root,'pizzeria-network-check-'))
    let network = await startNetwork({dataDir,port:0,branches:[
        {id:'center',title:'Центр',port:0,nodes:2},
        {id:'north',title:'Север',port:0,nodes:1},
    ]})
    const clients: ServiceClient<typeof serviceDefinition>[] = []
    function branch(id:string) {return network.view.list().find(item=>item.id==id)!}
    async function login(id:string,account:string) {
        const response = await fetch(branch(id).url+'/api/pizzeria/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:[{account,password:account+'-pass'}]})})
        const answer = await response.json()
        assert(answer.ok)
        return answer.value.token as string
    }
    async function client(id:string,token:string,onToken?:(token:string)=>void) {
        const value = createServiceClient<typeof serviceDefinition>({definition:describeService(serviceDefinition),url:branch(id).url,auth:{token},onToken,log:process.env.NETWORK_TRACE?function trace(line) {console.log(id+': '+line)}:undefined,placement:{rng:()=>0}})
        clients.push(value)
        await value.ready()
        return value
    }
    try {
        assert.equal(network.view.list().length,2)
        assert.notEqual(network.view.status('center').writerPid,network.view.status('north').writerPid)
        const aliceToken = await login('center','alice')
        const otherToken = await login('north','alice')
        const ownerToken = await login('center','owner')
        const managerToken = await login('center','manager')
        const forbiddenDrain = await fetch(branch('center').url+'/internal/nodes/drain', {
            method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+ownerToken}, body:JSON.stringify({ids:[]}),
        })
        assert.equal(forbiddenDrain.status,403,'a user token cannot access the private placement corridor')
        const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=','base64')
        async function uploadPhoto(token:string,bytes:Buffer=photoBytes) {
            return fetch(branch('center').url+'/api/media/photos',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'image/png'},body:new Uint8Array(bytes)})
        }
        assert.equal((await uploadPhoto(aliceToken)).status,403)
        assert.equal((await uploadPhoto(otherToken)).status,403)
        assert.equal((await uploadPhoto(managerToken,Buffer.from('<svg/>'))).status,400)
        assert.equal((await uploadPhoto(managerToken,Buffer.alloc(2*1024*1024+1))).status,413)
        const uploaded = await (await uploadPhoto(managerToken)).json()
        assert(uploaded.ok)
        const photoId = uploaded.value.id
        assert.equal((await (await uploadPhoto(managerToken)).json()).value.id,photoId,'same content has a stable photo ID')
        assert.deepEqual(Buffer.from(await (await fetch(branch('center').url+'/api/media/photos/'+photoId)).arrayBuffer()),photoBytes)
        assert.equal((await fetch(branch('north').url+'/api/media/photos/'+photoId)).status,404,'photo storage belongs to its location')
        const wrong = await fetch(branch('north').url+'/api/pizzeria/me',{headers:{authorization:'Bearer '+aliceToken}}).then(response=>response.json())
        assert.equal(wrong.ok,false,'foreign-location token must be refused')
        const secrets = JSON.parse(readFileSync(path.join(dataDir,'network.json'),'utf8'))
        const codec = createTokenCodec({secret:secrets.find((entry:{id:string})=>entry.id=='center').tokenSecret})
        const shortToken = codec.issue({sub:'alice'},{ttlMs:2000})
        let renewedToken = ''
        const renewing = await client('center',shortToken,function renewed(value) {renewedToken=value})
        await waitFor('token renewal through library provider',()=>!!renewedToken && renewedToken!=shortToken)
        assert.equal(renewing.identity.token(),renewedToken)
        renewing.close()
        const alice = await client('center',aliceToken)
        const manager = await client('center',managerToken)
        const board = manager.views.work
        await board.ready
        const other = await client('north',otherToken)
        const mine = alice.views.myOrders
        const theirs = other.views.myOrders
        await Promise.all([mine.ready,theirs.ready])
        const placed = await alice.commands.placeOrder('network-order',{items:['margherita'],address:'Тестовая улица, 1'})
        await waitFor('own order replay',()=>!!mine.store.state.orders[placed.id])
        const automaticId='auto-kitchen-'+placed.id
        await waitFor('organizer task on serving node',()=>board.store.state.tasks[automaticId]?.status=='todo')
        assert.equal(Object.keys(theirs.store.state.orders).length,0)
        assert.notEqual(alice.view.endpoint()?.nodeId,'leader','browser client selects a serving node')
        const stableStore = mine.store
        const latency: number[] = []
        for (let i = 0; i < 20; i++) {
            const start = performance.now()
            await alice.identity.me()
            latency.push(performance.now() - start)
        }
        latency.sort((a, b) => a - b)
        console.log('Serving RPC (20 sequential identity reads), p50=' + latency[9].toFixed(1) + ' ms, p95=' + latency[18].toFixed(1) + ' ms; coordinator RSS=' + Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MiB (not total child RSS)')
        const oldNode = alice.view.endpoint()?.nodeId
        const failedAt = Date.now()
        await network.control.stopNode('center',0)
        await waitFor('node handoff',()=>alice.health.state.connected && alice.view.endpoint()?.nodeId!=oldNode)
        console.log('Serving node loss to connected replacement: ' + (Date.now() - failedAt) + ' ms')
        await alice.commands.cancelOrder('network-cancel',{orderId:placed.id})
        await waitFor('replay after handoff',()=>mine.store.state.orders[placed.id]?.state=='cancelled')
        await waitFor('organizer replay after handoff',()=>board.store.state.tasks[automaticId]?.status=='done'&&board.store.state.columns.find(column=>column.key=='done')!.items.includes(automaticId))
        assert.equal(mine.store,stableStore,'UI keeps the same store during handoff')

        const owner=await client('center',ownerToken)
        const rights=manager.identity.permissions
        const boardStore=board.store
        const savedCommand=manager.commands.receiveStock
        await owner.commands.setRoles('revoke-manager-live',{account:'manager',roles:['customer']})
        await waitFor('serving node pushes revoked rights',()=>!rights.state.views.includes('work'))
        await waitFor('old protected mirror is cleared',()=>!Object.keys(board.store.state).length)
        await assert.rejects(savedCommand('saved-command-denied',{ingredientId:'dough',quantity:1,expiresAt:new Date(Date.now()+86400000).toISOString()}),/forbidden/)
        assert(owner.identity.permissions.state.commands.includes('setRoles'),'another session retains its rights')
        await owner.commands.setRoles('restore-manager-live',{account:'manager',roles:['manager']})
        await waitFor('serving node pushes restored rights',()=>rights.state.views.includes('work'))
        await waitFor('same board resumes after regrant',()=>!!board.store.state.tasks?.[automaticId])
        assert.equal(manager.identity.permissions,rights)
        assert.equal(board.store,boardStore)

        async function scale(token:string, count:number) {
            return fetch(network.url+'/api/owner/scaleNodes',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({args:['center',count]})})
        }
        assert.equal((await scale(managerToken,3)).status,403,'manager cannot scale')
        assert.equal((await scale(otherToken,3)).status,403,'foreign token cannot scale')
        const scaled = await (await scale(ownerToken,3)).json()
        assert(scaled.ok,JSON.stringify(scaled))
        assert.equal(network.view.status('center').nodes.filter(node=>node.online).length,3)
        const shrinking = Date.now()
        const shrunk = await (await scale(ownerToken,0)).json()
        assert(shrunk.ok)
        await waitFor('leader fallback after planned drain',()=>alice.health.state.connected && alice.view.endpoint()?.nodeId=='leader',5000)
        console.log('Planned scale-to-zero and leader fallback: '+(Date.now()-shrinking)+' ms')
        assert(Date.now()-shrinking<5000,'planned drain must avoid the old sequence of endpoint timeouts')
        const survives = await alice.commands.placeOrder('persisted-order',{items:['diavola'],address:'Сохранённый адрес'})
        await waitFor('persisted order replay',()=>!!mine.store.state.orders[survives.id])
        await network.control.stopLocation('center')
        const independent = await other.commands.placeOrder('independent-order',{items:['margherita'],address:'Другой адрес'})
        await waitFor('independent location continues',()=>!!theirs.store.state.orders[independent.id])
        await network.control.restart('center')
        assert.deepEqual(Buffer.from(await (await fetch(branch('center').url+'/api/media/photos/'+photoId)).arrayBuffer()),photoBytes,'photos survive authority restart')
        await waitFor('same client after writer restart',()=>alice.health.state.connected)
        await waitFor('restored order',()=>mine.store.state.orders[survives.id]?.state=='placed')
        const retried = await alice.commands.placeOrder('persisted-order',{items:['diavola'],address:'Сохранённый адрес'})
        assert.equal(retried.id,survives.id,'durable receipt survives restart')
        const parsed = JSON.parse(readFileSync(path.join(dataDir,'network.json'),'utf8'))
        assert.equal(parsed.find((item:{id:string})=>item.id=='center').nodes,0)
        for (const value of clients) value.close()
        await network.control.close()
        network = await startNetwork({dataDir,port:0})
        assert.equal(network.view.status('center').desiredNodes,0,'desired topology survives network restart')
        const after = await fetch(branch('center').url+'/api/pizzeria/views/myOrders',{headers:{authorization:'Bearer '+aliceToken}}).then(response=>response.json())
        assert(after.ok && after.value.orders[survives.id],'keys and archive survive whole network restart')
        console.log('PASS network: independent writers, token/data/photo isolation, upload permissions and limits, serving-node failover, live scaling, durable restart and saved topology')
    } finally {
        for (const value of clients) value.close()
        await network.control.close()
        const resolved = realpathSync(dataDir)
        assert.equal(path.dirname(resolved),root)
        assert(path.basename(resolved).startsWith('pizzeria-network-check-'))
        rmSync(resolved,{recursive:true})
    }
}
main().catch(function failed(error) {console.error(error);process.exitCode=1})
