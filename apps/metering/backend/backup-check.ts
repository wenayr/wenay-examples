import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, describeService, type ServiceClient} from 'wenay-common2/service/client'
import {createMeteringRuntime, type MeteringDefinition} from './runtime'
import {createProcess} from './process-resource'

const repository = path.resolve('../..')

function run(script: string, args: string[]) {
    return execFileSync('node', [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true
    })
}

async function until(label: string, predicate: () => boolean) {
    const end = Date.now() + 16000
    while (!predicate()) {
        assert(Date.now() < end, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 25))
    }
}

// Холодная копия учёта: восстановленный сервис обязан помнить и остаток квоты,
// и ключи намерений, иначе повтор события после восстановления удвоит расход.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'metering-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const definition = describeService(createMeteringRuntime().definition)
    const clients: ServiceClient<MeteringDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []

    async function client(account: string, password = account + '-pass') {
        const session = createServiceClient<MeteringDefinition>({definition, url, auth: {credentials: {account, password}}})
        clients.push(session)
        await session.ready()
        if (!account.startsWith('key:')) await session.views.workspace.ready
        return session
    }
    async function close() {
        for (const resource of resources.splice(0)) await resource.close().catch(() => {})
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }
    function events(session: ServiceClient<MeteringDefinition>) {
        return session.views.workspace.store.state.events
    }

    const orgId = 'northstar'
    try {
        const owner = await client('owner')
        const issue = owner.resources.open('keys')
        resources.push(issue)
        await until('ресурс ключей открыт', () => !!issue.current())
        const working = await issue.current()!.remote.control.issue({
            requestId: 'backup-key', orgId, label: 'Backup writer', scopes: ['usage:read', 'usage:write'], days: 1
        })
        const dropped = await issue.current()!.remote.control.issue({
            requestId: 'backup-key-revoked', orgId, label: 'Revoked writer', scopes: ['usage:write'], days: 1
        })
        assert(working.secret && dropped.secret)
        const writer = await client(working.account, working.secret)
        await writer.commands.usageReserve('reserve', {eventId: 'backup-event', metric: 'search', units: 20, reference: 'run-1'})
        await writer.commands.usageSettle('settle', {eventId: 'backup-event', units: 12})
        await owner.commands.keyRevoke('revoke', {orgId, id: dropped.id})
        await until('расход подтверждён', () => events(owner).some(item => item.status == 'committed'))
        const organizations = JSON.stringify(owner.views.workspace.store.state.organizations)
        const spent = events(owner).find(item => item.eventId == 'backup-event')!
        assert.equal(spent.units, 12, 'учтён фактический расход, а не резерв')
        await close()

        assert.throws(() => run('backup.mjs', ['metering', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['metering', copy, '--i-stopped-it', '--from=' + live, '--data-version=metering-1'])
        assert(existsSync(path.join(copy, 'manifest.json')) && existsSync(path.join(copy, 'complete')))
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=metering-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=metering-1'])

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('owner')
        const restoredWriter = await client(working.account, working.secret)
        assert.equal(events(again).length, 1, 'журнал расхода восстановлен')
        assert.equal(JSON.stringify(again.views.workspace.store.state.organizations), organizations, 'лимиты организации восстановлены')
        assert.equal(JSON.stringify(events(again)), JSON.stringify([spent]))

        // Повтор того же события с новым command requestId не создаёт вторую запись.
        const repeat = await restoredWriter.commands.usageReserve('reserve-again', {
            eventId: 'backup-event', metric: 'search', units: 20, reference: 'run-1'
        })
        assert.equal(repeat.fresh, false, 'ключ события пережил восстановление')
        assert.equal(events(again).length, 1, 'повтор не удвоил расход')
        assert.equal(JSON.stringify(again.views.workspace.store.state).includes(working.secret), false, 'секрет ключа не попадает в проекцию')

        const revoked = await client(dropped.account, dropped.secret).catch(function denied() {return null})
        if (revoked) {
            await assert.rejects(revoked.commands.usageRecord('after-restore', {
                eventId: 'revoked-event', metric: 'search', units: 1, reference: 'run-2'
            }), 'отозванный ключ не пишет расход после восстановления')
        }

        console.log('PASS metering backup: отказ без подтверждения остановки, отказ при несовпадении формата данных,')
        console.log('  восстановление журнала расхода и остатка квоты в новый каталог,')
        console.log('  повтор события не удваивает расход, отозванный ключ остаётся отозванным')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('metering-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
