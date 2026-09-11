import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {schemaCommand, type ServiceCommandCtx} from 'wenay-common2/service'
import {createStore, syncStoreReplay} from 'wenay-common2/observe'
import type {AiRunStore} from 'wenay-common2/ai'
import {createBookingService} from './service'
import {createBookingAssistant, type PreferenceProvider, type PreferenceFact, type Preference} from './assistant-resource'
import type {BookingState} from './model'

async function waitFor(check: () => boolean) {
    const deadline = Date.now() + 4000
    while (!check()) {assert(Date.now() < deadline, 'Condition timeout'); await delay(10)}
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'booking-assistant-check-'))
    const now = () => Date.UTC(2026, 8, 14, 6)
    const definition = createBookingService({now}).definition
    // Fixture models access removal by an external identity administrator through the authority writer.
    const leader = createServiceLeader({definition: {...definition, commands: {...definition.commands, revokeFixture: schemaCommand({}, {allow: ['system'], apply(ctx: ServiceCommandCtx<BookingState>) {delete ctx.state.organizations.northstar.members.customer; return {ok: true}}})}}, selfUrl: () => 'http://localhost'})
    const pending: {facts: PreferenceFact[], signal: AbortSignal, finish: (value: Preference) => void, reject: (error: Error) => void}[] = []
    const provider: PreferenceProvider = {parse(input) {return new Promise((finish, reject) => pending.push({...input, finish, reject}))}}
    const owner = leader.corridor.fragment('owner'), snapshot = () => leader.line.control.store.snapshot()
    const context = (account: string) => ({principal: {account, roles: ['customer']}, sessionId: account, resourceId: 'assistant', signal: new AbortController().signal})
    let sequence = 0
    const rpc = () => 'assistant-test-' + (++sequence)
    function start(selected?: PreferenceProvider) {
        const assistant = createBookingAssistant({directory, provider: selected, timeoutMs: 300, now})
        return {assistant, close: assistant.mount(leader.line.control.store)}
    }
    let running = start()
    const stops: (() => void)[] = []
    async function open(account: string) {
        const connection = running.assistant.resource.open(context(account))
        const view = createStore<AiRunStore>({runs: {}, inputs: {}, approvals: {}}), mirror = syncStoreReplay(view, connection.facade.ai.state)
        await mirror.ready
        stops.push(mirror, connection.close)
        return {...connection.facade, view}
    }
    function closeConnections() {for (const stop of stops.splice(0)) stop()}
    function request(client: Awaited<ReturnType<typeof open>>, requestId: string, prompt = 'Консультация 2026-09-15 в 10:00 на 1 человека') {
        return {kind: 'preferences', requestId, resourceIds: ['northstar'], input: {orgId: 'northstar', prompt, catalogKey: client.control.context('northstar').catalogKey}}
    }
    const answer: Preference = {serviceId: 'consultation', date: '2026-09-15', partySize: 1, time: '10:00'}
    try {
        await owner.resourceSave(rpc(), {...snapshot().resources.studio, capacity: 1})
        const customer = await open('customer'), outsider = await open('outsider')
        assert.throws(() => outsider.control.context('northstar'), /доступа/)
        assert(customer.control.context('northstar').services.every(service => service.id != 'harbor'))
        const defaultRun = customer.ai.createRun(request(customer, 'default-test', 'Консультация завтра в 10:00 на 1 человека'))
        await waitFor(() => customer.view.state.runs[defaultRun.id]?.state == 'completed')
        const suggestion = customer.control.result(defaultRun.id)
        assert.equal(suggestion.date, '2026-09-15')
        assert.equal(suggestion.zone, 'Europe/Berlin')
        assert.equal(suggestion.demo, true)
        assert.equal(suggestion.requiresConfirmation, true)
        assert.equal(suggestion.slots.length, 1)
        assert.equal(Object.keys(snapshot().bookings).length, 0, 'AI proposal never creates a hold')
        assert.throws(() => outsider.control.result(defaultRun.id), /недоступно/)
        const slot = suggestion.slots[0]
        await owner.bookingHold(rpc(), {orgId: 'northstar', key: 'occupy-after-proposal', serviceId: 'consultation', start: slot.start, partySize: 1, customer: 'customer2', note: 'Not a source of AI facts', reminder: false})
        assert.equal(customer.control.result(defaultRun.id).slots.length, 0, 'result read recomputes current availability')
        await assert.rejects(leader.corridor.fragment('customer').bookingHold(rpc(), {orgId: 'northstar', key: 'confirm-after-race', serviceId: 'consultation', start: slot.start, partySize: 1, customer: '', note: '', reminder: false}), /недостаточно/)
        closeConnections(); running.close(); await delay(10)
        running = start(provider)
        const active = await open('customer')
        assert.equal(active.control.result(defaultRun.id).date, '2026-09-15', 'private saved proposal survives restart and revalidates slots')
        const good = active.ai.createRun(request(active, 'provider-good'))
        await waitFor(() => pending.length == 1)
        assert(pending[0].facts.every(fact => fact.id == 'consultation'))
        assert(!JSON.stringify(pending[0].facts).includes('Not a source'))
        assert.throws(() => active.ai.createRun(request(active, 'second-active')), /forbidden/)
        pending[0].finish(answer)
        await waitFor(() => active.view.state.runs[good.id]?.state == 'completed')
        assert.equal(active.control.result(good.id).demo, false)
        const metadata = JSON.stringify(await active.ai.state.keyframe())
        assert(!metadata.includes('serviceName') && !metadata.includes('occupiedFrom'), 'AI replay carries status, not private proposal output')
        await owner.serviceSave(rpc(), {...snapshot().services.consultation, name: 'Новая консультация'})
        assert.throws(() => active.control.result(good.id), /изменились/)
        const changed = active.ai.createRun(request(active, 'changed'))
        await waitFor(() => pending.length == 2)
        await owner.resourceSave(rpc(), {...snapshot().resources.studio, zone: 'Europe/Paris'})
        await waitFor(() => pending[1].signal.aborted)
        assert(pending[1].signal.aborted)
        pending[1].finish(answer)
        await waitFor(() => active.view.state.runs[changed.id]?.state == 'failed')
        assert.throws(() => active.control.result(changed.id), /недоступно/)
        const cancelled = active.ai.createRun(request(active, 'cancelled'))
        await waitFor(() => pending.length == 3)
        active.ai.cancelRun(cancelled.id, 'Cancel fixture')
        assert(pending[2].signal.aborted)
        pending[2].finish(answer)
        await waitFor(() => active.view.state.runs[cancelled.id]?.state == 'cancelled')
        assert.throws(() => active.control.result(cancelled.id), /недоступно/)
        const failed = active.ai.createRun(request(active, 'failed'))
        await waitFor(() => pending.length == 4)
        pending[3].reject(new Error('SECRET_PROVIDER_ERROR'))
        await waitFor(() => active.view.state.runs[failed.id]?.state == 'failed')
        assert(!JSON.stringify(await active.ai.state.keyframe()).includes('SECRET_PROVIDER_ERROR'))
        const timed = active.ai.createRun(request(active, 'timeout'))
        await waitFor(() => pending.length == 5)
        await waitFor(() => active.view.state.runs[timed.id]?.state == 'failed')
        assert(pending[4].signal.aborted)
        pending[4].finish(answer)
        const invalid = active.ai.createRun(request(active, 'foreign-service'))
        await waitFor(() => pending.length == 6)
        pending[5].finish({...answer, serviceId: 'harbor'})
        await waitFor(() => active.view.state.runs[invalid.id]?.state == 'failed')
        assert.throws(() => active.control.result(invalid.id), /недоступно/)
        const revoked = active.ai.createRun(request(active, 'revoked'))
        await waitFor(() => pending.length == 7)
        const requestAfterRevoke = request(active, 'after-revoke')
        await leader.corridor.system.revokeFixture(rpc(), {})
        await waitFor(() => pending[6].signal.aborted)
        assert(pending[6].signal.aborted)
        pending[6].finish(answer)
        await waitFor(() => active.view.state.runs[revoked.id]?.state == 'failed')
        assert.throws(() => active.control.result(defaultRun.id), /доступа/)
        assert.throws(() => active.ai.createRun(requestAfterRevoke), /forbidden/)
        console.log('PASS booking assistant: explicit local parser, allowed catalog/versions/zones, no booking side effect, fresh availability and final capacity guard, private durable output, cancellation/timeout/late completion, sanitized errors, foreign-service rejection and authority ACL revoke')
    } finally {
        closeConnections(); running.close(); await delay(10); leader.control.close()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('booking-assistant-check-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
