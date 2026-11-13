import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import type {ApprovalDefinition} from './runtime'
import {createProcess} from './process-resource'

type Client = ServiceClient<ApprovalDefinition>

async function waitFor(label: string, check: () => boolean | Promise<boolean>) {
    const deadline = Date.now() + 15000
    while (!await check()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

// Настоящий authority и два обслуживающих узла: проверяем, что заявка проходит
// полный цикл через разные узлы, переживает отключение узла и рестарт авторитета.
async function main() {
    const started = performance.now()
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'approvals-network-'))
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: path.join(directory, 'authority'),
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const nodes: ReturnType<typeof createProcess>[] = []
    const clients: Client[] = []

    async function client(account: string, rng = 0) {
        const response = await fetch(url + '/api/client')
        const definition = await response.json() as ReturnType<typeof describeService<ApprovalDefinition>>
        const auth = {credentials: {account, password: account + '-pass'}}
        const session = createServiceClient<ApprovalDefinition>({definition, url, auth, placement: {rng: () => rng}})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    function workspace(session: Client) {
        return session.views.workspace.store.state
    }
    function request(session: Client, id: string) {
        return workspace(session).requests.find(row => row.id == id)
    }
    async function cleanup() {
        for (const session of clients.splice(0)) session.close()
        for (const node of nodes.splice(0)) await node.control.stop()
        await host.control.stop()
    }

    const orgId = 'northstar'
    const answers = JSON.stringify({purpose: 'Курс по доступности для команды', amount: 48000, urgent: false})
    try {
        for (const nodeId of ['approvals-a', 'approvals-b']) {
            const data = path.join(directory, nodeId)
            const node = createProcess({script: 'node.ts', env: {...env, SERVICE_DATA_DIR: data, SERVICE_NODE_ID: nodeId, SERVICE_UPSTREAM: url}})
            nodes.push(node)
            await node.ready
        }
        const author = await client('requester')
        const reviewer = await client('reviewer', 0.999)
        const outsider = await client('outsider')
        await waitFor('оба клиента обслуживаются узлами, а не авторитетом', function placed() {
            const first = author.view.endpoint()?.nodeId
            const second = reviewer.view.endpoint()?.nodeId
            const placedFirst = !!first && first != 'leader'
            const placedSecond = !!second && second != 'leader'
            return placedFirst && placedSecond
        })
        const endpoints = [author.view.endpoint()!.nodeId, reviewer.view.endpoint()!.nodeId]
        assert.notEqual(endpoints[0], endpoints[1], 'клиенты попали на разные узлы')

        // Полный цикл через два узла: автор пишет на одном, проверяющий решает на другом.
        const draft = {orgId, id: '', revision: 0, key: 'net-save-key', title: 'Курс по доступности', answersJson: answers}
        const created = await author.commands.requestSave('net-save', draft)
        await waitFor('заявка видна автору', () => !!request(author, created.id))
        await author.commands.requestSubmit('net-submit', {orgId, id: created.id, revision: request(author, created.id)!.revision, key: 'net-submit-key'})
        await waitFor('отправленная заявка дошла до проверяющего', () => request(reviewer, created.id)?.status == 'pending')
        assert.equal(request(reviewer, created.id)!.versions.length, 1)

        // Посторонняя организация не получает заявку ни через один узел.
        assert.equal(workspace(outsider).requests.length, 0, 'чужая организация не видит заявок')
        const stolen = {orgId, id: created.id, revision: 1, key: 'stolen-decide-key', version: 1, decision: 'approved' as const, body: ''}
        await assert.rejects(outsider.commands.requestDecide('stolen-decide', stolen), /доступа|forbidden/)

        const decide = {orgId, id: created.id, revision: request(reviewer, created.id)!.revision, version: 1, key: 'net-changes-key'}
        await reviewer.commands.requestDecide('net-changes', {...decide, decision: 'changes', body: 'Добавьте программу курса'})
        await waitFor('возврат дошёл до автора', () => request(author, created.id)?.status == 'changes')

        // Повтор той же команды с тем же ключом не создаёт вторую версию.
        const revision = request(author, created.id)!.revision
        const first = await author.commands.requestSubmit('net-resubmit-a', {orgId, id: created.id, revision, key: 'net-resubmit-key'})
        const again = await author.commands.requestSubmit('net-resubmit-b', {orgId, id: created.id, revision, key: 'net-resubmit-key'})
        assert.deepEqual(again, first, 'повтор ключа намерения возвращает прежний результат')
        await waitFor('вторая версия дошла до проверяющего', () => request(reviewer, created.id)?.versions.length == 2)

        // Небольшой замер на локальном стенде, не производительный benchmark.
        const startedBatch = performance.now()
        const latencies: number[] = []
        for (let index = 0; index < 20; index++) {
            const begin = performance.now()
            const side = index % 2 ? reviewer : author
            const account = index % 2 ? 'reviewer' : 'requester'
            await side.commands.requestSave('measured-' + account + '-' + index, {
                orgId, id: '', revision: 0, key: 'measured-key-' + account + '-' + index,
                title: 'Заявка ' + index, answersJson: answers
            })
            latencies.push(performance.now() - begin)
        }
        const elapsed = performance.now() - startedBatch
        const sorted = [...latencies].sort((a, b) => a - b)
        const measurement = {
            check: 'approvals measured local batch', requests: 20, clients: 2, servingNodes: endpoints,
            elapsedMs: Math.round(elapsed), requestsPerSecond: Math.round(20000 / elapsed * 10) / 10,
            p50Ms: Math.round(sorted[9]), p95Ms: Math.round(sorted[18]),
            scope: 'small local acceptance sample, not a production benchmark'
        }

        // Отключение узла: клиент продолжает работать через оставшийся.
        const lost = author.view.endpoint()!.nodeId
        await nodes[endpoints[0] == 'approvals-a' ? 0 : 1].control.stop(true)
        await waitFor('автор переключился на другой узел', () => {
            const now = author.view.endpoint()?.nodeId
            return !!now && now != lost
        })
        const retry = {orgId, id: '', revision: 0, key: 'after-failure-key', title: 'После отказа узла', answersJson: answers}
        const afterFailure = await author.commands.requestSave('after-failure', retry)
        await waitFor('заявка после отказа узла видна', () => !!request(author, afterFailure.id))

        // Отзыв роли закрывает уже открытую сессию проверяющего.
        const owner = await client('owner')
        const team = () => workspace(owner).organizations.find(org => org.id == orgId)!
        await owner.commands.memberRole('revoke-reviewer', {orgId, revision: team().revision, account: 'reviewer', role: 'none'})
        await waitFor('проверяющий потерял доступ к организации', async function revoked() {
            const attempt = {orgId, id: created.id, revision: 1, key: 'revoked-decide-key', version: 2, decision: 'approved' as const, body: ''}
            try {
                await reviewer.commands.requestDecide('revoked-decide-' + Date.now(), attempt)
                return false
            } catch {
                return true
            }
        })

        // Рестарт авторитета: заявки и история сохраняются.
        const before = workspace(author).requests.length
        await cleanup()
        host = createProcess({script: 'server.ts', env})
        url = await host.ready
        const restored = await client('requester')
        await waitFor('состояние восстановлено после рестарта', () => workspace(restored).requests.length == before)
        const restoredRow = request(restored, created.id)!
        assert.equal(restoredRow.versions.length, 2, 'обе версии пережили рестарт')
        assert.deepEqual(restoredRow.history.map(entry => entry.kind), ['submitted', 'changes', 'submitted'])

        console.log(JSON.stringify(measurement))
        console.log('PASS approvals network: authority и два обслуживающих узла, полный цикл через разные узлы,')
        console.log('  изоляция чужой организации, повтор ключа намерения, отказ узла, отзыв роли на открытой сессии,')
        console.log('  восстановление заявок и истории после рестарта (' + Math.round(performance.now() - started) + ' ms)')
    } finally {
        await cleanup().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('approvals-network-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
