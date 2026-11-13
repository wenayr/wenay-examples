import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {ContentDefinition} from '../../content/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

type Client = ServiceClient<ContentDefinition>
type Published = {title: string, version: number}

const orgId = 'northstar'
const slug = 'hosted'

// Размещение контент-студии: опубликованная страница переживает обновление и откат
// образа, а публичное чтение и история версий живут в томе, а не в релизе.
async function main() {
    let author: Client | undefined
    let editor: Client | undefined
    let publisher: Client | undefined
    let reader: Client | undefined
    let pageId = ''

    function page(client: Client) {
        return client.views.workspace.store.state.pages.find(item => item.id == pageId)
    }
    function blocks(text: string) {
        return [{id: 'intro', kind: 'text' as const, text, assetId: '', href: ''}]
    }
    async function publicRead(): Promise<Published> {
        // После смены релиза клиент ищет новый адрес в roster: ресурс открываем уже на связи.
        await waitForHosted('читатель на связи', () => !!reader?.health.state.connected)
        const resource = reader!.resources.open('published')
        await waitForHosted('публичный ресурс открыт', () => !!resource.current())
        const value = await resource.current()!.remote.control.read({orgId, slug})
        resource.close()
        return value as Published
    }
    // Ревизия берётся из квитанции предыдущей команды: проекция приходит позже,
    // и читать её здесь значило бы проверять скорость доставки, а не размещение.
    async function approveAndPublish(title: string, revision: number, key: string) {
        const saved = await author!.commands.pageSave(key + '-save', {
            orgId, id: pageId, revision, title, slug, blocks: blocks(title)
        })
        const submitted = await author!.commands.reviewSubmit(key + '-submit', {
            orgId, id: pageId, revision: saved.revision
        })
        const decided = await editor!.commands.reviewDecide(key + '-decide', {
            orgId, id: pageId, revision: submitted.revision,
            version: submitted.version, decision: 'approved', body: 'Готово к публикации'
        })
        await publisher!.commands.pagePublish(key + '-publish', {
            orgId, id: pageId, revision: decided.revision, version: submitted.version, key: key + '-intent'
        })
        await waitForHosted('публикация видна автору', () => page(author!)?.publishedVersion == submitted.version)
        await waitForHosted('черновик дошёл до редактора', () => page(editor!)?.draft.title == title)
        return submitted.version
    }

    await checkHostedApplication({name: 'content', async verify({url, iteration}) {
        const html = await fetch(url).then(response => response.text())
        assert(html.includes('<div id="root">'), 'страница размещённого приложения отдаётся')
        if (!author) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            const credentials = (account: string) => ({credentials: {account, password: account + '-pass'}})
            author = createServiceClient<ContentDefinition>({definition, url, auth: credentials('author')})
            editor = createServiceClient<ContentDefinition>({definition, url, auth: credentials('editor')})
            publisher = createServiceClient<ContentDefinition>({definition, url, auth: credentials('publisher')})
            reader = createServiceClient<ContentDefinition>({definition, url, auth: credentials('reader')})
            for (const client of [author, editor, publisher, reader]) {
                await client.ready()
                await client.views.workspace.ready
            }
            const created = await author.commands.pageSave('hosted-create', {
                orgId, id: '', revision: 0, title: 'Размещённая страница', slug, blocks: blocks('Размещённая страница')
            })
            pageId = created.id
            await waitForHosted('страница видна автору', () => !!page(author!))
            const version = await approveAndPublish('Размещённая страница', created.revision, 'hosted-v1')
            assert.equal(version, 1)
            assert.equal((await publicRead()).title, 'Размещённая страница')
            return
        }
        await waitForHosted('состояние восстановлено после смены релиза', function reconnected() {
            const clients = [author, editor, publisher, reader]
            return clients.every(client => !!client?.health.state.connected) && !!page(author!)
        })
        if (iteration == 1) {
            // Обновление релиза: том сохранил публикацию, поверх неё выходит вторая версия.
            assert.equal((await publicRead()).title, 'Размещённая страница', 'публикация пережила обновление')
            const version = await approveAndPublish('Вторая версия страницы', page(author!)!.revision, 'hosted-v2')
            assert.equal(version, 2)
            assert.equal((await publicRead()).title, 'Вторая версия страницы')
            return
        }
        // Откат образа не откатывает данные: вернуть прежний текст можно только командой отката.
        assert.equal((await publicRead()).title, 'Вторая версия страницы', 'данные пережили откат релиза')
        const current = page(publisher!)!
        assert.equal(current.publications.length, 2)
        await publisher!.commands.pageRollback('hosted-rollback', {
            orgId, id: pageId, revision: current.revision, version: 1, key: 'hosted-rollback-intent'
        })
        await waitForHosted('откат дошёл до автора', () => page(author!)?.publishedVersion == 1)
        assert.equal((await publicRead()).title, 'Размещённая страница', 'откат вернул прежнюю публикацию')
        const projection = JSON.stringify(reader!.views.workspace.store.state)
        assert.equal(projection.includes('Вторая версия страницы'), false, 'читатель не видит редакторские данные')
    }, async close() {
        for (const client of [author, editor, publisher, reader]) client?.close()
    }})
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
