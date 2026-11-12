import {createConversationClient, type ConversationRemote} from 'wenay-common2/conversation'

// Обход common2: CONVERSATION-RESOURCE-LIFECYCLE
// common2 3.1.1 has no conversation onError: close both native consumers before their
// RPC line-completion callbacks run. Preserve the original handle, schema and replay APIs.
export function createOwnedConversation(deps: {remote: ConversationRemote, onEnded?: () => void}) {
    let client: ReturnType<typeof createConversationClient> | null = null
    let closed = false
    function ended() {
        if (closed) return
        closed = true
        client?.close()
        deps.onEnded?.()
    }
    function observeReplay<T extends {line: {on: (callback: any) => any}}>(remote: T): T {
        return new Proxy(remote, {get(target, key) {
            if (key != 'line' && key != 'frameLine') return Reflect.get(target, key)
            const line = Reflect.get(target, key) as {on: (callback: (event: unknown) => void) => any} | undefined
            if (!line) return line
            return {on: function subscribe(callback: (event: unknown) => void) {
                const handle = line.on(function receive(event: unknown) {
                    if (event == null) {
                        ended()
                        return
                    }
                    if (!closed) callback(event)
                })
                // The library receives the same cancellable thenable after this observer is registered.
                if (typeof handle?.then == 'function') void handle.then(ended, ended)
                return handle
            }}
        }})
    }
    const state = observeReplay(deps.remote.state)
    const events = observeReplay(deps.remote.events)
    const remote = new Proxy(deps.remote, {get(target, key) {
        if (key == 'state') return state
        if (key == 'events') return events
        return Reflect.get(target, key)
    }})
    client = createConversationClient({remote})
    if (closed) client.close()
    function close() {
        if (closed) return
        closed = true
        client!.close()
    }
    return {...client, close}
}
