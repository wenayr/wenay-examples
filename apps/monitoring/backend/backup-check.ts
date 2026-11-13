import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {MonitoringDefinition} from './runtime'
import {createProcess} from './process-resource'

const repository = path.resolve('../..')

function run(script: string, args: string[]) {
    return execFileSync('node', [path.join(repository, 'scripts', script), ...args], {
        cwd: repository, encoding: 'utf8', windowsHide: true
    })
}

async function waitFor(label: string, check: () => boolean) {
    const deadline = Date.now() + 15000
    while (!check()) {
        assert(Date.now() < deadline, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 20))
    }
}

// Общая проверка холодной копии: предметная запись переживает копирование и
// восстановление в новый каталог, а исходные данные при этом не меняются.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'monitoring-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const clients: ServiceClient<MonitoringDefinition>[] = []

    async function client(account: string) {
        const definition = await fetch(url + '/api/client').then(response => response.json())
        const session = createServiceClient<MonitoringDefinition>({definition, url, auth: {credentials: {account, password: account + '-pass'}}})
        clients.push(session)
        await session.ready()
        await session.views.workspace.ready
        return session
    }
    async function close() {
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }

    function monitors(session: ServiceClient<MonitoringDefinition>) {
        return session.views.workspace.store.state.monitors
    }

    try {
        const owner = await client('owner')
        const preset = owner.views.workspace.store.state.presets[0]
        assert(preset, 'в конфигурации есть разрешённая цель')
        const created = await owner.commands.monitorSave('backup-monitor', {
            orgId: 'northstar', id: '', revision: 0, name: 'Проверка для копии', presetId: preset.id,
            preferred: 'probe-a', public: true, paused: true, intervalMs: 60000,
            timeoutMs: 2000, downThreshold: 2, upThreshold: 2
        })
        await waitFor('проверка видна владельцу', () => monitors(owner).some(item => item.id == created.id))
        const before = monitors(owner).length
        await close()

        assert.throws(() => run('backup.mjs', ['monitoring', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['monitoring', copy, '--i-stopped-it', '--from=' + live, '--data-version=monitoring-1'])
        assert(existsSync(path.join(copy, 'manifest.json')) && existsSync(path.join(copy, 'complete')))
        const manifest = JSON.parse(readFileSync(path.join(copy, 'manifest.json'), 'utf8'))
        assert(manifest.files.length > 0, 'копия перечисляет файлы каталога данных')
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=monitoring-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=monitoring-1'])
        for (const item of manifest.files) {
            const source = path.join(live, item.path.split('/').join(path.sep))
            assert(existsSync(source), 'исходный каталог не тронут: ' + item.path)
        }

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('owner')
        assert.equal(monitors(again).length, before, 'число проверок сохранилось')
        const monitor = monitors(again).find(item => item.id == created.id)
        assert(monitor, 'созданная проверка восстановлена')
        assert.equal(monitor.name, 'Проверка для копии')
        assert.equal(monitor.paused, true, 'пауза пережила восстановление и не начала опрашивать цель')

        console.log('PASS monitoring backup: отказ без подтверждения остановки, отказ при несовпадении формата данных,')
        console.log('  восстановленный мониторинг отдаёт прежнюю проверку вместе с паузой, исходный каталог не изменён')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('monitoring-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
