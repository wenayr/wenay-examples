import {hashSecret, type tSecret} from './identity'

export const ROLES = ['owner', 'reviewer', 'requester'] as const
export type tRole = typeof ROLES[number]
export type tStatus = 'draft' | 'pending' | 'changes' | 'approved' | 'rejected' | 'withdrawn'
export type tHistoryKind = 'submitted' | 'changes' | 'approved' | 'rejected' | 'withdrawn'
export type Answers = Record<string, string | number | boolean>

export type Field = {
    id: string,
    label: string,
    kind: 'text' | 'longtext' | 'number' | 'choice' | 'boolean',
    required: boolean,
    choices: string[],
    min: number,
    max: number,
    whenField: string,
    whenEquals: string
}

// Отправленная версия хранит собственную копию анкеты: решение принимается
// по тому составу вопросов, который видел автор.
export type RequestVersion = {version: number, title: string, answers: Answers, fields: Field[], at: number}
export type HistoryEntry = {version: number, kind: tHistoryKind, actor: string, body: string, at: number}

export type Request = {
    id: string,
    orgId: string,
    author: string,
    revision: number,
    title: string,
    answers: Answers,
    status: tStatus,
    versions: RequestVersion[],
    history: HistoryEntry[],
    updatedAt: number
}

export type Receipt = {id: string, revision: number, status: tStatus, version: number}
export type Account = {name: string, secret: tSecret}
export type Organization = {id: string, name: string, revision: number, members: Record<string, tRole>}

export type ApprovalState = {
    accounts: Record<string, Account>,
    organizations: Record<string, Organization>,
    fields: Field[],
    requests: Record<string, Request>,
    intents: Record<string, {signature: string, result: Receipt}>
}

const demoAccounts = ['owner', 'reviewer', 'requester', 'requester2', 'outsider']

function field(id: string, label: string, kind: Field['kind'], max: number): Field {
    return {id, label, kind, required: true, choices: [], min: 1, max, whenField: '', whenEquals: ''}
}

export function createApprovalState(): ApprovalState {
    const accounts = demoAccounts.map(account => [account, {name: account, secret: hashSecret(account + '-pass')}])
    const northstar: Organization = {
        id: 'northstar', name: 'Northstar Studio', revision: 1,
        members: {owner: 'owner', reviewer: 'reviewer', requester: 'requester', requester2: 'requester'}
    }
    const harbor: Organization = {id: 'harbor', name: 'Harbor Labs', revision: 1, members: {outsider: 'owner'}}
    const fields = [
        field('purpose', 'Зачем это команде?', 'longtext', 2000),
        field('amount', 'Сумма, ₽', 'number', 1000000),
        {...field('urgent', 'Нужно срочно?', 'boolean', 0), min: 0},
        {...field('reason', 'Почему нельзя подождать?', 'text', 300), whenField: 'urgent', whenEquals: 'true'}
    ]
    return {
        accounts: Object.fromEntries(accounts),
        organizations: {northstar, harbor},
        fields,
        requests: {},
        intents: {}
    }
}
