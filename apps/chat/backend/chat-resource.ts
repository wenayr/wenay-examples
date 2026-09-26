import {randomUUID} from 'node:crypto'
import {createConversationHost, type ConversationRemote, type ConversationPostInput} from 'wenay-common2/conversation'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {createConversationJournal} from './conversation-journal'

export type DemoReplyInput = {requestId: string, conversationId: string, channelId: string, sourceMessageId: string}

function bounded(value: string, label: string, max: number) {
    if (typeof value != 'string' || !value.trim() || value.length > max) throw new Error('Проверьте ' + label)
    return value
}

export function createChatResource(deps: {directory: string, member: (account: string) => boolean, maxConversations?: number}) {
    const journal = createConversationJournal({directory: deps.directory})
    const maxConversations = deps.maxConversations ?? 100
    let commandTail = Promise.resolve()
    // Keep current ACL, payload checks and limits in the same operation as the native commit.
    function command<T>(work: () => Promise<T>) {
        const result = commandTail.then(work, work)
        commandTail = result.then(function completed() {}, function failed() {})
        return result
    }
    const host = createConversationHost({initial: journal.initial, persistence: journal.persistence, history: 8,
        id: kind => kind + '-' + randomUUID(), policy: {
            canRead: (account, room) => deps.member(account) && room.participantIds.includes(account),
            canWrite: (account, room) => deps.member(account) && room.participantIds.includes(account),
            canCreate: account => deps.member(account)
        }})
    function requireRoom(account: string, id: string) {
        const room = host.control.store.state.conversations[id]
        if (!deps.member(account) || !room?.participantIds.includes(account)) throw new Error('Нет доступа к разговору')
        return room
    }
    const resource = {allow: ['member'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const account = ctx.principal.account
        const connection = host.connection(account)
        let closed = false
        function active() {
            if (closed || ctx.signal.aborted || !deps.member(account)) throw new Error('Сессия общения закрыта')
        }
        function request(value: string) {
            active()
            return bounded(value, 'идентификатор команды', 128)
        }
        function previous(requestId: string) {
            const receipt = journal.receipt(account, requestId)
            if (!receipt) return
            const store = host.control.store.state
            const entity = store.messages[receipt.entityId] ?? store.channels[receipt.entityId] ?? store.facts[receipt.entityId]
            requireRoom(account, entity ? entity.conversationId : receipt.entityId)
            return receipt
        }
        async function performCreateConversation(input: Parameters<ConversationRemote['createConversation']>[0]) {
            request(input.requestId)
            const receipt = previous(input.requestId)
            bounded(input.title, 'название разговора (до 120 символов)', 120)
            if (input.rootTitle != undefined) bounded(input.rootTitle, 'название основного канала (до 120 символов)', 120)
            const participants = input.participantIds ?? []
            if (!Array.isArray(participants) || participants.length > 20 || !participants.every(deps.member)) throw new Error('Неизвестные участники')
            if (receipt?.command == 'createConversation') {
                const old = host.control.store.state.conversations[receipt.entityId]
                const sameMembers = JSON.stringify(old.participantIds) == JSON.stringify([...new Set([account, ...participants])])
                const root = host.control.store.state.channels[old.rootChannelId]
                if (old.title != input.title || !sameMembers || root.title != (input.rootTitle ?? 'Main')) {
                    throw new Error('Идентификатор повтора использован с другими параметрами')
                }
            }
            if (!receipt && Object.keys(host.control.store.state.conversations).length >= maxConversations) {
                throw new Error('Предел этого экземпляра: ' + maxConversations + ' разговоров')
            }
            const result = await connection.fragment.createConversation(input)
            active()
            return result
        }
        async function performCreateChannel(input: Parameters<ConversationRemote['createChannel']>[0]) {
            request(input.requestId)
            requireRoom(account, input.conversationId)
            const receipt = previous(input.requestId)
            bounded(input.title, 'название канала (до 120 символов)', 120)
            if (receipt?.command == 'createChannel') {
                const old = host.control.store.state.channels[receipt.entityId]
                const sameParent = old.parent?.messageId == input.parentMessageId
                const sameRoom = old.conversationId == input.conversationId && old.title == input.title
                if (!sameRoom || !sameParent || old.factMode != (input.factMode ?? 'inherit')) {
                    throw new Error('Идентификатор повтора использован с другими параметрами')
                }
            }
            const result = await connection.fragment.createChannel(input)
            active()
            return result
        }
        function validatePost(input: ConversationPostInput) {
            request(input.requestId)
            if (input.requestId.startsWith('demo:')) throw new Error('Идентификатор зарезервирован для тестового исполнителя')
            requireRoom(account, input.conversationId)
            const receipt = previous(input.requestId)
            const channel = host.control.store.state.channels[input.channelId]
            if (!channel || channel.conversationId != input.conversationId) throw new Error('Нет доступа к каналу')
            if (!Array.isArray(input.blocks) || input.blocks.length != 1 || input.blocks[0].kind != 'text') throw new Error('Ожидается текстовое сообщение')
            if (input.blocks[0].version != 1) throw new Error('Неподдерживаемая версия текстового сообщения')
            bounded(input.blocks[0].text, 'сообщение (до 4000 символов)', 4000)
            if (!receipt && Object.keys(host.control.store.state.messages).length >= 5000) throw new Error('Предел этого экземпляра: 5000 сообщений')
            if (receipt?.command == 'postMessage') {
                const old = host.control.store.state.messages[receipt.entityId]
                const sameTarget = old.conversationId == input.conversationId && old.channelId == input.channelId
                const oldText = old.blocks[0]
                if (!sameTarget || oldText.kind != 'text' || oldText.text != input.blocks[0].text) {
                    throw new Error('Идентификатор повтора использован с другими параметрами')
                }
            }
        }
        async function performPostMessage(input: ConversationPostInput) {
            validatePost(input)
            const result = await connection.fragment.postMessage(input)
            active()
            return result
        }
        async function denied(): Promise<never> {active()
        throw new Error('Факты не доступны в этом примере')}
        const conversation = {...connection.fragment,
            createConversation(input) {return command(function create() {return performCreateConversation(input)})},
            createChannel(input) {return command(function create() {return performCreateChannel(input)})},
            postMessage(input) {return command(function post() {return performPostMessage(input)})},
            upsertFact: denied, retractFact: denied} satisfies ConversationRemote
        async function performReply(input: DemoReplyInput) {
            request(input.requestId)
            requireRoom(account, input.conversationId)
            const requestId = 'demo:' + input.requestId
            const receipt = previous(requestId)
            const source = host.control.store.state.messages[input.sourceMessageId]
            const visibleSource = source?.conversationId == input.conversationId && source.channelId == input.channelId
            if (!visibleSource || source.author.kind != 'account') throw new Error('Выберите сообщение участника в этом канале')
            if (!receipt && Object.keys(host.control.store.state.messages).length >= 5000) throw new Error('Предел этого экземпляра: 5000 сообщений')
            if (receipt?.command == 'postMessage') {
                const old = host.control.store.state.messages[receipt.entityId]
                const marker = old.blocks.find(block => block.kind == 'custom' && block.type == 'demo-source')
                const sameTarget = old.conversationId == input.conversationId && old.channelId == input.channelId
                if (!sameTarget || marker?.kind != 'custom' || marker.data != input.sourceMessageId) {
                    throw new Error('Идентификатор повтора использован с другими параметрами')
                }
            }
            const text = source.blocks.filter(block => block.kind == 'text').map(block => block.text).join('\n')
            const result = await host.control.appendMessage(account, {requestId, conversationId: input.conversationId, channelId: input.channelId,
                author: {kind: 'assistant', id: 'demo', label: 'Тестовый ИИ'},
                blocks: [{kind: 'text', version: 1, text: 'Тестовый ответ: «' + text + '». Сообщение получено; внешняя модель не вызывается.'},
                    {kind: 'custom', version: 1, type: 'demo-source', data: input.sourceMessageId}]})
            active()
            return result
        }
        return {facade: {conversation, demo: {reply(input: DemoReplyInput) {
            return command(function reply() {return performReply(input)})
        }}}, close() {
            closed = true
            connection.close()
        }}
    }}
    return {resource, close: host.close}
}
export type ChatFacade = ReturnType<ReturnType<typeof createChatResource>['resource']['open']>['facade']
