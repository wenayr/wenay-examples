// Explicit local UI fixture. Real HTTP and worker failover are tested in check.ts.
import {createServiceClient, describeService} from 'wenay-common2/service/client'
import {createMonitoringRuntime, type MonitoringDefinition} from './runtime'
import {randomUUID} from 'node:crypto'

async function main() {
    const url = 'http://127.0.0.1:3816'
    const definition = describeService(createMonitoringRuntime().definition)
    const owner = createServiceClient<MonitoringDefinition>({definition, url, auth: {credentials: {account: 'owner', password: 'owner-pass'}}})
    const probe = createServiceClient<MonitoringDefinition>({definition: {...definition, views: {}}, url, auth: {credentials: {account: 'probe-b', password: 'probe-b-pass'}}})
    try {
        await Promise.all([owner.ready(), probe.ready()]); await owner.views.workspace.ready
        const previous = owner.views.workspace.store.state.monitors.find(item => item.name == 'Демо · проверка инцидента')
        const input = {orgId: 'northstar', id: previous?.id ?? '', revision: previous?.revision ?? 0, name: 'Демо · проверка инцидента', presetId: 'support', preferred: 'probe-b', public: true, paused: false, intervalMs: 3600000, timeoutMs: 200, downThreshold: 1, upThreshold: 1}
        const monitor = await owner.commands.monitorSave(randomUUID(), input)
        const ref = {orgId: input.orgId, id: monitor.id, revision: input.revision + 1}
        const claimed = await probe.commands.probeClaim(randomUUID(), ref)
        if (!claimed.claim) throw new Error('Не удалось начать тестовую попытку')
        const up = process.argv.includes('--recover')
        await probe.commands.probeReport(randomUUID(), {...ref, attempt: claimed.claim.attempt, outcome: up ? 'up' : 'down', latencyMs: 5, code: up ? 200 : 503, detail: 'Демонстрационный отчёт для проверки интерфейса; не результат HTTP'})
        console.log(up ? 'UI fixture recovered' : 'UI fixture incident opened')
    } finally {owner.close(); probe.close()}
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
