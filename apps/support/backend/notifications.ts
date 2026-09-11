import {createHash} from 'node:crypto'
import {schemaCommand, type ServiceCommandCtx, type tServiceCommand, type tServicePrincipal} from 'wenay-common2/service'
import {authorizeOrganization} from './domain'
import type {SupportState} from './model'

export type Notice = {id: string, account: string, orgId: string, ticketId: string, subject: string, action: string, at: number, read: boolean, inApp: boolean, email: boolean}
export type NoticePreferences = {account: string, orgId: string, inApp: boolean, email: boolean}
export type NotificationState = {notices?: Record<string, Notice>, notificationPreferences?: Record<string, NoticePreferences>}
const key = (orgId: string, account: string) => createHash('sha256').update(JSON.stringify([orgId, account])).digest('hex')

export function notificationView(state: SupportState, principal: tServicePrincipal | null) {
    const account = principal?.account ?? ''
    const organizations = Object.values(state.organizations).filter(org => Object.hasOwn(org.members, account) && Object.hasOwn(state.accounts, account))
    const ids = new Set(organizations.map(org => org.id))
    return {preferences: organizations.map(org => state.notificationPreferences?.[key(org.id, account)] ?? {orgId: org.id, account, inApp: true, email: false}),
        notices: Object.values(state.notices ?? {}).filter(item => item.account == account && ids.has(item.orgId)).sort((a, b) => b.at - a.at)}
}
export type NotificationView = ReturnType<typeof notificationView>

export function withNotification<C extends tServiceCommand<SupportState>>(command: C, action: string) {
    return {...command, apply(ctx: ServiceCommandCtx<SupportState>, input: Parameters<C['apply']>[1]): ReturnType<C['apply']> {
        const result = command.apply(ctx, input) as ReturnType<C['apply']>
        const resultId = (result as {id?: unknown})?.id
        const ticketId = typeof input.id == 'string' ? input.id : typeof resultId == 'string' ? resultId : ''
        const ticket = ticketId && ctx.state.tickets[ticketId]
        if (!ticket) return result
        const members = ctx.state.organizations[ticket.orgId].members
        for (const [account, role] of Object.entries(members)) {
            if (account == ctx.account || role == 'customer' && (account != ticket.customer || input.private == true)) continue
            const prefs = ctx.state.notificationPreferences?.[key(ticket.orgId, account)] ?? {inApp: true, email: false}
            if (!prefs.inApp && !prefs.email) continue
            const id = createHash('sha256').update(JSON.stringify([ctx.account, ctx.requestId, action, account])).digest('hex')
            ctx.state.notices ??= {}
            ctx.state.notices[id] = {id, account, orgId: ticket.orgId, ticketId: ticket.id, subject: ticket.subject, action, at: Date.now(), read: false, inApp: prefs.inApp, email: prefs.email}
            const previous = Object.values(ctx.state.notices).filter(item => item.account == account && item.orgId == ticket.orgId).sort((a, b) => b.at - a.at)
            for (const old of previous.slice(100)) delete ctx.state.notices[old.id]
        }
        const all = Object.values(ctx.state.notices ?? {}).sort((a, b) => b.at - a.at)
        for (const old of all.slice(2000)) delete ctx.state.notices![old.id]
        return result
    }}
}

export function createNotifications() {
    return {commands: {
        notificationPreferences: schemaCommand({orgId: 'string', inApp: 'boolean', email: 'boolean'}, {allow: ['signedIn'], apply(ctx: ServiceCommandCtx<SupportState>, input) {
            authorizeOrganization(ctx.state, ctx.account, input.orgId)
            ctx.state.notificationPreferences ??= {}
            ctx.state.notificationPreferences[key(input.orgId, ctx.account)] = {account: ctx.account, ...input}
            return {ok: true}
        }}),
        notificationsRead: schemaCommand({orgId: 'string', ids: {array: 'string'}}, {allow: ['signedIn'], apply(ctx: ServiceCommandCtx<SupportState>, input) {
            authorizeOrganization(ctx.state, ctx.account, input.orgId)
            if (input.ids.length > 100) throw new Error('До 100 уведомлений за один раз')
            const notices = input.ids.map(id => {
                const item = Object.hasOwn(ctx.state.notices ?? {}, id) ? ctx.state.notices![id] : undefined
                if (!item || item.account != ctx.account || item.orgId != input.orgId) throw new Error('Уведомление недоступно')
                return item
            })
            for (const notice of notices) notice.read = true
            return {count: notices.length}
        }})
    }, views: {notifications: {allow: ['signedIn'], project: notificationView}}}
}
