import assert from 'node:assert/strict'
import {createServiceClient, type ServiceClient} from 'wenay-common2/service/client'
import type {ApprovalDefinition} from '../../approvals/backend/runtime'
import {checkHostedApplication, waitForHosted} from './hosted-application-check'

type Client = ServiceClient<ApprovalDefinition>

// Размещение согласований: заявка переживает обновление и откат релиза,
// отозванная роль не возвращается вместе с прежней версией образа.
async function main() {
    let author: Client | undefined
    let reviewer: Client | undefined
    let owner: Client | undefined
    let requestId = ''
    let reviewerBearer = ''
    const orgId = 'northstar'
    const answers = JSON.stringify({purpose: 'Размещённая заявка для приёмки', amount: 12000, urgent: false})

    function workspace(client: Client) {
        return client.views.workspace.store.state
    }
    function row(client: Client) {
        return workspace(client).requests.find(item => item.id == requestId)
    }

    await checkHostedApplication({name: 'approvals', async verify({url, iteration}) {
        const page = await fetch(url).then(response => response.text())
        assert(page.includes('Согласования'), 'страница размещённого приложения отдаётся')
        if (!author) {
            const definition = await fetch(url + '/api/client').then(response => response.json())
            const credentials = (account: string) => ({credentials: {account, password: account + '-pass'}})
            author = createServiceClient<ApprovalDefinition>({definition, url, auth: credentials('requester')})
            reviewer = createServiceClient<ApprovalDefinition>({definition, url, auth: credentials('reviewer')})
            owner = createServiceClient<ApprovalDefinition>({definition, url, auth: credentials('owner')})
            for (const client of [author, reviewer, owner]) {
                await client.ready()
                await client.views.workspace.ready
            }
            const login = async function bearer(account: string) {
                const body = JSON.stringify({args: [{account, password: account + '-pass'}]})
                const headers = {'content-type': 'application/json'}
                const result = await fetch(url + '/api/approvals/login', {method: 'POST', headers, body, signal: AbortSignal.timeout(3000)})
                const answer = await result.json()
                assert(answer.ok)
                return answer.value.token as string
            }
            reviewerBearer = await login('reviewer')
            const draft = {orgId, id: '', revision: 0, key: 'hosted-save-key', title: 'Размещённая заявка', answersJson: answers}
            requestId = (await author.commands.requestSave('hosted-save', draft)).id
            await waitForHosted('заявка видна автору', () => !!row(author!))
            await author.commands.requestSubmit('hosted-submit', {orgId, id: requestId, revision: row(author)!.revision, key: 'hosted-submit-key'})
            await waitForHosted('версия дошла до проверяющего', () => row(reviewer!)?.status == 'pending')
        } else {
            await waitForHosted('состояние восстановлено после смены релиза', function reconnected() {
                return !!author?.health.state.connected && !!row(author!)
            })
            if (iteration == 1) {
                // Обновление релиза: том сохранился, решение принимается по той же версии.
                const decide = {orgId, id: requestId, revision: row(reviewer!)!.revision, version: 1, key: 'hosted-decide-key'}
                await reviewer!.commands.requestDecide('hosted-decide', {...decide, decision: 'changes', body: 'Уточните смету'})
                await waitForHosted('возврат дошёл до автора', () => row(author!)?.status == 'changes')
                const team = workspace(owner!).organizations.find(org => org.id == orgId)!
                await owner!.commands.memberRole('hosted-revoke', {orgId, revision: team.revision, account: 'reviewer', role: 'none'})
            } else {
                // Откат образа не возвращает отозванный доступ: он лежит в данных, а не в релизе.
                assert.equal(row(author!)?.status, 'changes', 'решение пережило откат релиза')
                assert.equal(row(author!)?.versions.length, 1)
                assert.equal(row(author!)?.history.length, 2)
                const people = workspace(owner!).people
                assert.equal(people.some(person => person.account == 'reviewer'), false, 'отзыв роли пережил откат')
                const headers = {'content-type': 'application/json', authorization: 'Bearer ' + reviewerBearer}
                const body = JSON.stringify({args: ['after-rollback', {
                    orgId,
                    id: requestId,
                    revision: 3,
                    key: 'after-rollback-key',
                    version: 1,
                    decision: 'approved',
                    body: ''
                }]})
                const denied = await fetch(url + '/api/approvals/commands/requestDecide', {method: 'POST', headers, body, signal: AbortSignal.timeout(3000)})
                const answer = await denied.json()
                assert.equal(answer.ok, false, 'отозванный проверяющий не решает после отката')
                assert.match(answer.error.message, /forbidden|denied|доступ|unauthorized/i)
            }
        }
        assert.equal(row(author!)?.orgId, orgId)
        assert.equal(JSON.stringify(workspace(author!)).includes('outsider'), false, 'чужая организация не попадает в проекцию')
    }, async close() {
        owner?.close()
        reviewer?.close()
        author?.close()
    }})
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
