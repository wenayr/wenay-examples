import {hashSecret, type tSecret} from './identity'
export const ROLES = ['owner', 'reviewer', 'requester'] as const
export type tRole = typeof ROLES[number]
export type Answers = Record<string, string | number | boolean>
export type Field = {id: string, label: string, kind: 'text' | 'longtext' | 'number' | 'choice' | 'boolean', required: boolean, choices: string[], min: number, max: number, whenField: string, whenEquals: string}
export type tStatus = 'draft' | 'pending' | 'changes' | 'approved' | 'rejected' | 'withdrawn'
export type RequestVersion = {version: number, title: string, answers: Answers, fields: Field[], at: number}
export type Request = {id: string, orgId: string, author: string, revision: number, title: string, answers: Answers, status: tStatus, versions: RequestVersion[], history: {version: number, kind: 'submitted' | 'changes' | 'approved' | 'rejected' | 'withdrawn', actor: string, body: string, at: number}[], updatedAt: number}
export type Receipt = {id: string, revision: number, status: tStatus, version: number}
export type ApprovalState = {accounts: Record<string, {name: string, secret: tSecret}>, organizations: Record<string, {id: string, name: string, revision: number, members: Record<string, tRole>}>, fields: Field[], requests: Record<string, Request>, intents: Record<string, {signature: string, result: Receipt}>}
export function createApprovalState(): ApprovalState {
    const field = (id: string, label: string, kind: Field['kind'], max: number): Field => ({id, label, kind, required: true, choices: [], min: 1, max, whenField: '', whenEquals: ''})
    return {accounts: Object.fromEntries(['owner', 'reviewer', 'requester', 'requester2', 'outsider'].map(account => [account, {name: account, secret: hashSecret(account + '-pass')}])),
        organizations: {northstar: {id: 'northstar', name: 'Northstar Studio', revision: 1, members: {owner: 'owner', reviewer: 'reviewer', requester: 'requester', requester2: 'requester'}}, harbor: {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}},
        fields: [field('purpose', 'Зачем это команде?', 'longtext', 2000), field('amount', 'Сумма, ₽', 'number', 1000000), {...field('urgent', 'Нужно срочно?', 'boolean', 0), min: 0}, {...field('reason', 'Почему нельзя подождать?', 'text', 300), whenField: 'urgent', whenEquals: 'true'}], requests: {}, intents: {}}
}
