import assert from 'node:assert/strict'
import {createServiceLeaderHost} from 'wenay-common2/service/host'
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {encodeMediaFrame} from 'wenay-common2/media'
import {createOrganizerService} from './service'

async function main() {
    const service = createOrganizerService()
    const host = await createServiceLeaderHost({definition: service.definition, env: {SERVICE_PORT: '0'}, rest: false,
        mount: ({leader}) => service.mount(leader.line.control.store)})
    const owner = createServiceClient({definition: describeService(service.definition), url: host.url, auth: {token: host.leader.identity.login('owner').token}})
    const worker = createServiceClient({definition: describeService(service.definition), url: host.url, auth: {token: host.leader.identity.login('worker').token}})
    const a = owner.resources.open('screen')
    const b = worker.resources.open('screen')
    async function wait(check: () => boolean) {
        const start = Date.now()
        while (!check()) {assert(Date.now() - start < 5000, 'screen wait timed out'); await new Promise(resolve => setTimeout(resolve, 20))}
    }
    try {
        await wait(() => a.status.state.phase == 'ready' && b.status.state.phase == 'ready')
        const first = a.current()!.remote
        const second = b.current()!.remote
        const received: unknown[] = []
        const subscription = second.frames.on(frame => received.push(frame))
        await second.frames.keyframe()
        const epoch = await first.control.begin()
        await assert.rejects(second.control.begin())
        const frame = encodeMediaFrame({kind: 'video-frame', codec: 'jpeg', width: 640, height: 360, seq: 1, tMono: 1}, new Uint8Array([255, 216, 255, 217]))
        assert(await first.control.frame(epoch, frame))
        await wait(() => received.length == 1)
        assert.deepEqual(new Uint8Array((received[0] as {bytes: Uint8Array}).bytes), frame)
        await assert.rejects(second.control.frame(epoch, frame))
        await first.control.end()
        await assert.rejects(first.control.frame(epoch, frame))
        const next = await second.control.begin()
        assert(next > epoch)
        host.leader.line.control.store.state.accounts.worker.roles = []
        await wait(() => b.status.state.phase == 'denied')
        await assert.rejects(second.control.frame(next, frame))
        await assert.rejects(second.frames.keyframe())
        const regained = await first.control.begin()
        assert(regained > next)
        subscription.off()
        console.log('PASS screen real RPC: binary relay, exclusive source, generations, stop, revoke and retained facade denial; payload fixture is not a browser capture test')
    } finally {await a.close(); await b.close(); owner.close(); worker.close(); await host.close()}
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
