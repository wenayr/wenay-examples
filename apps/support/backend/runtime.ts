import {supportDefinition} from './service'
import {createSupportAssistant, type DraftProvider} from './assistant-resource'
import {createSupportFiles} from './files-resource'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {schemaCommand, SYSTEM_ACCOUNT, type ServiceCommandCtx} from 'wenay-common2/service'
import type {SupportState} from './model'
import type {UsageGate} from './metered-execution'
import {createTenantOrganizer} from './organizer'
import {createNotifications, withNotification} from './notifications'
import {createContentKnowledge} from './content-resource'
import {createConversationHistory} from './conversation-resource'

type RuntimeOptions = {
    directory?: string,
    provider?: DraftProvider,
    demo?: boolean,
    timeoutMs?: number,
    usage?: UsageGate,
    content?: Parameters<typeof createContentKnowledge>[0]
}

export function createSupportRuntime(deps: RuntimeOptions = {}) {
    const assistant = createSupportAssistant(deps)
    const files = createSupportFiles({directory: deps.directory ? path.join(deps.directory, 'files') : undefined})
    const organizer = createTenantOrganizer()
    const notifications = createNotifications()
    const content = createContentKnowledge(deps.content)
    const conversation = createConversationHistory()
    const identityProvision = schemaCommand({issuer: 'string', subject: 'string', name: 'string'}, {allow: ['system'],
        apply(ctx: ServiceCommandCtx<SupportState>, input) {
            if (ctx.account != SYSTEM_ACCOUNT) throw new Error('Только сервер может подтвердить внешнюю личность')
            const issued = input.issuer && input.issuer.length <= 2000
            const subject = input.subject && input.subject.length <= 255
            const named = input.name.trim() && input.name.length <= 160
            if (!issued || !subject || !named) throw new Error('Некорректная внешняя личность')
            const account = 'oidc-' + createHash('sha256').update(JSON.stringify([input.issuer, input.subject])).digest('hex')
            if (!Object.hasOwn(ctx.state.accounts, account)) {
                if (Object.keys(ctx.state.accounts).length >= 1000) throw new Error('Достигнут предел аккаунтов этого экземпляра')
                // An externally confirmed account has no usable local password and no tenant memberships.
                ctx.state.accounts[account] = {account, name: input.name.trim(), secret: {salt: '', hash: ''}}
            }
            return {account}
        }})
    const base = deps.demo == false ? {...supportDefinition,
        initial: {accounts: {}, organizations: {}, tickets: {}, articles: {}, invites: {}, audit: []} as SupportState,
        access: {...supportDefinition.access, login: {...supportDefinition.access.login, resolve() {return null}}}
    } : supportDefinition
    return {definition: {...base, commands: {...supportDefinition.commands, ...organizer.commands, ...notifications.commands,
        ticketCreate: withNotification(supportDefinition.commands.ticketCreate, 'Новое обращение'),
        ticketReply: withNotification(supportDefinition.commands.ticketReply, 'Новое сообщение'),
        ticketAssign: withNotification(supportDefinition.commands.ticketAssign, 'Назначен исполнитель'),
        ticketStatus: withNotification(supportDefinition.commands.ticketStatus, 'Статус обращения изменён'), identityProvision},
        views: {...base.views, ...organizer.views, ...notifications.views},
        resources: {
            assistant: assistant.resource,
            files: files.resource,
            content: content.resource,
            conversation: conversation.resource
        }
    },
        search: assistant.search,
        mount(store: Parameters<typeof assistant.mount>[0]) {
            const closeAssistant = assistant.mount(store)
            const closeFiles = files.mount(store)
            const closeContent = content.mount(store)
            const closeConversation = conversation.mount(store)
            return function close() {
                closeConversation()
                closeContent()
                closeFiles()
                closeAssistant()
            }
        }}
}
export type SupportDefinition = ReturnType<typeof createSupportRuntime>['definition']
