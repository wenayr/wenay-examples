import {hashSecret, type tSecret} from './identity'
import type {TaskState} from '../organizer/task-model'
import type {NotificationState} from './notifications'

export const ROLES = ['owner', 'lead', 'agent', 'customer'] as const
export type tRole = typeof ROLES[number]
export const STATUSES = ['open', 'waiting', 'resolved'] as const
export const PRIORITIES = ['normal', 'high', 'urgent'] as const
export type Account = {account: string, name: string, secret: tSecret}
export type Organization = {id: string, name: string, revision: number, members: Record<string, tRole>}
export type TicketMessage = {id: string, author: string, body: string, private: boolean, at: number}
export type Ticket = {
    id: string, orgId: string, customer: string, subject: string, status: typeof STATUSES[number],
    priority: typeof PRIORITIES[number], assignee: string, revision: number, createdAt: number, updatedAt: number,
    dueAt?: number, firstResponseAt?: number,
    messages: TicketMessage[]
}
export type Article = {
    id: string, orgId: string, title: string, body: string, status: 'draft' | 'published' | 'archived',
    revision: number, updatedAt: number, history?: ArticleVersion[]
}
export type ArticleVersion = Pick<Article, 'title' | 'body' | 'status' | 'revision' | 'updatedAt'>
export type AuditEntry = {id: string, orgId: string, actor: string, action: string, target: string, at: number}
export type Invitation = {
    id: string, orgId: string, role: Exclude<tRole, 'owner'>, tokenHash: string, createdBy: string,
    expiresAt: number, usedBy: string, revoked: boolean
}
export type SupportState = NotificationState & {
    accounts: Record<string, Account>, organizations: Record<string, Organization>, tickets: Record<string, Ticket>,
    articles: Record<string, Article>, invites: Record<string, Invitation>, audit: AuditEntry[], workspaces?: Record<string, TaskState>
}

export const DEMO_LOGINS = {owner: 'owner-pass', lead: 'lead-pass', agent: 'agent-pass', customer: 'customer-pass', outsider: 'outsider-pass'} as const

export function createSupportState(): SupportState {
    const at = Date.UTC(2026, 8, 10, 9)
    return {
        accounts: Object.fromEntries(Object.keys(DEMO_LOGINS).map(account => [account, {
            account, name: ({owner: 'Алексей · владелец', lead: 'Мария · руководитель', agent: 'Даша · поддержка', customer: 'Илья · клиент', outsider: 'Никита · другая команда'} as Record<string, string>)[account],
            secret: hashSecret(account + '-pass')
        }])),
        organizations: {
            northstar: {id: 'northstar', name: 'Northstar Studio', revision: 1, members: {owner: 'owner', lead: 'lead', agent: 'agent', customer: 'customer'}},
            harbor: {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}
        },
        tickets: {
            'ticket-welcome': {
                id: 'ticket-welcome', orgId: 'northstar', customer: 'customer', subject: 'Как пригласить коллегу в проект?',
                status: 'open', priority: 'normal', assignee: 'agent', revision: 1, createdAt: at, updatedAt: at, dueAt: at + 86400_000,
                messages: [
                    {id: 'message-welcome', author: 'customer', body: 'Добрый день! Хочу пригласить дизайнера. Где настроить доступ к проекту?', private: false, at},
                    {id: 'note-welcome', author: 'lead', body: 'Проверьте, что приглашение создаёт владелец или руководитель команды.', private: true, at}
                ]
            },
            'ticket-export': {
                id: 'ticket-export', orgId: 'northstar', customer: 'owner', subject: 'Не завершился экспорт отчёта',
                status: 'waiting', priority: 'high', assignee: 'lead', revision: 1, createdAt: at, updatedAt: at, dueAt: at + 14400_000,
                messages: [{id: 'message-export', author: 'owner', body: 'Экспорт остановился на последнем шаге. Нужен отчёт за август.', private: false, at}]
            },
            'ticket-harbor': {
                id: 'ticket-harbor', orgId: 'harbor', customer: 'outsider', subject: 'Закрытое обращение Harbor',
                status: 'open', priority: 'normal', assignee: '', revision: 1, createdAt: at, updatedAt: at, dueAt: at + 86400_000,
                messages: [{id: 'message-harbor', author: 'outsider', body: 'Материалы только для Harbor Labs.', private: false, at}]
            }
        },
        articles: {
            'article-invite': {id: 'article-invite', orgId: 'northstar', title: 'Как пригласить коллегу', body: 'Откройте раздел «Команда». Владелец или руководитель создаёт одноразовое приглашение с ролью и сроком действия. Передайте код коллеге. Коллега входит в свой аккаунт и принимает приглашение.', status: 'published', revision: 1, updatedAt: at},
            'article-export': {id: 'article-export', orgId: 'northstar', title: 'Экспорт данных', body: 'При незавершённом экспорте сообщите поддержке период и название отчёта. Не отправляйте пароли. Специалист проверит состояние операции до повторного запуска.', status: 'published', revision: 1, updatedAt: at},
            'article-internal': {id: 'article-internal', orgId: 'northstar', title: 'Внутренняя инструкция', body: 'Черновик для сотрудников: порядок проверки доступа перед ответом клиенту.', status: 'draft', revision: 1, updatedAt: at},
            'article-harbor': {id: 'article-harbor', orgId: 'harbor', title: 'Harbor onboarding', body: 'Внутренние данные другой организации.', status: 'published', revision: 1, updatedAt: at}
        },
        invites: {}, audit: []
    }
}
