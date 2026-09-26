import type {ServiceClient} from 'wenay-common2/service/client'
import type {ConversationMessage, ConversationPostInput} from 'wenay-common2/conversation'
import type {ChatDefinition} from '../backend/service'
import type {ChatFacade} from '../backend/chat-resource'

export type ChatSession = ServiceClient<ChatDefinition>
export type tDelivery = {
    kind: 'message',
    title: string,
    input: ConversationPostInput,
    text: string
} | {
    kind: 'demo',
    title: string,
    input: Parameters<ChatFacade['demo']['reply']>[0]
}

export function errorText(error: unknown) {
    if (error instanceof Error) return error.message
    return error ? String(error) : ''
}

export function messageText(message: ConversationMessage) {
    return message.blocks.flatMap(block => block.kind == 'text' ? [block.text] : []).join('\n')
}

export function authorName(message: ConversationMessage) {
    const author = message.author
    if (author.label) return author.label
    if (author.kind == 'account') {
        if (author.account == 'alice') return 'Алиса'
        return author.account == 'bob' ? 'Боб' : author.account
    }
    return author.kind == 'assistant' ? 'Тестовый помощник' : 'Система'
}
