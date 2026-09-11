import assert from 'node:assert/strict'
import {io} from 'socket.io-client'
import {listen} from 'wenay-common2/listen'
import {createPeerHost, createPeerClient, type PatchEnvelope} from 'wenay-common2/peer'
import {createRpcServerAuto, createRpcClientHub} from 'wenay-common2/rpc'
import {createHostResource} from 'wenay-common2/service/host'
import {createServiceLeader} from 'wenay-common2/service/server'
import {organizerDefinition} from './service'

async function waitFor(label: string, predicate: ()=>boolean) {
    const deadline = Date.now()+5000
    while (!predicate()) {
        assert(Date.now()<deadline, 'Timeout: '+label)
        await new Promise(function tick(resolve) {setTimeout(resolve, 15)})
    }
}

async function main() {
    const unhandled: unknown[] = []
    function rejected(reason: unknown) {
        unhandled.push(reason)
    }
    process.on('unhandledRejection', rejected)
    // This is a protocol fixture, not a second application runtime.
    const room = createPeerHost({history: 8})
    const leader = createServiceLeader({definition: organizerDefinition, selfUrl: ()=>'http://127.0.0.1'})
    const host = createHostResource({port: 0, host: '127.0.0.1'})
    const sessions = new Map<string, ReturnType<typeof room.connection>>()
    type RoomFragment = ReturnType<typeof room.connection>['fragment']
    type Facade = {session: ()=>string, peer: RoomFragment}
    const disposers: (()=>void)[] = []
    host.resource.io.on('connection', function accepted(socket) {
        const [gone, disconnectListen] = listen<[]>()
        let connection: ReturnType<typeof room.connection> | undefined
        createRpcServerAuto({socket, socketKey: 'peer-audit', object: {}, disconnectListen,
            auth: {gate: true, resolveAuth(presented) {
                const principal = leader.identity.principal(presented)
                const roles = leader.access.principalOf(principal).roles
                if (!roles.some(role=>['owner', 'manager', 'member'].includes(role))) throw new Error('forbidden')
                connection?.close()
                const id = principal.account+'-'+socket.id
                connection = room.connection(id)
                sessions.set(id, connection)
                return {account: principal.account, object: {session: ()=>id, peer: connection.fragment} satisfies Facade}
            }},
        })
        socket.on('disconnect', function disconnected() {
            gone()
            connection?.close()
        })
    })
    await host.control.listen()
    async function connect(account: string) {
        const token = leader.identity.login(account).token
        const hub = createRpcClientHub(()=>io(host.view.url(), {forceNew: true, transports: ['websocket'], reconnection: false}),
            rpc=>({room: rpc<Facade>('peer-audit')}), {token: ()=>token})
        disposers.push(function closeHub() {hub.close()})
        const remote = await hub.promise
        await remote.room.readyStrict()
        const fragment = remote.room.func
        const id = await fragment.session()
        const client = createPeerClient({account: id, remote: fragment.peer, initial: {x: 0}})
        disposers.push(client.close)
        return {id, client, fragment, hub}
    }
    try {
        const tabA = await connect('owner')
        const tabB = await connect('owner')
        const manager = await connect('manager')
        assert.notEqual(tabA.id, tabB.id)
        const seenA = manager.client.peer(tabA.id)
        const seenB = manager.client.peer(tabB.id)
        await Promise.all([seenA.ready, seenB.ready])
        tabA.client.store.state.x = 12
        tabB.client.store.state.x = 88
        await waitFor('RPC cursors from two sessions', ()=>seenA.store.state.x==12&&seenB.store.state.x==88)
        console.log('PASS network peer: real Socket.IO/RPC, service-issued tokens, independent tab cursors')

        if (!process.argv.includes('--shutdown-only')) {
            // Leaving a room does not imply disconnecting the parent application socket.
            tabA.client.close()
            sessions.get(tabA.id)!.close()
            const oldX = room.relay(tabA.id).snapshot().x
            const frame: PatchEnvelope = {seq: room.relay(tabA.id).seq()+1, ts: Date.now(), event: [{path: [], value: {x: 777}, exists: true}]}
            let result: unknown
            try {result = await tabA.fragment.peer.publish(frame)} catch {result = 'rejected'}
            const changed = room.relay(tabA.id).snapshot().x!=oldX
            if (process.argv.includes('--expect-fixed')) {
                assert.equal(changed, false, 'retained RPC facade of closed room must not publish')
                console.log('PASS network peer close regression')
            } else {
                assert.equal(result, true)
                assert.equal(changed, true)
                await waitFor('closed room update reached observer', ()=>seenA.store.state.x==777)
                console.log('REPRODUCED over RPC: closed room facade still changes the observer cursor to 777')
            }
        }
        assert(room.presence.list().includes(tabB.id))
        manager.client.close()
        manager.hub.close()
        await waitFor('socket disconnect clears presence', ()=>!room.presence.list().includes(manager.id))
        console.log('PASS network peer: parent socket disconnect clears presence; another tab remains online')
    } finally {
        for (const dispose of disposers.reverse()) dispose()
        await host.close()
        room.close()
        leader.control.close()
        await new Promise(function settle(resolve) {setTimeout(resolve, 30)})
        process.off('unhandledRejection', rejected)
        if (process.argv.includes('--expect-fixed')) {
            assert.deepEqual(unhandled, [], 'peer fixture shutdown must not leave unhandled rejections')
        } else {
            assert(unhandled.length>0, 'expected shutdown reproduction on common2 2.18.1')
            for (const reason of unhandled) {
                assert.deepEqual(reason, {error: {name: 'RPC_ABORT', message: 'RPC hub closed'}})
            }
            console.log('REPRODUCED peer/RPC shutdown: '+unhandled.length+' unhandled RPC_ABORT rejections (captured only by this diagnostic)')
        }
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
