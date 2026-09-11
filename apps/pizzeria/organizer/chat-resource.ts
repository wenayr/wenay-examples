import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {createConversationHost, type Conversation, type ConversationMessage} from 'wenay-common2/conversation'
import {createStore, exposeStoreReplay, type Store} from 'wenay-common2/observe'
import {createLocalBlobStorage} from 'wenay-common2/server/blob'
import type {ServiceResourceContext, tServicePrincipal} from 'wenay-common2/service'
import type {WorkView} from './model'
import {createChatJournal} from './chat-journal'
import {createAssistant, type AssistantProvider, type Proposal} from './assistant-resource'

export type ChatView = {
    rooms: {id: string, title: string, unread: number, members: string[], task: string, owner: string, revision: number}[],
    room: string,
    messages: (ConversationMessage & {editRevision: number})[],
    older: string,
    typing: string[]
}
const blank = (): ChatView => ({rooms: [], room: '', messages: [], older: '', typing: []})

function known(people: {account: string}[], account: string) {
    return people.some(person => person.account == account)
}

// Поиск идёт по видимому тексту: у ссылки на файл это подпись.
function blockText(block: {kind: string, text?: string, label?: string}) {
    if (block.kind == 'text') return block.text ?? ''
    return block.kind == 'resource' ? block.label ?? '' : ''
}

export function createChatRoom(deps: {allow: readonly string[], directory?: string, provider?: AssistantProvider}) {
    let project: ((account: string) => WorkView) | null = null
    const journal = createChatJournal({directory: deps.directory})
    const host = createConversationHost({...journal, history: 10, id: kind => kind + '-' + randomUUID(), policy: {
        canRead: readable, canWrite: readable,
        canCreate: (account, input) => !!project && Object.keys(host.control.store.state.conversations).length < 100 &&
            known(project!(account).people, account)
                && (input.participantIds ?? []).every(id => known(project!(account).people, id)),
    }})
    const members = new Map<string, {ctx: ServiceResourceContext, store: Store<ChatView>, room: string, before: string, query: string, typed: number}>()
    function fact(room: string, namespace: string, key: string) {
        return Object.values(host.control.store.state.facts).find(function current(item) {
            if (item.conversationId != room || item.namespace != namespace) return false
            return item.key == key && item.state == 'active'
        })
    }
    function participantIds(room: Conversation) {
        const value = fact(room.id, 'membership', 'current')?.value
        return Array.isArray(value) && value.every(id => typeof id == 'string') ? value : room.participantIds
    }
    function taskId(room: Conversation) {return String(fact(room.id, 'object', 'task')?.value ?? '')}
    function readable(account: string, room: Conversation) {
        if (!project || !project(account).people.some(person => person.account == account) || !participantIds(room).includes(account)) return false
        const task = taskId(room)
        return !task || Object.hasOwn(project(account).tasks, task)
    }
    function requireRoom(account: string, id: string) {
        const room = host.control.store.state.conversations[id]
        if (!room || !readable(account, room)) throw new Error('Нет доступа к разговору')
        return room
    }
    function messages(room: string) {return Object.values(host.control.store.state.messages).filter(message => message.conversationId == room)}
    function rendered(message: ConversationMessage) {
        const correction = fact(message.conversationId, 'message-edit', message.id)?.value
        const editRevision = fact(message.conversationId, 'message-edit', message.id)?.revision ?? 0
        if (typeof correction == 'string') return {...message, editRevision, blocks: [{
            id: message.id + '-edit',
            version: 1 as const,
            kind: 'text' as const,
            text: correction || 'Сообщение удалено'
        }]}
        return {...message, editRevision}
    }
    function refresh() {
        if (!project) return
        assistant.reconcile()
        for (const member of members.values()) {
            const account = member.ctx.principal.account
            const rooms = Object.values(host.control.store.state.conversations).filter(room => readable(account, room)).map(room => {
                const all = messages(room.id)
                const read = String(fact(room.id, 'read', account)?.value ?? '')
                const after = all.slice(all.findIndex(message => message.id == read) + 1)
                return {
                    id: room.id,
                    title: room.title,
                    members: participantIds(room),
                    task: taskId(room),
                    owner: room.owner,
                    revision: fact(room.id, 'membership', 'current')?.revision ?? 0,
                    unread: after.filter(message => message.createdBy != account).length
                }
            })
            if (!rooms.some(room => room.id == member.room)) {
                member.room = ''
                member.before = ''
            }
            const all = messages(member.room).filter(message => !member.query || rendered(message).blocks.some(block =>
                blockText(block).toLocaleLowerCase().includes(member.query)))
            const end = member.before ? all.findIndex(message => message.id == member.before) : all.length
            const page = all.slice(Math.max(0, end - 50), Math.max(0, end))
            const value: ChatView = {rooms, room: member.room, messages: page.map(rendered), older: end > 50 ? page[0].id : '',
                typing: [...new Set([...members.values()].filter(function active(other) {
                    if (other.room != member.room) return false
                    if (other.ctx.principal.account == account) return false
                    return Date.now() - other.typed < 3000
                }).map(other => other.ctx.principal.account))]
            }
            if (JSON.stringify(member.store.state) != JSON.stringify(value)) Object.assign(member.store.state, value)
        }
    }
    type BlobContext = {account: string, room: string, signal?: AbortSignal}
    const blobs = deps.directory ? createLocalBlobStorage<BlobContext>({directory: path.join(deps.directory, 'files'), maxBytes: 512 * 1024,
        authorize({context, id, operation}) {
            context.signal?.throwIfAborted()
            requireRoom(context.account, context.room)
            // Файл доступен, пока на него ссылается неудалённое сообщение этого разговора.
            const referenced = messages(context.room).some(function links(message) {
                if (fact(context.room, 'message-edit', message.id)?.value === '') return false
                return message.blocks.some(block => block.kind == 'resource' && block.resourceId == id)
            })
            if (operation == 'read' && !referenced) throw new Error('Файл не принадлежит разговору')
        },
    }) : null
    const assistant = createAssistant({provider: deps.provider, directory: deps.directory ? path.join(deps.directory, 'ai') : undefined,
        allowed(account, room) {
            const found = host.control.store.state.conversations[room]
            return !!found && readable(account, found)
        },
        async read(account, room, file) {
            if (!blobs) throw new Error('Нет хранилища')
            return blobs.resource.read({account, room}, file)
        },
        messages(account, room) {
            requireRoom(account, room)
            return messages(room).slice(-50).flatMap(message => rendered(message).blocks.flatMap(block => block.kind == 'text' ? [block.text] : []))
        },
        async save(account, room, id, result) {
            requireRoom(account, room)
            await host.control.upsertFact(account, {
                requestId: 'ai-result-' + id,
                conversationId: room,
                scope: {kind: 'conversation'},
                namespace: 'ai-result',
                key: account + ':' + id,
                value: result
            })
        },
    })
    const resource = {allow: deps.allow, placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        if (!project) throw new Error('Общение ещё не подключено')
        const account = ctx.principal.account
        const connection = host.connection(account)
        const ai = assistant.connection(account)
        const store = createStore(blank())
        const replay = exposeStoreReplay(store, {history: 2})
        const member = {ctx, store, room: '', before: '', query: '', typed: 0}
        members.set(ctx.resourceId, member)
        let closed = false
        function active() {if (closed || ctx.signal.aborted) throw new Error('Общение отключено')}
        function requestId(value: string) {
            if (typeof value != 'string' || !value || value.length > 150) throw new Error('Некорректный идентификатор команды')
            return value
        }
        function text(value: string, max = 4000) {
            if (typeof value != 'string' || value.length > max) throw new Error('Слишком длинный текст')
            return value.trim()
        }
        async function create(input: {requestId: string, title: string, participants: string[], task: string}) {
            active()
            if (!Array.isArray(input.participants) || input.participants.length > 20) throw new Error('Слишком много участников')
            if (input.task && !Object.hasOwn(project!(account).tasks, input.task)) throw new Error('Нет доступа к задаче')
            const result = await connection.fragment.createConversation({
                requestId: requestId(input.requestId),
                title: text(input.title, 120),
                participantIds: input.participants
            })
            if (input.task) await connection.fragment.upsertFact({
                requestId: input.requestId + '-task',
                conversationId: result.conversation.id,
                scope: {kind: 'conversation'},
                namespace: 'object',
                key: 'task',
                value: input.task
            })
            select(result.conversation.id, '')
            return result.conversation.id
        }
        function select(room: string, before: string) {
            active()
            requireRoom(account, room)
            if (before && !messages(room).some(message => message.id == before)) throw new Error('Неизвестная страница')
            if (member.room != room) member.query = ''
            member.room = room
            member.before = before
            refresh()
        }
        function search(room: string, query: string) {
            active()
            requireRoom(account, room)
            member.room = room
            member.before = ''
            member.query = text(query, 120).toLocaleLowerCase()
            refresh()
        }
        async function post(input: {requestId: string, room: string, text: string, reply: string}) {
            active()
            const room = requireRoom(account, input.room)
            if (Object.keys(host.control.store.state.messages).length >= 5000) throw new Error('Достигнут предел истории этого экземпляра')
            if (input.reply && !messages(room.id).some(message => message.id == input.reply)) throw new Error('Ответ на недоступное сообщение')
            const blocks = [{kind: 'text' as const, version: 1 as const, text: text(input.text)}]
            if (!blocks[0].text) throw new Error('Введите сообщение')
            const result = await connection.fragment.postMessage({requestId: requestId(input.requestId), conversationId: room.id, channelId: room.rootChannelId,
                blocks: [...(input.reply ? [{kind: 'custom' as const, version: 1 as const, type: 'reply', data: {message: input.reply}}] : []), ...blocks]})
            member.before = ''
            member.typed = 0
            refresh()
            return result.id
        }
        async function edit(input: {requestId: string, room: string, message: string, text: string, revision: number}) {
            active()
            requireRoom(account, input.room)
            const message = host.control.store.state.messages[input.message]
            if (!message || message.conversationId != input.room || message.createdBy != account) throw new Error('Можно исправить только своё сообщение')
            return connection.fragment.upsertFact({
                requestId: requestId(input.requestId),
                conversationId: input.room,
                scope: {kind: 'conversation'},
                namespace: 'message-edit',
                key: input.message,
                value: text(input.text),
                expectedRevision: input.revision
            })
        }
        async function membership(input: {requestId: string, room: string, participants: string[], revision: number}) {
            active()
            const room = requireRoom(account, input.room)
            const listed = Array.isArray(input.participants) ? input.participants : []
            const sized = listed.length <= 20 && listed.includes(account)
            const staffOnly = listed.every(id => known(project!(account).people, id))
            if (room.owner != account || !sized || !staffOnly) {
                throw new Error('Неверный состав участников или нет прав владельца')
            }
            return connection.fragment.upsertFact({
                requestId: requestId(input.requestId),
                conversationId: room.id,
                scope: {kind: 'conversation'},
                namespace: 'membership',
                key: 'current',
                value: input.participants,
                expectedRevision: input.revision
            })
        }
        async function read(input: {requestId: string, room: string, message: string}) {
            active()
            requireRoom(account, input.room)
            if (!messages(input.room).some(message => message.id == input.message)) throw new Error('Неизвестное сообщение')
            return connection.fragment.upsertFact({
                requestId: requestId(input.requestId),
                conversationId: input.room,
                scope: {kind: 'conversation'},
                namespace: 'read',
                key: account,
                value: input.message
            })
        }
        async function upload(input: {requestId: string, room: string, name: string, bytes: Uint8Array}) {
            active()
            const room = requireRoom(account, input.room)
            if (Object.keys(host.control.store.state.messages).length >= 5000) throw new Error('Достигнут предел истории этого экземпляра')
            if (!blobs) throw new Error('Хранилище вложений не настроено')
            const result = await blobs.control.upload({account, room: room.id, signal: ctx.signal}, input.bytes)
            active()
            requireRoom(account, room.id)
            await connection.fragment.postMessage({requestId: requestId(input.requestId), conversationId: room.id, channelId: room.rootChannelId,
                blocks: [{kind: 'resource', version: 1, resourceId: result.id, label: text(input.name, 120)}]})
            return result.id
        }
        function download(room: string, id: string) {
            active()
            if (!blobs) throw new Error('Нет хранилища')
            return blobs.resource.read({account, room, signal: ctx.signal}, id)
        }
        function typing(room: string) {
            active()
            requireRoom(account, room)
            if (member.room == room) member.typed = Date.now()
            refresh()
        }
        refresh()
        function results(room: string) {
            active()
            requireRoom(account, room)
            const own = Object.values(host.control.store.state.facts).filter(function mine(item) {
                if (item.conversationId != room || item.namespace != 'ai-result') return false
                return item.createdBy == account
            })
            return own.slice(-20).map(item => ({id: item.id, result: item.value as unknown as Proposal}))
        }
        return {facade: {
            control: {create, select, search, post, edit, membership, read, upload, download, typing, results},
            view: replay.api.replay,
            ai: ai.fragment
        },
            close() {
                closed = true
                members.delete(ctx.resourceId)
                replay.close()
                connection.close()
                ai.close()
                refresh()
            }}
    }}
    function mount<S extends object>(input: {
        store: Store<S>,
        project: (state: S, principal: tServicePrincipal) => WorkView,
        principal: (state: S, account: string) => tServicePrincipal
    }) {
        project = account => input.project(input.store.state, input.principal(input.store.state, account))
        const stopState = input.store.on(refresh)
        const stopChat = host.control.store.on(refresh)
        const timer = setInterval(refresh, 1000)
        timer.unref()
        return function close() {
            clearInterval(timer)
            stopState()
            stopChat()
            project = null
            members.clear()
            assistant.close()
            host.close()
        }
    }
    return {resource, mount}
}
export type ChatFacade = ReturnType<ReturnType<typeof createChatRoom>['resource']['open']>['facade']
