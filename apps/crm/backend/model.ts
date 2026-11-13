import {hashSecret, type tSecret} from './identity'
import type {TaskState} from '../organizer/task-model'
import type {ImportJob} from './imports'

export const ROLES = ['owner', 'lead', 'manager', 'customer'] as const
export type tRole = typeof ROLES[number]
export const STAGES = ['incoming', 'qualified', 'proposal', 'won', 'lost'] as const
export type tStage = typeof STAGES[number]
export type Account = {account: string, name: string, secret: tSecret}
export type Organization = {id: string, name: string, revision: number, members: Record<string, tRole>}
export type Company = {id: string, orgId: string, name: string, domain: string, archived: boolean, revision: number}
export type Contact = {id: string, orgId: string, companyId: string, name: string, email: string, phone: string, archived: boolean, revision: number}
export type Interaction = {id: string, author: string, body: string, private: boolean, at: number}
export type ProposalDraft = {title: string, body: string, amount: number, updatedAt: number}
export type ProposalVersion = ProposalDraft & {version: number, publishedAt: number, publishedBy: string}
export type ProposalDecision = {version: number, decision: 'accept' | 'changes', body: string, account: string, at: number}
export type Deal = {
    id: string, orgId: string, title: string, description: string, companyId: string, contactId: string,
    assignee: string, customerAccount: string, amount: number, stage: tStage, archived: boolean,
    revision: number, createdAt: number, updatedAt: number, createdBy: string,
    interactions: Interaction[], draft: ProposalDraft | null, proposals: ProposalVersion[], decisions: ProposalDecision[]
}
export type AuditEntry = {id: string, orgId: string, actor: string, action: string, target: string, at: number}
export type CrmState = {
    accounts: Record<string, Account>, organizations: Record<string, Organization>, companies: Record<string, Company>,
    contacts: Record<string, Contact>, deals: Record<string, Deal>, columns: Record<string, Record<tStage, string[]>>,
    audit: AuditEntry[], workspaces?: Record<string, TaskState>, imports?: Record<string, ImportJob>
}
export const DEMO_LOGINS = {owner: 'owner-pass', lead: 'lead-pass', manager: 'manager-pass', customer: 'customer-pass', outsider: 'outsider-pass'} as const

export function emptyColumns(): Record<tStage, string[]> {return {incoming: [], qualified: [], proposal: [], won: [], lost: []}}
export function createCrmState(): CrmState {
    const at = Date.UTC(2026, 8, 10, 9)
    const organizations: CrmState['organizations'] = {
        northstar: {id: 'northstar', name: 'Northstar Studio', revision: 1, members: {owner: 'owner', lead: 'lead', manager: 'manager', customer: 'customer'}},
        harbor: {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}
    }
    const companies: CrmState['companies'] = {
        'company-aurora': {id: 'company-aurora', orgId: 'northstar', name: 'Aurora Coffee', domain: 'aurora.example', archived: false, revision: 1},
        'company-harbor': {id: 'company-harbor', orgId: 'harbor', name: 'Harbor Client', domain: 'harbor.example', archived: false, revision: 1}
    }
    const contacts: CrmState['contacts'] = {
        'contact-ilya': {
            id: 'contact-ilya',
            orgId: 'northstar',
            companyId: 'company-aurora',
            name: 'Илья · Aurora',
            email: 'ilya@aurora.example',
            phone: '',
            archived: false,
            revision: 1
        },
        'contact-harbor': {
            id: 'contact-harbor',
            orgId: 'harbor',
            companyId: 'company-harbor',
            name: 'Harbor Contact',
            email: 'client@harbor.example',
            phone: '',
            archived: false,
            revision: 1
        }
    }
    function deal(id: string, orgId: string, title: string, assignee: string, customerAccount: string): Deal {
        return {
            id,
            orgId,
            title,
            description: 'Подготовить предложение и согласовать следующий шаг.',
            companyId: orgId == 'northstar' ? 'company-aurora' : 'company-harbor',
            contactId: orgId == 'northstar' ? 'contact-ilya' : 'contact-harbor', assignee, customerAccount, amount: 150000,
            stage: 'incoming', archived: false, revision: 1, createdAt: at, updatedAt: at, createdBy: assignee,
            interactions: [{id: id + '-welcome', author: assignee, body: 'Обсудим цели проекта и подготовим предложение.', private: false, at},
                {id: id + '-internal', author: assignee, body: 'Внутренний ориентир: начать с пилотного проекта.', private: true, at}],
            draft: null, proposals: [], decisions: []}
    }
    return {
        accounts: Object.fromEntries(Object.keys(DEMO_LOGINS).map(account => [account, {account,
            name: ({
                owner: 'Алексей · владелец',
                lead: 'Мария · руководитель',
                manager: 'Даша · менеджер',
                customer: 'Илья · клиент',
                outsider: 'Никита · Harbor'
            } as Record<string, string>)[account], secret: hashSecret(account + '-pass')}])),
        organizations, companies, contacts,
        deals: {'deal-aurora': deal('deal-aurora', 'northstar', 'Новый сайт для Aurora Coffee', 'manager', 'customer'),
            'deal-expansion': deal('deal-expansion', 'northstar', 'Развитие программы лояльности', 'lead', ''),
            'deal-harbor': deal('deal-harbor', 'harbor', 'Закрытая сделка Harbor', 'outsider', '')},
        columns: {
            northstar: {...emptyColumns(), incoming: ['deal-aurora', 'deal-expansion']},
            harbor: {...emptyColumns(), incoming: ['deal-harbor']}
        }, audit: []
    }
}
