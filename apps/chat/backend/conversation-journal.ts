import {mkdirSync, existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync} from 'node:fs'
import path from 'node:path'
import type {ConversationInitial, ConversationPersistencePort} from 'wenay-common2/conversation'

function seedConversation(id: string, title: string, participantIds: string[]) {
    const channelId = id == 'shared' ? 'shared-main' : 'private-alice-main'
    return {
        conversation: {id, owner: 'alice', title, participantIds, rootChannelId: channelId, state: 'open' as const, createdAt: 0, updatedAt: 0},
        channel: {id: channelId, conversationId: id, title: 'Основной', createdBy: 'alice', factMode: 'inherit' as const,
            state: 'open' as const, createdAt: 0, updatedAt: 0}
    }
}

// This port stores the library event and receipt together; conversation owns command deduplication.
export function createConversationJournal(deps: {directory: string}) {
    const seeds = [seedConversation('shared', 'Общий разговор', ['alice', 'bob']), seedConversation('private-alice', 'Личный разговор', ['alice'])]
    const initial: ConversationInitial = {store: {
        conversations: Object.fromEntries(seeds.map(item => [item.conversation.id, item.conversation])),
        channels: Object.fromEntries(seeds.map(item => [item.channel.id, item.channel])), messages: {}, facts: {}
    }, receipts: []}
    mkdirSync(deps.directory, {recursive: true})
    const file = path.join(deps.directory, 'conversation.jsonl')
    function apply(record: Parameters<ConversationPersistencePort['commit']>[0]) {
        const {event, receipt} = record
        const store = initial.store
        if (event.type == 'conversation.created') {
            store.conversations[event.conversation.id] = event.conversation
            store.channels[event.channel.id] = event.channel
        } else if (event.type == 'channel.created') store.channels[event.channel.id] = event.channel
        else if (event.type == 'message.posted') {
            store.messages[event.message.id] = event.message
            store.conversations[event.conversationId].updatedAt = event.message.createdAt
            store.channels[event.message.channelId].updatedAt = event.message.createdAt
        } else {
            store.facts[event.fact.id] = event.fact
            store.conversations[event.conversationId].updatedAt = event.fact.updatedAt
        }
        initial.receipts!.push(receipt)
    }
    if (existsSync(file)) {
        const raw = readFileSync(file, 'utf8')
        if (raw && !raw.endsWith('\n')) throw new Error('Журнал повреждён: незавершённая запись; восстановите резервную копию')
        for (const line of raw.split('\n').filter(Boolean)) apply(JSON.parse(line))
    }
    let failed = false
    const persistence: ConversationPersistencePort = {commit(record) {
        if (failed) throw new Error('Журнал остановлен после ошибки записи')
        const bytes = Buffer.from(JSON.stringify(record) + '\n')
        const descriptor = openSync(file, 'a', 0o600)
        try {
            let offset = 0
            while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset)
            fsyncSync(descriptor)
        } catch (error) {
            failed = true
            throw error
        } finally {closeSync(descriptor)}
        apply(record)
    }}
    // Read the library's durable receipt only to authorize its original result before an RPC retry.
    function receipt(account: string, requestId: string) {
        return initial.receipts!.find(item => item.account == account && item.requestId == requestId)
    }
    return {initial, persistence, receipt}
}
