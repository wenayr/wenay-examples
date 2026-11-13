import assert from 'node:assert/strict'
import {createPeerHost, createPeerClient} from 'wenay-common2/peer'

async function waitFor(label: string, predicate: ()=>boolean) {
    const deadline = Date.now()+3000
    while (!predicate()) {
        assert(Date.now()<deadline, 'Timeout: '+label)
        await new Promise(function tick(resolve) {setTimeout(resolve, 10)})
    }
}

async function main() {
    const room = createPeerHost({history: 8})
    const otherRoom = createPeerHost({history: 8})
    const connections: ReturnType<typeof room.connection>[] = []
    const clients: ReturnType<typeof createPeerClient<{x: number, selected: string}>>[] = []
    function join(host: typeof room, id: string) {
        const connection = host.connection(id)
        connections.push(connection)
        const client = createPeerClient({remote: connection.fragment, account: id, initial: {x: 0, selected: ''}})
        clients.push(client)
        return {connection, client}
    }
    try {
        const first = join(room, 'owner-session-a')
        const second = join(room, 'owner-session-b')
        const observer = join(room, 'manager-session')
        const foreign = join(otherRoom, 'foreign-session')
        assert.deepEqual(room.presence.list().sort(), ['manager-session', 'owner-session-a', 'owner-session-b'])
        assert.deepEqual(otherRoom.presence.list(), ['foreign-session'])
        const seenFirst = observer.client.peer('owner-session-a')
        const seenSecond = observer.client.peer('owner-session-b')
        await Promise.all([seenFirst.ready, seenSecond.ready])
        first.client.store.state.x = 10
        second.client.store.state.x = 90
        await waitFor('independent session cursors', ()=>seenFirst.store.state.x==10&&seenSecond.store.state.x==90)
        assert.deepEqual(otherRoom.accounts(), ['foreign-session'])
        assert.equal(foreign.client.store.state.x, 0)
        console.log('PASS peer: separate hosts isolate rooms; server-assigned session IDs isolate two cursors')

        for (let x = 11; x<=40; x++) {
            first.client.store.state.x = x
            await waitFor('publish cursor '+x, ()=>seenFirst.store.state.x==x)
        }
        const late = join(room, 'late-session')
        const recovered = late.client.peer('owner-session-a')
        await recovered.ready
        await waitFor('current state beyond short journal', ()=>recovered.store.state.x==40)
        console.log('PASS peer: a late reader gets current cursor state beyond a short replay history')

        const tabA = room.connection('same-account')
        const tabB = room.connection('same-account')
        connections.push(tabA, tabB)
        assert.equal(room.presence.list().filter(id=>id=='same-account').length, 1)
        tabA.close()
        assert(room.presence.list().includes('same-account'))
        tabB.close()
        assert(!room.presence.list().includes('same-account'))
        console.log('PASS peer: account presence is reference-counted; tab identity must be composed by the server')

        first.client.close()
        first.connection.close()
        assert(!room.presence.list().includes('owner-session-a'))
        assert(room.presence.list().includes('owner-session-b'))
        console.log('PASS peer: closing one independent session preserves the other')
    } finally {
        for (const client of clients) client.close()
        for (const connection of connections) connection.close()
        room.close()
        otherRoom.close()
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
