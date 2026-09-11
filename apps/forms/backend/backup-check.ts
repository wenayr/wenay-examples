import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, realpathSync, rmSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {FormsDefinition} from './runtime'
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

// Холодная копия форм: удаление ответа обязано пережить восстановление вместе
// с надгробием, иначе повтор того же ключа приёма вернёт удалённый текст.
async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'forms-backup-'))
    const live = path.join(directory, 'live')
    const copy = path.join(directory, 'copy')
    const restored = path.join(directory, 'restored')
    const env = {
        SERVICE_PORT: '0', SERVICE_HOST: '127.0.0.1', SERVICE_DATA_DIR: live,
        SERVICE_TOKEN_SECRET: randomBytes(32).toString('hex'), SERVICE_NODE_TOKEN: randomBytes(32).toString('hex')
    }
    let host = createProcess({script: 'server.ts', env})
    let url = await host.ready
    const clients: ServiceClient<FormsDefinition>[] = []
    const resources: {close(): Promise<void>}[] = []

    async function client(account: string, password = account + '-pass') {
        const definition = await fetch(url + '/api/client').then(response => response.json())
        const session = createServiceClient<FormsDefinition>({definition, url, auth: {credentials: {account, password}}})
        clients.push(session)
        await session.ready()
        if (account != 'respondent') await session.views.workspace.ready
        return session
    }
    async function resource<K extends keyof FormsDefinition['resources']>(session: ServiceClient<FormsDefinition>, name: K) {
        const handle = session.resources.open(name)
        resources.push(handle)
        await waitFor(name + ' ready', () => handle.status.state.phase == 'ready')
        return handle
    }
    async function close() {
        for (const handle of resources.splice(0)) await handle.close().catch(() => {})
        for (const session of clients.splice(0)) session.close()
        await host.control.stop()
    }
    function aggregate(session: ServiceClient<FormsDefinition>) {
        return session.views.workspace.store.state.aggregates[0]
    }

    const orgId = 'northstar'
    const id = 'form-feedback'
    const kept = 'backup-kept'
    const removed = 'backup-removed'
    try {
        const owner = await client('owner')
        const editor = await resource(owner, 'editor')
        const published = await editor.current()!.remote.control.publish({orgId, id, revision: 1, requestId: 'backup-publication'})
        assert(published.token, 'публикация выдала токен')
        const respondent = await client('respondent', published.token)
        const publicForm = await resource(respondent, 'publicform')
        // Поле details показывается только при recommend: false — отвечаем так оба раза.
        for (const [nonce, rating] of [[kept, 4], [removed, 2]] as const) {
            await publicForm.current()!.remote.control.submit({
                version: published.version,
                nonce,
                answers: {rating, recommend: false, details: 'Ответ ' + nonce}
            })
        }
        await waitFor('оба ответа в агрегате', () => aggregate(owner)?.count == 2)
        const answers = await resource(owner, 'answers')
        const list = await answers.current()!.remote.control.list({orgId, formId: id, version: published.version, offset: 0, limit: 100})
        const target = list.items.find(item => item.answers.details == 'Ответ ' + removed)!
        await owner.commands.answerDelete('delete-answer', {orgId, formId: id, id: target.id})
        await waitFor('удаление уменьшило агрегат', () => aggregate(owner)?.count == 1)
        await close()

        assert.throws(() => run('backup.mjs', ['forms', copy, '--from=' + live]), /--i-stopped-it/)
        run('backup.mjs', ['forms', copy, '--i-stopped-it', '--from=' + live, '--data-version=forms-1'])
        assert(existsSync(path.join(copy, 'manifest.json')) && existsSync(path.join(copy, 'complete')))
        assert.throws(() => run('restore.mjs', [copy, restored, '--data-version=forms-2']), /Формат данных/)
        run('restore.mjs', [copy, restored, '--data-version=forms-1'])

        host = createProcess({script: 'server.ts', env: {...env, SERVICE_DATA_DIR: restored}})
        url = await host.ready
        const again = await client('owner')
        assert.equal(aggregate(again)?.count, 1, 'агрегат восстановлен без удалённого ответа')
        const restoredAnswers = await resource(again, 'answers')
        const page = await restoredAnswers.current()!.remote.control.list({orgId, formId: id, version: published.version, offset: 0, limit: 100})
        assert.equal(page.items.length, 1, 'в копии остался один ответ')
        assert.equal(page.items[0].answers.details, 'Ответ ' + kept)
        assert.equal(JSON.stringify(page).includes('Ответ ' + removed), false, 'удалённый текст не вернулся из копии')

        // Публикация и её поколение пережили восстановление: тот же токен снова работает,
        // а повтор удалённого ключа приёма не воскрешает запись.
        const restoredRespondent = await client('respondent', published.token)
        const restoredForm = await resource(restoredRespondent, 'publicform')
        const repeat = await restoredForm.current()!.remote.control.submit({
            version: published.version,
            nonce: removed,
            answers: {rating: 1, recommend: false, details: 'Ответ ' + removed}
        })
        assert.equal(repeat.duplicate, true, 'надгробие удалённого ответа пережило восстановление')
        assert.equal(aggregate(again)?.count, 1, 'повтор удалённого ключа не добавил запись')

        console.log('PASS forms backup: отказ без подтверждения остановки, отказ при несовпадении формата данных,')
        console.log('  восстановление публикации, ответов и агрегата в новый каталог,')
        console.log('  удалённый ответ не возвращается, повтор его ключа приёма отклонён надгробием')
    } finally {
        await close().catch(() => {})
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('forms-backup-'))
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
