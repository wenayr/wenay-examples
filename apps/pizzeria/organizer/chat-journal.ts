import {mkdirSync, existsSync, readFileSync, openSync, writeSync, fsyncSync, closeSync} from 'node:fs'
import path from 'node:path'
import type {ConversationInitial, ConversationPersistencePort} from 'wenay-common2/conversation'

// Conversation owns events and receipts; this adapter only persists its public records.
export function createChatJournal(deps: {directory?: string}) {
    const initial: ConversationInitial = {store: {conversations: {}, channels: {}, messages: {}, facts: {}}, receipts: []}
    const file = deps.directory ? path.join(deps.directory, 'conversation.jsonl') : null
    function apply({event, receipt}: Parameters<ConversationPersistencePort['commit']>[0]) {
        const store = initial.store
        if (event.type == 'conversation.created') {
            store.conversations[event.conversation.id] = event.conversation
            store.channels[event.channel.id] = event.channel
        }
        else if (event.type == 'channel.created') store.channels[event.channel.id] = event.channel
        else if (event.type == 'message.posted') store.messages[event.message.id] = event.message
        else store.facts[event.fact.id] = event.fact
        initial.receipts!.push(receipt)
    }
    if (file) {
        mkdirSync(deps.directory!, {recursive: true})
        if (existsSync(file)) {
            const raw = readFileSync(file, 'utf8')
            if (raw && !raw.endsWith('\n')) throw new Error('Журнал общения повреждён: требуется восстановление резервной копии')
            for (const line of raw.split('\n').filter(Boolean)) apply(JSON.parse(line))
        }
    }
    let failed = false
    const persistence: ConversationPersistencePort = {commit(record) {
        if (failed) throw new Error('Журнал общения остановлен после ошибки записи')
        if (!file) return
        const bytes = Buffer.from(JSON.stringify(record) + '\n')
        const fd = openSync(file, 'a', 0o600)
        try {
            let offset = 0
            while (offset < bytes.length) offset += writeSync(fd, bytes, offset)
            fsyncSync(fd)
        } catch (error) {failed = true
        throw error}
        finally {closeSync(fd)}
    }}
    return {initial, persistence}
}
