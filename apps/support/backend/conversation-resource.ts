import {buildInputValidate, type InferInput, type ServiceResourceContext} from 'wenay-common2/service'
import type {Store} from 'wenay-common2/observe'
import type {SupportState} from './model'
import {authorizeOrganization} from './domain'

const pageInput = {orgId: 'string', ticketId: 'string', beforeId: 'string', query: 'string', limit: 'number'} as const
const validatePage = buildInputValidate(pageInput)
export type ConversationPageInput = InferInput<typeof pageInput>

export function createConversationHistory() {
    let store: Store<SupportState> | null = null
    function page(account: string, input: ConversationPageInput) {
        validatePage(input)
        if (!store) throw new Error('История закрыта')
        if (input.query.length > 200 || input.beforeId.length > 100 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error('Запрос истории: до 50 сообщений и 200 символов поиска')
        const {role} = authorizeOrganization(store.state, account, input.orgId)
        const ticket = Object.hasOwn(store.state.tickets, input.ticketId) ? store.state.tickets[input.ticketId] : undefined
        if (!ticket || ticket.orgId != input.orgId || role == 'customer' && ticket.customer != account) throw new Error('История обращения недоступна')
        const visible = ticket.messages.filter(message => role != 'customer' || !message.private)
        const boundary = input.beforeId ? visible.findIndex(message => message.id == input.beforeId) : visible.length
        if (boundary < 0) throw new Error('Граница истории недоступна. Обновите переписку')
        const query = input.query.trim().toLocaleLowerCase()
        const matches = visible.slice(0, boundary).filter(message => !query || message.body.toLocaleLowerCase().includes(query))
        const messages = matches.slice(-input.limit).map(message => ({...message}))
        return {messages, nextBeforeId: matches.length > messages.length ? messages[0].id : '', total: visible.filter(message => !query || message.body.toLocaleLowerCase().includes(query)).length, revision: ticket.revision}
    }
    return {resource: {allow: ['signedIn'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        return {facade: {control: {page(input: ConversationPageInput) {ctx.signal.throwIfAborted(); return page(ctx.principal.account, input)}}}, close() {}}
    }}, mount(value: Store<SupportState>) {store = value; return function close() {store = null}}}
}
export type ConversationPage = ReturnType<ReturnType<ReturnType<typeof createConversationHistory>['resource']['open']>['facade']['control']['page']>
