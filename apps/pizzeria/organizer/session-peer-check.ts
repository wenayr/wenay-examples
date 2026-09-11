import assert from 'node:assert/strict'
import {createPeerHost} from 'wenay-common2/peer'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import type {ServiceResourceContext, tServiceDefinition} from 'wenay-common2/service'

async function waitFor(label: string, check: () => boolean) {
    const until = Date.now() + 5000
    while (!check()) {
        assert(Date.now() < until, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

// SC1's stronger read cut is tested against a shared dynamic noStrict peer journal.
async function main() {
    const room = createPeerHost({history: 4})
    const definition = {
        name: 'sc1-peer-check', storeId: 'sc1-peer', originId: 'authority', initial: {allowed: true as boolean}, commands: {},
        access: {rolesOf: (state: {allowed: boolean}, account: string) => account == 'owner' || state.allowed ? ['member'] : []},
        resources: {presence: {allow: ['member'], placement: 'authority', open(ctx: ServiceResourceContext) {
            const peer = room.connection(ctx.resourceId)
            return {facade: {session: () => ctx.resourceId, peer: peer.fragment}, close: peer.close}
        }}},
    } satisfies tServiceDefinition<{allowed: boolean}>
    const host = await createServiceLeaderHost({definition, env: {SERVICE_PORT: '0'}, rest: false})
    const owner = createServiceClient({definition: describeService(definition), url: host.url, auth: {token: host.leader.identity.login('owner').token}})
    const worker = createServiceClient({definition: describeService(definition), url: host.url, auth: {token: host.leader.identity.login('worker').token}})
    const writer = owner.resources.open('presence')
    const observer = owner.resources.open('presence')
    const revoked = worker.resources.open('presence')
    const subscriptions: {off: () => void}[] = []
    try {
        await waitFor('resources ready', () => [writer, observer, revoked].every(resource => resource.status.state.phase == 'ready'))
        const write = writer.current()!.remote
        const watched = observer.current()!.remote
        const saved = revoked.current()!.remote
        const id = await write.session()
        const active: number[] = []
        const cut: number[] = []
        const activeLine = watched.peer.peers[id].line.on(event => active.push(event.seq))
        const cutLine = saved.peer.peers[id].line.on(event => cut.push(event.seq))
        subscriptions.push(activeLine, cutLine)
        // A remote round trip orders subscription registration before publication.
        await watched.peer.peers[id].keyframe()
        await saved.peer.peers[id].keyframe()
        const publish = (seq: number) => write.peer.publish({seq, ts: Date.now(), event: [{path: [], exists: true, value: {x: seq}}]})
        await publish(1)
        await waitFor('both dynamic subscriptions receive', () => active.includes(1) && cut.includes(1))
        host.leader.line.control.store.state.allowed = false
        await waitFor('worker scope denied', () => revoked.status.state.phase == 'denied')
        await assert.rejects(saved.peer.peers[id].keyframe())
        await assert.rejects(saved.peer.publish({seq: 2, ts: Date.now(), event: [{path: [], exists: true, value: {x: 99}}]}))
        await publish(2)
        await waitFor('other scope keeps shared journal', () => active.includes(2))
        assert.deepEqual(cut, [1])
        await revoked.close()
        await publish(3)
        await waitFor('close does not close shared source', () => active.includes(3))
        assert.deepEqual(cut, [1])
        console.log('PASS SC1 peer: shared dynamic journal survives another scope revoke; retained reads/writes rejected; revoked subscription receives no new events')
    } finally {
        subscriptions.forEach(subscription => subscription.off())
        await writer.close()
        await observer.close()
        await revoked.close()
        owner.close()
        worker.close()
        await host.close()
        room.close()
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
