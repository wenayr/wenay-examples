import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {createServer, type Server} from 'node:http'
import {setTimeout as delay} from 'node:timers/promises'
import express from 'express'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createMeteringRuntime} from './runtime'
import {createMeteringService} from './service'
import {createHttpTestProvider} from './webhook-resource'
import type {ProviderSnapshot} from './billing-model'
import {mountProviderEvents} from './provider-http'

async function listen(server: Server) {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address != 'string')
    return 'http://127.0.0.1:' + address.port
}
async function waitFor(check: () => boolean) {
    const deadline = Date.now() + 5000
    while (!check()) {
        if (Date.now() > deadline) throw new Error('Condition timeout')
        await delay(10)
    }
}
async function closeServer(server: Server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function main() {
    const providerSecret = 'local-test-provider-secret'
    let source: ProviderSnapshot = {orgId: 'northstar', version: 3, plan: 'team', status: 'active'}
    let sourceReads = 0, responseCode = 200, failFirst = true, signingSecret = '', redirectHits = 0
    const received = new Map<string, number>()
    const applied = new Set<string>()
    const receiver = createServer(async function receive(request, response) {
        if (request.url == '/redirected') {
            redirectHits++
            response.writeHead(200).end()
            return
        }
        if (request.url == '/redirect') {
            response.writeHead(302, {location: '/redirected'}).end()
            return
        }
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const bytes = Buffer.concat(chunks)
        const expected = 'sha256=' + createHmac('sha256', signingSecret).update(bytes).digest('hex')
        assert.equal(request.headers['x-metering-signature'], expected)
        const payload = JSON.parse(bytes.toString('utf8'))
        assert.equal(payload.id, request.headers['x-metering-event'])
        assert.equal(payload.orgId, 'northstar')
        assert.equal(bytes.includes('hash'), false)
        received.set(payload.id, (received.get(payload.id) ?? 0) + 1)
        applied.add(payload.id)
        const code = failFirst ? 503 : responseCode
        failFirst = false
        response.writeHead(code).end()
    })
    const provider = createServer(function snapshot(request, response) {
        sourceReads++
        assert.equal(request.url, '/subscriptions/northstar')
        response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(source))
    })
    const origin = await listen(receiver), providerUrl = await listen(provider)
    const runtime = createMeteringRuntime({retryMs: 15, allowedOrigins: [origin], provider: createHttpTestProvider({url: providerUrl, secret: providerSecret})})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, system: leader.corridor.system})
    const app = express()
    mountProviderEvents({app, receive: runtime.provider.receive})
    const incoming = createServer(app), incomingUrl = await listen(incoming)
    const snapshot = () => leader.line.control.store.snapshot()
    const context = (account: string) => ({
        principal: {account, roles: ['owner']},
        sessionId: account,
        resourceId: 'billing-test',
        signal: new AbortController().signal
    })
    const owner = leader.corridor.fragment('owner')
    const billing = runtime.definition.resources.billing.open(context('owner'))
    async function notify(id: string, version: number, extra: {orgId?: string, timestamp?: number} = {}) {
        const body = Buffer.from(JSON.stringify({id, orgId: 'northstar', version, timestamp: Date.now(), ...extra}))
        const digest = createHmac('sha256', providerSecret).update(body).digest('hex')
        const response = await fetch(incomingUrl + '/api/provider/events', {
            method: 'POST',
            headers: {'content-type': 'application/json', 'x-provider-signature': 'sha256=' + digest},
            body
        })
        const result = await response.json() as {ok: boolean, error: string, value: {version: number, duplicate: boolean}}
        if (!response.ok) {
            if (result.error.includes('не подтвердил')) assert.equal(response.status, 503, 'source lag must invite provider retry')
            throw new Error(result.error)
        }
        return result.value
    }
    try {
        const foreign = {requestId: 'denied-origin', orgId: 'northstar', url: 'http://example.invalid/'}
        await assert.rejects(billing.facade.control.createEndpoint(foreign), /разрешённых/)

        const url = origin.replace('://', '://name:pass@')
        const credentials = {requestId: 'denied-credentials', orgId: 'northstar', url}
        await assert.rejects(billing.facade.control.createEndpoint(credentials), /разрешённых/)

        const auditor = runtime.definition.resources.billing.open(context('auditor'))
        const request = {requestId: 'denied-owner', orgId: 'northstar', url: origin}
        await assert.rejects(auditor.facade.control.createEndpoint(request), /доступа/)
        await assert.rejects(billing.facade.control.createEndpoint({requestId: 'denied-tenant', orgId: 'harbor', url: origin}), /доступа/)
        const endpointInput = {requestId: 'endpoint', orgId: 'northstar', url: origin}
        const endpoint = await billing.facade.control.createEndpoint(endpointInput)
        assert(endpoint.secret)
        signingSecret = endpoint.secret
        assert.equal((await billing.facade.control.createEndpoint(endpointInput)).secret, null)
        const forged = {
            id: 'a'.repeat(64), orgId: 'northstar', notifiedVersion: 1,
            version: 1, plan: 'team', status: 'active'
        } as const
        await assert.rejects(owner.providerApply('forged-event', forged), /forbidden/)
        await assert.rejects(runtime.provider.receive(Buffer.from('{}'), 'sha256=' + '0'.repeat(64)), /подпись/)
        await assert.rejects(notify('old', 1, {timestamp: Date.now() - 600000}), /просроченное/)
        await assert.rejects(notify('unknown', 1, {orgId: '__proto__'}), /недоступна/)
        assert.equal(sourceReads, 0)
        assert.equal((await notify('hint-v2', 2)).version, 3, 'notification is only a hint; current authoritative version wins')
        assert.equal(snapshot().organizations.northstar.monthlyUnits, 5000)
        assert.equal((await notify('hint-v2', 2)).duplicate, true)
        assert.equal(sourceReads, 1, 'duplicate event does not fetch source again')
        assert.equal((await notify('late-v1', 1)).version, 3)
        const first = Object.values(snapshot().deliveries!)[0]
        await waitFor(() => snapshot().deliveries![first.id].status == 'delivered')
        assert.equal(received.get(first.id), 2)
        assert.equal(applied.size, 1, 'recipient deduplicates successfully applied event after lost acknowledgement')
        assert.equal(snapshot().deliveries![first.id].attempts.length, 2)
        await assert.rejects(notify('ahead-v4', 4), /не подтвердил/)
        source = {...source, version: 4, plan: 'starter'}
        assert.equal((await notify('ahead-v4', 4)).version, 4, 'failed source reconciliation does not poison event id')
        await waitFor(() => Object.values(snapshot().deliveries!).every(value => value.status == 'delivered'))
        source = {...source, version: 3, plan: 'team'}
        await notify('stale-source', 2)
        assert.equal(snapshot().subscriptions!.northstar.version, 4)
        assert.equal(snapshot().organizations.northstar.monthlyUnits, 1000)
        const keys = runtime.definition.resources.keys.open(context('owner'))
        const key = await keys.facade.control.issue({
            requestId: 'usage-key',
            orgId: 'northstar',
            label: 'Webhook test',
            scopes: ['usage:write'],
            days: 1
        })
        const api = leader.corridor.fragment(key.account)
        const event = {eventId: 'test:record', metric: 'search' as const, units: 1, reference: 'example'}
        responseCode = 400
        await api.usageRecord('record', event)
        const delivery = Object.values(snapshot().deliveries!).find(value => value.type == 'usage.committed')!
        await waitFor(() => snapshot().deliveries![delivery.id].status == 'failed')
        assert.equal(snapshot().deliveries![delivery.id].attempts.length, 1)
        assert.equal((await api.usageRecord('duplicate-record', event)).fresh, false)
        assert.equal(Object.values(snapshot().deliveries!).filter(value => value.type == 'usage.committed').length, 1)
        await assert.rejects(leader.corridor.fragment('outsider').webhookRetry('other-retry', {orgId: 'harbor', id: delivery.id}), /доставки/)
        responseCode = 200
        await owner.webhookRetry('retry-record', {orgId: 'northstar', id: delivery.id})
        await waitFor(() => snapshot().deliveries![delivery.id].status == 'delivered')
        assert.equal(snapshot().deliveries![delivery.id].manualRetries, 1)
        await api.usageReserve('before-cancel', {eventId: 'before-cancel', metric: 'document', units: 2, reference: ''})
        await api.usageReserve('release-before-cancel', {eventId: 'release-before-cancel', metric: 'document', units: 1, reference: ''})
        source = {...source, version: 5, status: 'cancelled'}
        await notify('cancel-v5', 5)
        await assert.rejects(api.usageRecord('cancelled-record', {...event, eventId: 'after-cancel'}), /подписка отключена/)
        await assert.rejects(api.usageReserve('cancelled-reserve', {...event, eventId: 'after-cancel-reserve'}), /подписка отключена/)
        await api.usageSettle('settle-before-cancel', {eventId: 'before-cancel', units: 1})
        await api.usageRelease('release-after-cancel', {eventId: 'release-before-cancel', reason: 'Processing never started'})
        await waitFor(() => Object.values(snapshot().deliveries!).every(value => value.status == 'delivered'))
        const view = leader.access.snapshot('workspace', {account: 'auditor', roles: ['auditor']})
        assert.equal(JSON.stringify(view).includes(signingSecret), false)
        assert.equal(JSON.stringify(view).includes('payload'), false)
        const otherView = leader.access.snapshot('workspace', {account: 'outsider', roles: ['owner']})
        assert.equal((otherView as ReturnType<typeof runtime.definition.views.workspace.project>).deliveries.length, 0)
        await owner.webhookEnable('disable-original', {orgId: 'northstar', id: endpoint.id, enabled: false})
        const redirect = await billing.facade.control.createEndpoint({requestId: 'redirect', orgId: 'northstar', url: origin + '/redirect'})
        source = {...source, version: 6, status: 'active'}
        await notify('active-v6', 6)
        const redirected = Object.values(snapshot().deliveries!).find(value => value.endpointId == redirect.id)!
        await waitFor(() => snapshot().deliveries![redirected.id].status == 'failed')
        assert.equal(snapshot().deliveries![redirected.id].attempts.length, 5)
        assert.equal(redirectHits, 0, 'redirects never reach another endpoint')
        for (let retry = 1; retry <= 3; retry++) {
            await owner.webhookRetry('redirect-manual-' + retry, {orgId: 'northstar', id: redirected.id})
            await waitFor(() => snapshot().deliveries![redirected.id].status == 'failed')
        }
        assert.equal(snapshot().deliveries![redirected.id].attempts.length, 20)
        await assert.rejects(owner.webhookRetry('retry-exhausted', {orgId: 'northstar', id: redirected.id}), /Исчерпаны/)
        await owner.webhookEnable('disable-redirect', {orgId: 'northstar', id: redirect.id, enabled: false})
        await owner.webhookEnable('enable-original', {orgId: 'northstar', id: endpoint.id, enabled: true})
        const full = snapshot()
        const template = Object.values(full.deliveries!)[0]
        full.deliveries = Object.fromEntries(Array.from({length: 1000}, (_, index) => {
            const id = index.toString(16).padStart(64, '0')
            return [id, {...template, id, status: 'delivered' as const, attempts: template.attempts.map(attempt => ({...attempt}))}]
        }))
        const capped = createServiceLeader({definition: {...createMeteringService().definition, initial: full}, selfUrl: () => 'http://localhost'})
        try {
            const quota = JSON.stringify(capped.line.control.store.snapshot().periods)
            await assert.rejects(capped.corridor.fragment(key.account).usageRecord('full-new', {...event, eventId: 'full-new'}), /1000 записей/)
            assert.equal(JSON.stringify(capped.line.control.store.snapshot().periods), quota, 'outbox full rejects before charging quota')
            const repeated = await capped.corridor.fragment(key.account).usageRecord('full-duplicate', event)
            const note = 'existing semantic duplicate is safe even when outbox is full'
            assert.equal(repeated.fresh, false, note)
        } finally {capped.control.close()}
        console.log('PASS webhooks: signed hints, authoritative reconciliation, duplicates/reordering/source lag, cancellation, tenant/secret isolation, atomic outbox, receiver dedup, exponential retries, permanent failure/manual retry cap, allowlist and redirects')
    } finally {
        await close()
        leader.control.close()
        await closeServer(provider)
        await closeServer(receiver)
        await closeServer(incoming)
    }
    // Restore an interrupted send without an active old worker. The recipient already applied it.
    const seedService = createMeteringService()
    const seedLeader = createServiceLeader({definition: seedService.definition, selfUrl: () => 'http://localhost'})
    const endpoint = {
        id: 'a'.repeat(64), orgId: 'northstar', actor: 'owner', url: origin, secret: signingSecret
    }
    await seedLeader.corridor.system.webhookRegister('seed-endpoint', endpoint)
    const subscription = {
        id: 'b'.repeat(64), orgId: 'northstar', notifiedVersion: 1,
        version: 1, plan: 'starter', status: 'active'
    } as const
    await seedLeader.corridor.system.providerApply('seed-provider', subscription)
    const interrupted = Object.values(seedLeader.line.control.store.snapshot().deliveries!)[0]
    await seedLeader.corridor.system.deliveryBegin('seed-begin', {id: interrupted.id})
    const saved = seedLeader.line.control.store.snapshot()
    seedLeader.control.close()
    const restoredReceiver = createServer(function receivedAgain(_request, response) {response.writeHead(200).end()})
    const restoredOrigin = await listen(restoredReceiver)
    saved.webhooks!['a'.repeat(64)].url = restoredOrigin
    const restored = createMeteringRuntime({allowedOrigins: [restoredOrigin]})
    const restoredLeader = createServiceLeader({definition: {...restored.definition, initial: saved}, selfUrl: () => 'http://localhost'})
    const closeRestored = restored.mount({store: restoredLeader.line.control.store, system: restoredLeader.corridor.system})
    try {
        await waitFor(() => restoredLeader.line.control.store.snapshot().deliveries![interrupted.id].status == 'delivered')
        const attempts = restoredLeader.line.control.store.snapshot().deliveries![interrupted.id].attempts
        assert.equal(attempts.length, 2)
        assert.match(attempts[0].error, /неизвестен после рестарта/)
        console.log('PASS webhooks: durable interrupted delivery recovery keeps event id and journal')
    } finally {
        await closeRestored()
        restoredLeader.control.close()
        await closeServer(restoredReceiver)
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
