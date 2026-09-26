import {createStore} from 'wenay-common2/observe'
import type {ConversationClient} from 'wenay-common2/conversation'
import {createOwnedConversation} from '../shared/conversation-client'
import type {ChatSession, tChatResourceName} from './contracts'
import {errorText} from './contracts'

// Потребитель replay закрывается синхронно, раньше закрытия его RPC-ресурса.
export function createConversationOwner(deps: {session: ChatSession, resourceName: tChatResourceName}) {
    const resource = deps.session.resources.open(deps.resourceName)
    const store = createStore({generation: 0, ready: false, error: ''})
    let client: ConversationClient | null = null
    let current: ReturnType<typeof resource.current> = null
    let closed = false
    let terminalGeneration = -1

    function releaseGeneration() {
        const previous = client
        client = null
        current = null
        previous?.close()
        previous?.store.replace({conversations: {}, channels: {}, messages: {}, facts: {}})
        store.replace({generation: resource.status.state.generation, ready: false, error: ''})
    }
    function changed() {
        if (closed) return
        const next = resource.status.state.phase == 'ready' ? resource.current() : null
        if (next?.generation == current?.generation) return
        if (next?.generation == terminalGeneration) return
        releaseGeneration()
        if (!next) return
        current = next
        const owned = createOwnedConversation({remote: next.remote.conversation, onEnded: function ended() {
            if (closed || current?.generation != next.generation) return
            terminalGeneration = next.generation
            releaseGeneration()
            store.replace({generation: next.generation, ready: false, error: 'Разговор отключён. Ожидаем обновления доступа или соединения.'})
        }})
        if (terminalGeneration == next.generation) {
            owned.close()
            owned.store.replace({conversations: {}, channels: {}, messages: {}, facts: {}})
            return
        }
        client = owned
        void owned.ready.then(function ready() {
            if (closed || client != owned) return
            store.replace({generation: next.generation, ready: true, error: ''})
        }).catch(function failed(error) {
            if (closed || client != owned) return
            terminalGeneration = next.generation
            releaseGeneration()
            store.replace({generation: next.generation, ready: false, error: errorText(error)})
        })
    }
    const stop = resource.status.on(changed, {current: true, drain: 'immediate'})
    return {
        store, status: resource.status, ready: Promise.resolve(),
        current: () => client && current ? {client, remote: current.remote} : null,
        close() {
            if (closed) return
            closed = true
            stop()
            releaseGeneration()
            return resource.close()
        }
    }
}
